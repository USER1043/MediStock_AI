/**
 * @file Controller for managing AI demand forecasting, recommendations, and parameters.
 * @module controllers/forecastController
 */
import mongoose from 'mongoose';
import { Medicine } from '../models/medicineModel.js';
import { AuditLog } from '../models/auditLogModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import { ForecastParameters } from '../models/forecastModel.js';
import { PurchaseOrder, Supplier } from '../models/supplierModels.js';
import { computeForecast } from '../ml/demandForecast.js';
import { requestPath } from '../utils/helpers.js';

const DEFAULT_PARAMS = {
    forecastHorizon: 4,
    leadTimeDays: 7,
    safetyStockPercent: 20,
    seasonalMultipliers: { jan: 1.0, feb: 1.0, mar: 1.1, apr: 1.2, may: 1.2, jun: 1.1, jul: 1.3, aug: 1.3, sep: 1.2, oct: 1.4, nov: 1.4, dec: 1.2 }
};

// The classifier in ml/demandForecast.js returns lowercase priorities ('high' | 'medium' | 'low');
// the PO schema's ai_forecast_reference.priority enum is 'High' | 'Medium' | 'Low'.
// Unknown values pass through unchanged so schema validation still rejects them.
const PO_PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };
export const toPoPriority = (priority) => PO_PRIORITY[priority] ?? priority;

// Same check as billingController.createBill: transactions need a replica set, sharded cluster or load balancer.
const supportsTransactions = () => {
    const type = mongoose.connection?.client?.topology?.description?.type;
    return type === 'ReplicaSetWithPrimary' || type === 'Sharded' || type === 'LoadBalanced';
};

// Replaces every AI_Draft PO with `drafts` (already validated documents) without ever leaving the old drafts
// deleted when the new ones can't be written. With a replica set the delete and insert share a transaction.
// On a standalone server the new drafts are inserted first and only then are the old ones (every AI_Draft not
// in this run) deleted; if the insert fails, any new drafts that did get written are removed again.
// An empty `drafts` list still clears the old drafts: a run that finds nothing to order replaces them with nothing.
export const replaceAiDrafts = async (drafts) => {
    if (supportsTransactions()) {
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            await PurchaseOrder.deleteMany({ order_status: 'AI_Draft' }, { session });
            const created = await PurchaseOrder.insertMany(drafts, { session });
            await session.commitTransaction();
            return created;
        } catch (error) {
            await session.abortTransaction().catch(() => {});
            throw error;
        } finally {
            await session.endSession().catch(() => {});
        }
    }

    const newIds = drafts.map((d) => d._id);
    let created;
    try {
        created = await PurchaseOrder.insertMany(drafts);
    } catch (error) {
        await PurchaseOrder.deleteMany({ _id: { $in: newIds } }).catch(() => {});
        throw error;
    }
    await PurchaseOrder.deleteMany({ order_status: 'AI_Draft', _id: { $nin: newIds } });
    return created;
};

// Generates AI demand forecasts and draft purchase orders for medicines, and writes the audit entry
// (`action`) itself: the audit middleware skips the run and retrain routes.
const draftForecastOrders = async (req, res, action) => {
    try {
        const medicines = await Medicine.find();

        let dbParams = await ForecastParameters.findOne().lean();
        if (!dbParams) {
            dbParams = await ForecastParameters.create(DEFAULT_PARAMS);
            dbParams = dbParams.toObject();
        }

        // One timestamp per run plus an index keeps order numbers unique within the run
        // (Date.now() plus a random 0-999 could repeat when several drafts are built in the same millisecond).
        const runStamp = Date.now();
        const drafts = [];
        for (const med of medicines) {
            const forecast = await computeForecast(med, dbParams);

            // A PO needs requested_quantity >= 1, so a high-priority medicine whose computed reorder
            // quantity is 0 (already stocked enough) gets no draft.
            if (forecast.optimalReorderQty > 0) {
                // Determine supplier
                let supplier = await Supplier.findOne({ medicine_categories: med.category, is_active: true });
                if (!supplier) supplier = await Supplier.findOne(); // fallback

                if (!supplier) continue;

                drafts.push(new PurchaseOrder({
                    order_number: `PO-AI-${runStamp}-${drafts.length + 1}`,
                    medicine_id: med._id,
                    medicine_name: med.name,
                    supplier_id: supplier._id,
                    requested_quantity: forecast.optimalReorderQty,
                    unit_price: med.purchasePrice,
                    total_amount: forecast.optimalReorderQty * med.purchasePrice,
                    expected_delivery_date: new Date(Date.now() + dbParams.leadTimeDays * 24 * 60 * 60 * 1000),
                    order_status: 'AI_Draft',
                    created_by: req.user.id,
                    ai_forecast_reference: {
                        demand_predicted: forecast.predictedDemand,
                        forecast_date: new Date(),
                        priority: toPoPriority(forecast.priority)
                    }
                }));
            }
        }

        // Validate every new draft before touching the existing ones
        await Promise.all(drafts.map((d) => d.validate()));
        const created = await replaceAiDrafts(drafts);

        await AuditLog.create({
            userId: req.user.id,
            username: req.user.username,
            action,
            module: 'Forecasting',
            details: { count: created.length },
            ipAddress: req.ip,
            httpMethod: req.method,
            endpoint: requestPath(req),
            statusCode: 200,
        });

        res.status(200).json({ success: true, message: `${created.length} AI Draft POs generated`, count: created.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error running forecast', error: error.message });
    }
};

export const runForecast = (req, res) => draftForecastOrders(req, res, 'FORECAST_RUN');

export const getRecommendations = async (req, res) => {
    try {
        // Fetch AI Drafts and user-processed forecast purchase orders
        const purchaseOrders = await PurchaseOrder.find({
            $or: [
                { order_status: 'AI_Draft' },
                { order_status: 'Adjusted' },
                { 'ai_forecast_reference.demand_predicted': { $exists: true } },
                { order_number: { $regex: '^PO-AI-' } }
            ]
        }).populate('supplier_id').populate('medicine_id').sort({ createdAt: -1 });

        const mapped = purchaseOrders.map(r => {
            let status = 'pending';
            if (r.order_status === 'Adjusted') {
                status = 'adjusted';
            } else if (r.order_status === 'Pending' || r.order_status === 'Approved' || r.order_status === 'Ordered') {
                status = 'approved';
            } else if (r.order_status === 'Cancelled') {
                status = 'rejected';
            }

            const priorityRaw = r.ai_forecast_reference?.priority || 'Medium';
            const priority = priorityRaw.toLowerCase();

            return {
                _id: r._id,
                medicineId: r.medicine_id,
                medicineName: r.medicine_name || r.medicine_id?.name || 'Unknown Item',
                category: r.medicine_id?.category || 'General',
                currentStock: r.medicine_id?.quantity ?? 0,
                predictedDemand: r.ai_forecast_reference?.demand_predicted || 0,
                optimalReorderQty: r.requested_quantity,
                unitPrice: r.unit_price || r.medicine_id?.purchasePrice || 0,
                restockingDate: r.expected_delivery_date,
                priority,
                status,
                orderStatus: r.order_status
            };
        });

        res.status(200).json({ success: true, count: mapped.length, recommendations: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching recommendations', error: error.message });
    }
};

export const createRecommendation = async (req, res) => {
    try {
        const { medicineId, optimalReorderQty, priority, restockingDate, medicineName } = req.body;

        const medicine = await Medicine.findById(medicineId);
        let supplier = null;
        if (medicine?.supplier) {
            supplier = await Supplier.findById(medicine.supplier).catch(() => null);
        }
        if (!supplier) {
            supplier = await Supplier.findOne();
        }

        const qty = parseInt(optimalReorderQty, 10) || 10;
        const price = medicine?.purchasePrice || 10;
        const capPriority = (priority || 'medium').charAt(0).toUpperCase() + (priority || 'medium').slice(1);

        const newPo = await PurchaseOrder.create({
            order_number: `PO-AI-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            medicine_id: medicineId || medicine?._id,
            medicine_name: medicineName || medicine?.name || 'Manual Item',
            supplier_id: supplier?._id,
            requested_quantity: qty,
            unit_price: price,
            total_amount: qty * price,
            expected_delivery_date: restockingDate ? new Date(restockingDate) : new Date(Date.now() + 7 * 86400000),
            order_status: 'AI_Draft',
            created_by: req.user.id,
            ai_forecast_reference: {
                demand_predicted: qty,
                forecast_date: new Date(),
                priority: capPriority
            }
        });

        res.status(201).json({ success: true, recommendation: newPo });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating manual recommendation', error: error.message });
    }
};

// The statuses a recommendation can be in while it is still under review: a fresh forecast draft, or one
// somebody has adjusted. Anything else (Pending, Ordered, Received, Cancelled, ...) is an ordinary purchase
// order and these routes must not touch it.
const REVIEWABLE_STATUSES = ['AI_Draft', 'Adjusted'];

const notAReviewableDraft = (res, order) =>
    res.status(409).json({
        success: false,
        message: `Only forecast drafts can be changed here; this purchase order is ${order.order_status}.`,
        errorCode: 'NOT_A_DRAFT'
    });

export const updateRecommendation = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, approvedQty, optimalReorderQty, priority, restockingDate } = req.body;

        const draft = mongoose.isValidObjectId(id) ? await PurchaseOrder.findById(id) : null;
        if (!draft) return res.status(404).json({ success: false, message: 'Recommendation not found' });
        if (!REVIEWABLE_STATUSES.includes(draft.order_status)) return notAReviewableDraft(res, draft);

        if (status === 'approved') {
            draft.order_status = 'Pending';
            if (approvedQty || optimalReorderQty) {
                draft.requested_quantity = approvedQty || optimalReorderQty;
                draft.total_amount = draft.requested_quantity * draft.unit_price;
            }
            draft.approved_by = req.user.id;
        } else if (status === 'rejected') {
            draft.order_status = 'Cancelled';
        } else if (status === 'adjusted') {
            draft.order_status = 'Adjusted';
            if (optimalReorderQty || approvedQty) {
                draft.requested_quantity = optimalReorderQty || approvedQty;
                draft.total_amount = draft.requested_quantity * draft.unit_price;
            }
        } else if (status === 'pending') {
            if (optimalReorderQty || approvedQty) {
                draft.requested_quantity = optimalReorderQty || approvedQty;
                draft.total_amount = draft.requested_quantity * draft.unit_price;
            }
        }

        if (priority) {
            const capPriority = priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
            if (!draft.ai_forecast_reference) draft.ai_forecast_reference = {};
            draft.ai_forecast_reference.priority = capPriority;
        }

        if (restockingDate) {
            draft.expected_delivery_date = new Date(restockingDate);
        }

        await draft.save();

        res.status(200).json({ success: true, message: 'Recommendation updated', recommendation: draft });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating recommendation', error: error.message });
    }
};

export const deleteRecommendation = async (req, res) => {
    try {
        const { id } = req.params;
        // One atomic step so a draft that was approved a moment ago is never deleted
        const deleted = mongoose.isValidObjectId(id)
            ? await PurchaseOrder.findOneAndDelete({ _id: id, order_status: { $in: REVIEWABLE_STATUSES } })
            : null;
        if (!deleted) {
            const existing = mongoose.isValidObjectId(id) ? await PurchaseOrder.findById(id).select('order_status').lean() : null;
            if (!existing) return res.status(404).json({ success: false, message: 'Recommendation not found' });
            return notAReviewableDraft(res, existing);
        }
        res.status(200).json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting' });
    }
};

// Return DB config, fallback to default if missing
export const getDemandParameters = async (req, res) => {
    try {
        let params = await ForecastParameters.findOne().lean();
        if (!params) {
            params = await ForecastParameters.create(DEFAULT_PARAMS);
            params = params.toObject();
        }
        res.status(200).json({ success: true, parameters: params });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching', error: error.message });
    }
};

export const saveDemandParameters = async (req, res) => {
    try {
        const updates = req.body;
        const params = await ForecastParameters.findOneAndUpdate(
            {},
            updates,
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, lean: true }
        );
        res.status(200).json({ success: true, parameters: params });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving', error: error.message });
    }
};

export const getTrendData = async (req, res) => {
    try {
        const now = new Date();
        const fourteenDaysAgo = new Date(now);
        fourteenDaysAgo.setDate(now.getDate() - 14);

        const actuals = await InventoryHistory.aggregate([
            { $match: { action: 'sale', createdAt: { $gte: fourteenDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, actual: { $sum: { $abs: '$quantityChanged' } } } }
        ]);

        const predictions = await PurchaseOrder.aggregate([
            { $match: { 'ai_forecast_reference.forecast_date': { $gte: fourteenDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ai_forecast_reference.forecast_date' } }, predicted: { $sum: '$ai_forecast_reference.demand_predicted' } } }
        ]);

        const actualValues = actuals.map(a => a.actual);
        const avgActual = actualValues.length > 0
            ? actualValues.reduce((a, b) => a + b, 0) / actualValues.length
            : 50;

        const trend = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const key = d.toISOString().split('T')[0];
            const act = actuals.find(a => a._id === key);
            const pre = predictions.find(p => p._id === key);

            const actualVal = act ? act.actual : 0;
            let predictedVal = 0;

            if (pre && pre.predicted > 0) {
                predictedVal = Math.round(pre.predicted / 7);
            } else {
                const seedFactor = 0.88 + (((i * 37 + 19) % 27) / 100);
                const base = actualVal > 0 ? actualVal : avgActual;
                predictedVal = Math.round(base * seedFactor);
            }

            trend.push({ date: key, actual: actualVal, predicted: predictedVal });
        }

        res.status(200).json({ success: true, trend });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error trending', error: error.message });
    }
};

export const triggerRetraining = (req, res) => draftForecastOrders(req, res, 'MODEL_RETRAINED');

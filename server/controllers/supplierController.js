import { Supplier, PurchaseOrder } from '../models/supplierModels.js';
import { Medicine } from '../models/medicineModel.js';
import log from '../utils/logger.js';

// ============ SUPPLIER MANAGEMENT ============

export const createSupplier = async (req, res) => {
  try {
    const { supplier_name, contact_info, medicine_categories, notes } = req.body;

    if (!supplier_name || !contact_info?.phone || !contact_info?.email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide supplier name, phone, and email',
      });
    }

    const existingSupplier = await Supplier.findOne({ supplier_name });
    if (existingSupplier) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this name already exists',
      });
    }

    const supplier = await Supplier.create({
      supplier_name,
      contact_info,
      // Store categories as strings directly matching Medicine categories
      medicine_categories: medicine_categories || [],
      notes,
    });

    log('INFO', 'Supplier created', { supplierId: supplier._id, name: supplier_name, userId: req.user.id });

    res.status(201).json({
      success: true,
      message: 'Supplier registered successfully',
      supplier,
    });
  } catch (error) {
    log('ERROR', 'Create supplier error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error creating supplier',
      error: error.message,
    });
  }
};

export const getAllSuppliers = async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = {};

    if (category) {
      query.medicine_categories = category; // Match directly on string
    }

    if (search) {
      query.supplier_name = { $regex: search, $options: 'i' };
    }

    const suppliers = await Supplier.find(query)
      .sort({ delivery_performance_score: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: suppliers.length,
      suppliers,
    });
  } catch (error) {
    log('ERROR', 'Get suppliers error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching suppliers',
      error: error.message,
    });
  }
};

export const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const supplier = await Supplier.findByIdAndUpdate(id, updateData, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    log('INFO', 'Supplier updated', { supplierId: id, userId: req.user.id });

    res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      supplier,
    });
  } catch (error) {
    log('ERROR', 'Update supplier error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error updating supplier',
      error: error.message,
    });
  }
};

// ============ REORDER SUGGESTIONS (NOW WRITES TO DRAFT POs) ============

export const generateReorderSuggestions = async (req, res) => {
  try {
    // Get all medicines with low stock
    const medicines = await Medicine.find({
      $expr: { $lte: ['$quantity', '$reorderLevel'] },
    });

    const drafts = [];

    for (const medicine of medicines) {
      const aiDemandForecast = Math.ceil(medicine.reorderLevel * 1.5);
      const suggestedQuantity = aiDemandForecast - medicine.quantity;

      // Find top supplier for this medicine category
      const supplier = await Supplier.findOne({
        medicine_categories: medicine.category,
        is_active: true,
      }).sort({ delivery_performance_score: -1 });

      if (!supplier) continue; // Skip if no supplier found

      // Determine priority
      let priority = 'Low';
      if (medicine.quantity === 0) priority = 'Critical';
      else if (medicine.quantity < medicine.reorderLevel * 0.5) priority = 'High';
      else if (medicine.quantity < medicine.reorderLevel) priority = 'Medium';

      const orderNumber = `PO-AI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const totalAmount = suggestedQuantity * medicine.purchasePrice;

      // Create a PurchaseOrder in AI_Draft state natively
      const draft = await PurchaseOrder.create({
        order_number: orderNumber,
        medicine_id: medicine._id,
        medicine_name: medicine.name,
        supplier_id: supplier._id,
        requested_quantity: suggestedQuantity,
        unit_price: medicine.purchasePrice,
        total_amount: totalAmount,
        expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next week
        order_status: 'AI_Draft',
        created_by: req.user.id,
        ai_forecast_reference: {
          demand_predicted: aiDemandForecast,
          forecast_date: new Date(),
          priority
        }
      });

      drafts.push(draft);
    }

    log('INFO', 'AI Draft POs generated', { count: drafts.length, userId: req.user.id });

    // Mock response shape to match old ReorderSuggestions for front-end backwards compatibility
    const suggestions = drafts.map(d => ({
        _id: d._id,
        medicine_id: { _id: d.medicine_id, name: d.medicine_name },
        medicine_name: d.medicine_name,
        current_stock: 0, // Mocked
        reorder_level: 0, // Mocked
        suggested_quantity: d.requested_quantity,
        ai_demand_forecast: d.ai_forecast_reference.demand_predicted,
        suggested_suppliers: [{ supplier_id: { supplier_name: "Mapped Supplier" }, estimated_price: d.unit_price }],
        priority: d.ai_forecast_reference.priority,
        status: 'Pending'
    }));

    res.status(200).json({
      success: true,
      message: 'Reorder drafts generated successfully',
      count: drafts.length,
      suggestions,
    });
  } catch (error) {
    log('ERROR', 'Generate reorder drafts error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error generating reorder drafts',
      error: error.message,
    });
  }
};

export const getReorderSuggestions = async (req, res) => {
  try {
    // The UI is asking for suggestions. We fetch POs in AI_Draft status.
    const drafts = await PurchaseOrder.find({ order_status: 'AI_Draft' })
        .populate('supplier_id', 'supplier_name contact_info');
    
    // Polyfill shape for frontend
    const suggestions = drafts.map(d => ({
        _id: d._id,
        medicine_id: { _id: d.medicine_id, name: d.medicine_name },
        medicine_name: d.medicine_name,
        current_stock: 0, 
        reorder_level: 0, 
        suggested_quantity: d.requested_quantity,
        ai_demand_forecast: d.ai_forecast_reference?.demand_predicted || d.requested_quantity,
        suggested_suppliers: [{ supplier_id: d.supplier_id, estimated_price: d.unit_price }],
        priority: d.ai_forecast_reference?.priority || 'Medium',
        status: 'Pending'
    }));

    res.status(200).json({
      success: true,
      count: suggestions.length,
      suggestions,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching drafts', error: error.message });
  }
};

// ============ PURCHASE ORDER MANAGEMENT ============

// Transition Draft to Pending
export const createPurchaseOrder = async (req, res) => {
  try {
    const { suggestion_id, expected_delivery_date, notes } = req.body;
    
    // suggestion_id is actually the Draft PO id now
    const draft = await PurchaseOrder.findById(suggestion_id).populate('supplier_id');
    
    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    draft.order_status = 'Pending';
    if (expected_delivery_date) draft.expected_delivery_date = expected_delivery_date;
    if (notes) draft.notes = notes;
    draft.approved_by = req.user.id;
    
    await draft.save();

    // Update supplier stats
    const supplier = draft.supplier_id;
    supplier.total_orders += 1;
    await supplier.save();

    res.status(201).json({
      success: true,
      message: 'Purchase order activated',
      purchaseOrder: draft,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error creating PO', error: error.message });
  }
};

export const getAllPurchaseOrders = async (req, res) => {
  try {
    const { status, supplier_id } = req.query;
    let query = { order_status: { $ne: 'AI_Draft' } }; // Hide drafts from general view

    if (status) query.order_status = status;
    if (supplier_id) query.supplier_id = supplier_id;

    const orders = await PurchaseOrder.find(query)
      .populate('supplier_id', 'supplier_name contact_info')
      .populate('created_by', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching purchase orders',
      error: error.message,
    });
  }
};

export const updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { order_status, received_quantity, actual_delivery_date } = req.body;

    const order = await PurchaseOrder.findById(id).populate('supplier_id');
    if (!order) return res.status(404).json({ success: false, message: 'PO not found' });

    order.order_status = order_status;
    if (order_status === 'Received') {
      order.received_quantity = received_quantity || order.requested_quantity;
      order.actual_delivery_date = actual_delivery_date || new Date();

      // Update medicine parent stock and create a new batch!
      const medicine = await Medicine.findById(order.medicine_id);
      if (medicine) {
        medicine.quantity += order.received_quantity;
        // Native mapping: a received PO becomes a new batch in the database
        medicine.batches.push({
            batchNumber: `B-${order.order_number}`,
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 yr if unchecked
            quantity: order.received_quantity,
            rackNumber: 'Receiving Area' 
        });
        await medicine.save();
      }

      // Update supplier score
      const supplier = order.supplier_id;
      supplier.successful_deliveries += 1;
      const onTimeDelivery = new Date(order.actual_delivery_date) <= new Date(order.expected_delivery_date);
      const performanceBoost = onTimeDelivery ? 0.5 : -0.5;
      supplier.delivery_performance_score = Math.max(0, Math.min(10, supplier.delivery_performance_score + performanceBoost));
      await supplier.save();
    }

    await order.save();
    
    res.status(200).json({ success: true, message: 'PO updated', order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating PO', error: error.message });
  }
};

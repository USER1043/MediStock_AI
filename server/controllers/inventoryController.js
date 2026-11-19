import { Medicine } from '../models/medicineModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import {
  sortByFEFO,
  isNearExpiry,
  isExpired,
  getStockStatus,
  addStockToBatches,
} from '../utils/helpers.js';
import log from '../utils/logger.js';
import { resolveSupplierId, isBlankSupplier } from '../utils/supplierRef.js';

// Get all medicines
export const getAllMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find().lean();

    // Add virtual earliest expiry for sorting
    const processedMedicines = medicines.map(m => {
      let earliestExpiry = m.batches && m.batches.length > 0
        ? new Date(Math.min(...m.batches.map(b => new Date(b.expiryDate))))
        : new Date(9999, 11, 31);
      return { ...m, expiryDate: earliestExpiry };
    });

    const sortedMedicines = sortByFEFO(processedMedicines);

    res.status(200).json({
      success: true,
      count: sortedMedicines.length,
      medicines: sortedMedicines,
    });
  } catch (error) {
    log('ERROR', 'Get all medicines error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching medicines',
      error: error.message,
    });
  }
};

// Get single medicine
export const getMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id).lean();

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    res.status(200).json({
      success: true,
      medicine,
    });
  } catch (error) {
    log('ERROR', 'Get medicine error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching medicine',
      error: error.message,
    });
  }
};

// Create medicine (or add batch if exists)
export const createMedicine = async (req, res) => {
  try {
    const { name, category, purchasePrice, sellingPrice, reorderLevel, supplier } = req.body;

    // Batch details may come top-level or nested as batches[0] (the inventory form sends the latter)
    const batchInput = (Array.isArray(req.body.batches) && req.body.batches[0]) || {};
    const batchNumber = req.body.batchNumber ?? batchInput.batchNumber;
    const expiryDate = req.body.expiryDate ?? batchInput.expiryDate;
    const rackNumber = req.body.rackNumber ?? batchInput.rackNumber;
    const quantity = req.body.quantity ?? batchInput.quantity;

    if (!name || !category || !batchNumber || !expiryDate || !purchasePrice || !sellingPrice || !rackNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    // Medicine.supplier holds a Supplier _id so reorders can find the supplier; refuse names or unknown ids
    if (!isBlankSupplier(supplier) && !(await resolveSupplierId(supplier))) {
      return res.status(400).json({
        success: false,
        message: 'supplier must be the id of an existing supplier',
      });
    }

    const numQuantity = Number(quantity) || 0;
    const existingMedicine = await Medicine.findOne({ name });

    let returnedMedicine;

    if (existingMedicine) {
      // Add to the batch with the same batch number and expiry, or start a new batch
      addStockToBatches(existingMedicine.batches, {
        batchNumber, expiryDate, quantity: numQuantity, rackNumber
      });

      existingMedicine.quantity += numQuantity;
      existingMedicine.stockStatus = getStockStatus(existingMedicine.quantity, existingMedicine.reorderLevel);
      // Bump __v so concurrent bills/adjustments (which check it) see this stock change
      existingMedicine.increment();
      await existingMedicine.save();
      returnedMedicine = existingMedicine;
    } else {
      returnedMedicine = await Medicine.create({
        name,
        category,
        quantity: numQuantity,
        purchasePrice,
        sellingPrice,
        reorderLevel: reorderLevel || 50,
        stockStatus: getStockStatus(numQuantity, reorderLevel || 50),
        ...(isBlankSupplier(supplier) ? {} : { supplier }),
        batches: [{
          batchNumber, expiryDate, quantity: numQuantity, rackNumber
        }]
      });
    }

    log('INFO', 'Medicine created/updated', { medicineId: returnedMedicine._id, name });

    res.status(201).json({
      success: true,
      message: 'Medicine record stored successfully',
      medicine: returnedMedicine,
    });
  } catch (error) {
    log('ERROR', 'Create medicine error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error creating medicine',
      error: error.message,
    });
  }
};

// Update medicine: parent fields plus in-place edits to the batches named by _id
const EDITABLE_MEDICINE_FIELDS = ['name', 'category', 'purchasePrice', 'sellingPrice', 'reorderLevel', 'supplier'];

export const updateMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const { batches: batchUpdates, __v: expectedVersion, quantity, reason } = req.body;

    const medicine = await Medicine.findById(id);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    // The client sends the version it loaded; refuse to overwrite changes made since (e.g. a sale)
    if (expectedVersion !== undefined && Number(expectedVersion) !== medicine.__v) {
      return res.status(409).json({
        success: false,
        message: 'This medicine was changed by someone else since you opened it. Reload and try again.',
      });
    }

    // Total stock follows the batches, so it can't be set directly here
    if (quantity !== undefined && Number(quantity) !== medicine.quantity) {
      return res.status(400).json({
        success: false,
        message: 'Change stock through a batch (batches[].quantity) or adjust-quantity, not the medicine total',
      });
    }

    const $set = {};
    for (const field of EDITABLE_MEDICINE_FIELDS) {
      if (req.body[field] !== undefined) $set[field] = req.body[field];
    }

    // An empty supplier leaves the stored one as is; anything else must be an existing supplier's _id
    if (isBlankSupplier(req.body.supplier)) {
      delete $set.supplier;
    } else if (!(await resolveSupplierId(req.body.supplier))) {
      return res.status(400).json({
        success: false,
        message: 'supplier must be the id of an existing supplier',
      });
    }

    // createMedicine upserts by name, so two medicines must not share one
    if ($set.name !== undefined && $set.name !== medicine.name) {
      const clash = await Medicine.findOne({ name: $set.name, _id: { $ne: medicine._id } });
      if (clash) {
        return res.status(409).json({
          success: false,
          message: `Another medicine is already named "${$set.name}"`,
        });
      }
    }

    // Apply batch edits in place; batches not listed are left as they are
    let quantityDelta = 0;
    if (Array.isArray(batchUpdates) && batchUpdates.length > 0) {
      for (const update of batchUpdates) {
        const batch = update._id && medicine.batches.id(update._id);
        if (!batch) {
          return res.status(400).json({
            success: false,
            message: 'Each batch update needs the _id of an existing batch of this medicine',
          });
        }

        if (update.expiryDate !== undefined && isNaN(new Date(update.expiryDate))) {
          return res.status(400).json({
            success: false,
            message: `Batch ${batch.batchNumber}: expiryDate is not a valid date`,
          });
        }

        if (update.batchNumber !== undefined) batch.batchNumber = update.batchNumber;
        if (update.expiryDate !== undefined) batch.expiryDate = update.expiryDate;
        if (update.rackNumber !== undefined) batch.rackNumber = update.rackNumber;
        if (update.quantity !== undefined) {
          const newBatchQuantity = Number(update.quantity);
          if (!Number.isInteger(newBatchQuantity) || newBatchQuantity < 0) {
            return res.status(400).json({
              success: false,
              message: `Batch ${batch.batchNumber}: quantity must be a whole number of 0 or more`,
            });
          }
          quantityDelta += newBatchQuantity - batch.quantity;
          batch.quantity = newBatchQuantity;
        }
      }

      // Keep the add-stock rule meaningful: no two batches with the same number and expiry day
      const seen = new Set();
      for (const batch of medicine.batches) {
        const key = `${batch.batchNumber}|${new Date(batch.expiryDate).toISOString().slice(0, 10)}`;
        if (seen.has(key)) {
          return res.status(400).json({
            success: false,
            message: `Another batch already has number ${batch.batchNumber} with the same expiry date`,
          });
        }
        seen.add(key);
      }

      $set.batches = medicine.batches.map((b) => b.toObject());
    }

    // The total moves by exactly what the batches moved, so existing data isn't silently recomputed
    const newQuantity = medicine.quantity + quantityDelta;
    $set.quantity = newQuantity;
    $set.stockStatus = getStockStatus(newQuantity, $set.reorderLevel ?? medicine.reorderLevel);

    const updatedMedicine = await Medicine.findOneAndUpdate(
      { _id: medicine._id, __v: medicine.__v },
      { $set, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true }
    );

    if (!updatedMedicine) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: inventory was concurrently modified. Please reload and retry.',
      });
    }

    // Record stock corrections like any other adjustment
    if (quantityDelta !== 0) {
      await InventoryHistory.create({
        medicineId: medicine._id,
        medicineName: updatedMedicine.name,
        action: 'adjustment',
        quantityChanged: quantityDelta,
        previousQuantity: medicine.quantity,
        newQuantity,
        reason: reason || 'Edited in inventory form',
        performedBy: req.user.id,
      });
    }

    log('INFO', 'Medicine updated', { medicineId: id, quantityChanged: quantityDelta });

    res.status(200).json({
      success: true,
      message: 'Medicine updated successfully',
      medicine: updatedMedicine,
    });
  } catch (error) {
    log('ERROR', 'Update medicine error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error updating medicine',
      error: error.message,
    });
  }
};

// Delete medicine
export const deleteMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const medicine = await Medicine.findByIdAndDelete(id);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    log('INFO', 'Medicine deleted', { medicineId: id });
    res.status(200).json({
      success: true,
      message: 'Medicine deleted successfully',
    });
  } catch (error) {
    log('ERROR', 'Delete medicine error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error deleting medicine',
      error: error.message,
    });
  }
};

// Search medicines
export const searchMedicines = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
    }

    const medicines = await Medicine.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } },
        { "batches.batchNumber": { $regex: query, $options: 'i' } },
      ],
    }).lean();

    res.status(200).json({
      success: true,
      count: medicines.length,
      medicines
    });
  } catch (error) {
    log('ERROR', 'Search medicines error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error searching medicines',
      error: error.message,
    });
  }
};

// Get low stock medicines
export const getLowStockMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find({
      $expr: { $lte: ['$quantity', '$reorderLevel'] },
    }).lean();

    res.status(200).json({
      success: true,
      count: medicines.length,
      medicines,
    });
  } catch (error) {
    log('ERROR', 'Get low stock medicines error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching low stock medicines',
      error: error.message,
    });
  }
};

// Get near expiry medicines 
export const getNearExpiryMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find().lean();

    const nearExpiryMedicines = medicines.filter(m => {
      if (!m.batches || m.batches.length === 0) return false;
      return m.batches.some(b => isNearExpiry(b.expiryDate, 7));
    });

    res.status(200).json({
      success: true,
      count: nearExpiryMedicines.length,
      medicines: nearExpiryMedicines,
    });
  } catch (error) {
    log('ERROR', 'Get near expiry medicines error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching near expiry medicines',
      error: error.message,
    });
  }
};

// Get expired medicines
export const getExpiredMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find().lean();

    const expiredMedicines = medicines.filter(m => {
      if (!m.batches || m.batches.length === 0) return false;
      return m.batches.some(b => isExpired(b.expiryDate));
    });

    res.status(200).json({
      success: true,
      count: expiredMedicines.length,
      medicines: expiredMedicines,
    });
  } catch (error) {
    log('ERROR', 'Get expired medicines error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching expired medicines',
      error: error.message,
    });
  }
};

// Adjust medicine quantity via FEFO
export const adjustQuantity = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantityChanged, reason, batchNumber, expiryDate, rackNumber } = req.body;

    if (!quantityChanged) {
      return res.status(400).json({
        success: false,
        message: 'quantityChanged is required',
      });
    }

    // Added stock must say which batch it belongs to, so it lands on the right expiry
    if (Number(quantityChanged) > 0 && (!batchNumber || !expiryDate)) {
      return res.status(400).json({
        success: false,
        message: 'batchNumber and expiryDate are required when adding stock',
      });
    }

    const medicine = await Medicine.findById(id);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    const previousQuantity = medicine.quantity;
    const numChanged = Number(quantityChanged);

    // Validate we don't go below zero
    if (medicine.quantity + numChanged < 0) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient quantity',
      });
    }

    if (numChanged < 0) {
      // Deduct from batches using FEFO
      let remainingToDeduct = Math.abs(numChanged);

      // Sort batches ascending by expiry (oldest first)
      medicine.batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

      for (let batch of medicine.batches) {
        if (remainingToDeduct === 0) break;
        if (batch.quantity > 0) {
          const deduction = Math.min(batch.quantity, remainingToDeduct);
          batch.quantity -= deduction;
          remainingToDeduct -= deduction;
        }
      }
    } else {
      // Add to the batch with the same batch number and expiry, or start a new batch
      addStockToBatches(medicine.batches, {
        batchNumber, expiryDate, quantity: numChanged, rackNumber
      });
    }

    const newQuantity = medicine.quantity + numChanged;
    const newStockStatus = getStockStatus(newQuantity, medicine.reorderLevel);

    // Atomic conditional update with Optimistic Concurrency Control (OCC)
    const updateFilter = {
      _id: id,
      __v: medicine.__v,
      ...(numChanged < 0 ? { quantity: { $gte: Math.abs(numChanged) } } : {}),
    };

    const updatePayload = {
      $set: {
        quantity: newQuantity,
        batches: medicine.batches,
        stockStatus: newStockStatus,
      },
      $inc: { __v: 1 },
    };

    const updatedMedicine = await Medicine.findOneAndUpdate(updateFilter, updatePayload, { returnDocument: 'after' });

    if (!updatedMedicine) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: inventory was concurrently modified or quantity changed. Please retry.',
      });
    }

    await InventoryHistory.create({
      medicineId: id,
      medicineName: medicine.name,
      action: 'adjustment',
      quantityChanged: numChanged,
      previousQuantity,
      newQuantity,
      reason,
      performedBy: req.user.id,
    });

    log('INFO', 'Inventory adjusted via FEFO', { medicineId: id, quantityChanged: numChanged });

    res.status(200).json({
      success: true,
      message: 'Quantity adjusted successfully',
      medicine: updatedMedicine,
    });
  } catch (error) {
    log('ERROR', 'Adjust quantity error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error adjusting quantity',
      error: error.message,
    });
  }
};

// Get inventory history
export const getInventoryHistory = async (req, res) => {
  try {
    const { medicineId, action } = req.query;
    const filter = {};

    if (medicineId) filter.medicineId = medicineId;
    if (action) filter.action = action;

    const history = await InventoryHistory.find(filter)
      .populate('medicineId', 'name category')
      .populate('performedBy', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: history.length,
      history,
    });
  } catch (error) {
    log('ERROR', 'Get inventory history error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching inventory history',
      error: error.message,
    });
  }
};

// Get inventory intelligence
export const getInventoryIntelligence = async (req, res) => {
  try {
    const medicines = await Medicine.find();
    const history = await InventoryHistory.find({ action: 'sale' });

    const fastMoving = [];
    const slowMoving = [];
    const critical = [];
    const recommendations = [];

    medicines.forEach(medicine => {
      const medicineSales = history.filter(
        h => h.medicineId && h.medicineId.toString() === medicine._id.toString()
      );
      const totalSales = medicineSales.reduce((sum, h) => sum + Math.abs(h.quantityChanged), 0);

      const label = `${medicine.name} (Qty: ${medicine.quantity}, Sales: ${totalSales})`;

      if (totalSales > 50) {
        fastMoving.push(label);
      } else if (totalSales < 5) {
        slowMoving.push(label);
      }

      if (medicine.quantity <= medicine.reorderLevel / 2) {
        critical.push(`${medicine.name} — only ${medicine.quantity} left (reorder: ${medicine.reorderLevel})`);
        recommendations.push({
          medicine: medicine.name,
          action: 'Order Immediately',
          quantity: medicine.reorderLevel * 2 - medicine.quantity,
          priority: 'high',
        });
      } else if (medicine.quantity <= medicine.reorderLevel) {
        recommendations.push({
          medicine: medicine.name,
          action: 'Order Soon',
          quantity: medicine.reorderLevel - medicine.quantity,
          priority: 'medium',
        });
      } else if (totalSales < 5 && medicine.quantity > medicine.reorderLevel * 3) {
        recommendations.push({
          medicine: medicine.name,
          action: 'Reduce Procurement',
          quantity: null,
          priority: 'low',
        });
      }
    });

    res.status(200).json({
      success: true,
      data: {
        fastMoving,
        slowMoving,
        critical,
        recommendations,
      },
    });
  } catch (error) {
    log('ERROR', 'Get inventory intelligence error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching inventory intelligence',
      error: error.message,
    });
  }
};

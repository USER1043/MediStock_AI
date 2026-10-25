import { Medicine } from '../models/medicineModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import {
  sortByFEFO,
  isNearExpiry,
  isExpired,
  getStockStatus,
} from '../utils/helpers.js';
import log from '../utils/logger.js';

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
    const {
      name, category, batchNumber, expiryDate, quantity,
      purchasePrice, sellingPrice, rackNumber, reorderLevel, supplier
    } = req.body;

    if (!name || !category || !batchNumber || !expiryDate || !purchasePrice || !sellingPrice || !rackNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    const numQuantity = Number(quantity) || 0;
    const existingMedicine = await Medicine.findOne({ name });

    let returnedMedicine;

    if (existingMedicine) {
      // Check if batch already exists
      const existingBatch = existingMedicine.batches.find(b => b.batchNumber === batchNumber);
      if (existingBatch) {
        existingBatch.quantity += numQuantity;
        existingBatch.expiryDate = expiryDate;
        existingBatch.rackNumber = rackNumber;
      } else {
        existingMedicine.batches.push({
          batchNumber, expiryDate, quantity: numQuantity, rackNumber
        });
      }

      existingMedicine.quantity += numQuantity;
      existingMedicine.stockStatus = getStockStatus(existingMedicine.quantity, existingMedicine.reorderLevel);
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
        supplier: supplier || 'Default Supplier',
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

// Update medicine (Updates parent properties)
export const updateMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove immutable or deeply nested arrays from simple update payload
    delete updates.batches;

    const medicine = await Medicine.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    if (updates.quantity !== undefined || updates.reorderLevel !== undefined) {
      medicine.stockStatus = getStockStatus(medicine.quantity, medicine.reorderLevel);
      await medicine.save();
    }

    log('INFO', 'Medicine updated', { medicineId: id });

    res.status(200).json({
      success: true,
      message: 'Medicine updated successfully',
      medicine,
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
    const { quantityChanged, reason } = req.body;

    if (!quantityChanged) {
      return res.status(400).json({
        success: false,
        message: 'quantityChanged is required',
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
      // Add quantity to the newest batch
      medicine.batches.sort((a, b) => new Date(b.expiryDate) - new Date(a.expiryDate));
      if (medicine.batches.length > 0) {
        medicine.batches[0].quantity += numChanged;
      }
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

    const updatedMedicine = await Medicine.findOneAndUpdate(updateFilter, updatePayload, { new: true });

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

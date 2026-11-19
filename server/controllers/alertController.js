import { Alert } from '../models/alertModel.js';
import { Medicine } from '../models/medicineModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import { getExpiringBatches, describeBatches } from '../utils/helpers.js';
import log from '../utils/logger.js';

// Generate alerts
export const generateAlerts = async (req, res) => {
  try {
    const medicines = await Medicine.find();

    // Clear old alerts
    await Alert.deleteMany({ createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });

    const alerts = [];

    for (const medicine of medicines) {
      // Low stock alert
      if (medicine.quantity <= medicine.reorderLevel / 2) {
        const existingAlert = await Alert.findOne({
          medicineId: medicine._id,
          alertType: 'low_stock',
          isResolved: false,
        });

        if (!existingAlert) {
          const alert = await Alert.create({
            medicineId: medicine._id,
            medicineName: medicine.name,
            alertType: 'low_stock',
            message: `Stock going to less – Add stock immediately. Current: ${medicine.quantity}, Reorder Level: ${medicine.reorderLevel}`,
            severity: 'critical',
          });
          alerts.push(alert);
        }
      }

      // Expiry is tracked per batch, so check every batch still in stock
      const { nearExpiry, expired } = getExpiringBatches(medicine.batches, 7);

      // Near expiry alert
      if (nearExpiry.length > 0) {
        const existingAlert = await Alert.findOne({
          medicineId: medicine._id,
          alertType: 'near_expiry',
          isResolved: false,
        });

        if (!existingAlert) {
          const alert = await Alert.create({
            medicineId: medicine._id,
            medicineName: medicine.name,
            alertType: 'near_expiry',
            message: `Batches expiring within 7 days: ${describeBatches(nearExpiry)}`,
            severity: 'warning',
          });
          alerts.push(alert);
        }
      }

      // Expired alert
      if (expired.length > 0) {
        const existingAlert = await Alert.findOne({
          medicineId: medicine._id,
          alertType: 'expired',
          isResolved: false,
        });

        if (!existingAlert) {
          const alert = await Alert.create({
            medicineId: medicine._id,
            medicineName: medicine.name,
            alertType: 'expired',
            message: `Expired batches still in stock: ${describeBatches(expired)}`,
            severity: 'critical',
          });
          alerts.push(alert);
        }
      }

      // Overstock alert
      if (medicine.quantity > medicine.reorderLevel * 3) {
        const existingAlert = await Alert.findOne({
          medicineId: medicine._id,
          alertType: 'overstock',
          isResolved: false,
        });

        if (!existingAlert) {
          const alert = await Alert.create({
            medicineId: medicine._id,
            medicineName: medicine.name,
            alertType: 'overstock',
            message: `Overstock detected. Quantity: ${medicine.quantity}`,
            severity: 'info',
          });
          alerts.push(alert);
        }
      }
    }

    log('INFO', 'Alerts generated', { alertCount: alerts.length });

    res.status(200).json({
      success: true,
      message: `${alerts.length} new alerts generated`,
      alerts,
    });
  } catch (error) {
    log('ERROR', 'Generate alerts error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error generating alerts',
      error: error.message,
    });
  }
};

// Get all alerts
export const getAllAlerts = async (req, res) => {
  try {
    const { resolved } = req.query;

    const filter = {};
    if (resolved !== undefined) {
      filter.isResolved = resolved === 'true';
    }

    const alerts = await Alert.find(filter)
      .populate('medicineId', 'name category quantity')
      .sort({ severity: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    log('ERROR', 'Get all alerts error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching alerts',
      error: error.message,
    });
  }
};

// Get critical alerts
export const getCriticalAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find({
      severity: 'critical',
      isResolved: false,
    })
      .populate('medicineId', 'name category quantity')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    log('ERROR', 'Get critical alerts error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching critical alerts',
      error: error.message,
    });
  }
};

// Resolve alert
export const resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;

    const alert = await Alert.findByIdAndUpdate(
      id,
      { isResolved: true },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found',
      });
    }

    log('INFO', 'Alert resolved', { alertId: id });

    res.status(200).json({
      success: true,
      message: 'Alert resolved',
      alert,
    });
  } catch (error) {
    log('ERROR', 'Resolve alert error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error resolving alert',
      error: error.message,
    });
  }
};

// Get medicine recommendations
export const getMedicineRecommendations = async (req, res) => {
  try {
    const medicines = await Medicine.find();
    const history = await InventoryHistory.find({ action: 'sale' });

    const recommendations = medicines.map(medicine => {
      const medicineSales = history.filter(
        h => h.medicineId.toString() === medicine._id.toString()
      );
      const totalSales = medicineSales.reduce((sum, h) => sum + Math.abs(h.quantityChanged), 0);

      let recommendation = 'Monitor';
      if (medicine.quantity <= medicine.reorderLevel / 2) {
        recommendation = 'Order Immediately';
      } else if (totalSales > 50) {
        recommendation = 'Order Soon';
      } else if (totalSales < 5) {
        recommendation = 'Avoid Over Purchasing';
      }

      return {
        medicineId: medicine._id,
        name: medicine.name,
        currentStock: medicine.quantity,
        reorderLevel: medicine.reorderLevel,
        totalSales,
        recommendation,
      };
    });

    res.status(200).json({
      success: true,
      recommendations,
    });
  } catch (error) {
    log('ERROR', 'Get medicine recommendations error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Error fetching recommendations',
      error: error.message,
    });
  }
};

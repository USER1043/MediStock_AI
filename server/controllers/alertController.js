import mongoose from 'mongoose';
import { Alert } from '../models/alertModel.js';
import { Medicine } from '../models/medicineModel.js';
import { InventoryHistory } from '../models/inventoryHistoryModel.js';
import { alertService, compareAlerts } from '../services/alertService.js';
import { createAuditEntry } from '../middleware/auditLogger.js';
import log from '../utils/logger.js';
import { stockLevelOf } from '../utils/stockLevel.js';

// Alert generation itself lives in services/alertService.js; these handlers stay thin.
const ALERT_TYPES = ['low_stock', 'near_expiry', 'expired', 'overstock'];
const SEVERITIES = ['critical', 'warning', 'info'];

const MEDICINE_FIELDS = 'name category quantity';

const freshness = () => ({
  lastGeneratedAt: alertService.lastRunAt,
  refreshIntervalMinutes: alertService.staleAfterMs / 60000,
});

// POST /api/alerts/generate: force a run
export const generateAlerts = async (req, res) => {
  try {
    const { created, updated, autoResolved, pruned } = await alertService.generate();

    res.status(200).json({
      success: true,
      message: `${created.length} new alerts generated`,
      created: created.length,
      updated,
      autoResolved,
      pruned,
      alerts: created,
      ...freshness(),
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

// GET /api/alerts?resolved=true|false&type=&severity=
export const getAllAlerts = async (req, res) => {
  try {
    await alertService.refreshIfStale();

    const { resolved, type, severity } = req.query;

    const filter = {};
    if (resolved !== undefined) {
      filter.isResolved = resolved === 'true';
    }
    if (ALERT_TYPES.includes(type)) filter.alertType = type;
    if (SEVERITIES.includes(severity)) filter.severity = severity;

    const alerts = await Alert.find(filter).populate('medicineId', MEDICINE_FIELDS).lean();
    alerts.sort(compareAlerts);

    res.status(200).json({
      success: true,
      count: alerts.length,
      alerts,
      ...freshness(),
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

// GET /api/alerts/critical: unresolved critical alerts (drives the sidebar badge)
export const getCriticalAlerts = async (req, res) => {
  try {
    await alertService.refreshIfStale();

    const alerts = await Alert.find({
      severity: 'critical',
      isResolved: false,
    })
      .populate('medicineId', MEDICINE_FIELDS)
      .lean();
    alerts.sort(compareAlerts);

    res.status(200).json({
      success: true,
      count: alerts.length,
      alerts,
      ...freshness(),
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

// PUT /api/alerts/:id/resolve: a user acknowledges the alert.
// It stays the current alert for its medicine and type, so later runs don't raise it again
// until the situation changes (see alertService.acknowledgementCovers).
export const resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }

    const alert = await Alert.findOneAndUpdate(
      { _id: id, isResolved: false },
      {
        $set: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy: mongoose.isValidObjectId(req.user?.id) ? req.user.id : null,
          resolvedByName: req.user?.username || null,
          autoResolved: false,
        },
      },
      { returnDocument: 'after' }
    );

    if (!alert) {
      const exists = await Alert.exists({ _id: id });
      return res.status(exists ? 409 : 404).json({
        success: false,
        message: exists ? 'Alert is already resolved' : 'Alert not found',
      });
    }

    // The audit middleware skips this route; the entry is written here with the alert's details
    await createAuditEntry({
      userId: alert.resolvedBy,
      username: alert.resolvedByName || 'unknown',
      action: 'ALERT_RESOLVED',
      module: 'Alerts',
      details: {
        alertId: alert._id,
        medicineId: alert.medicineId,
        medicineName: alert.medicineName,
        alertType: alert.alertType,
        severity: alert.severity,
        message: alert.message,
      },
      ipAddress: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
      httpMethod: 'PUT',
      endpoint: req.originalUrl || `/api/alerts/${id}/resolve`,
      statusCode: 200,
    });

    log('INFO', 'Alert resolved', { alertId: id, by: alert.resolvedByName });

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
      const level = stockLevelOf(medicine);
      if (level === 'out' || level === 'critical') {
        recommendation = 'Order Immediately';
      } else if (level === 'low' || totalSales > 50) {
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

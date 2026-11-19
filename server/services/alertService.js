/**
 * @file Alert generation: evaluates every medicine, raises/updates/closes Alert documents,
 * prunes old history, and regenerates lazily when alerts are read.
 * @module services/alertService
 *
 * Freshness: the time of the last successful run is held **in memory, per Node process**.
 * A fresh process (restart, new serverless instance) therefore regenerates on its first read,
 * and two processes each keep their own clock; the partial unique index on Alert
 * (one current alert per medicine, type and batch) keeps concurrent runs from creating duplicates.
 * Stock-changing requests call `markStale()`, so the next read regenerates straight away
 * instead of waiting for the 15-minute window.
 */

import { Alert } from '../models/alertModel.js';
import { Medicine } from '../models/medicineModel.js';
import { getExpiringBatches } from '../utils/helpers.js';
import log from '../utils/logger.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Reads regenerate alerts when the last run is at least this old. */
export const DEFAULT_STALE_AFTER_MS = 15 * MINUTE;
/** Closed (resolved and no longer current) alerts are deleted this long after they closed. */
export const DEFAULT_RETENTION_MS = 90 * DAY;
/** Batches expiring within this many days raise a near_expiry alert. */
export const EXPIRY_WINDOW_DAYS = 7;

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (date) => new Date(date).toISOString().slice(0, 10);
// "23 Nov 2026"; expiry dates are stored as UTC midnight, so format in UTC
const formatDay = (date) => {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const batchSnapshot = (b) => ({
  batchNumber: b.batchNumber,
  expiryDate: b.expiryDate,
  rackNumber: b.rackNumber || 'N/A',
  quantity: b.quantity,
});
const sameList = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i]);
const idOf = (value) => (value ? value.toString() : '');
// Identifies "the same alert" across runs: one per medicine and type, and per batch for expiry alerts
const alertKey = (medicineId, alertType, batchId) => `${medicineId}:${alertType}:${idOf(batchId)}`;

const batchCondition = (alertType, batch) => {
  const where = `(rack ${batch.rackNumber || 'N/A'}, qty ${batch.quantity})`;
  return {
    alertType,
    severity: alertType === 'expired' ? 'critical' : 'warning',
    batchId: batch._id ?? null,
    batch: batchSnapshot(batch),
    // The expiry day: an edit updates an open alert (lastChangedAt) and re-raises an acknowledged one
    fingerprint: [dayOf(batch.expiryDate)],
    message:
      alertType === 'expired'
        ? `Batch ${batch.batchNumber} expired on ${formatDay(batch.expiryDate)} and is still in stock ${where}`
        : `Batch ${batch.batchNumber} expires on ${formatDay(batch.expiryDate)} ${where}`,
  };
};

/**
 * Lists the alert conditions that currently hold for one medicine: at most one low_stock and
 * one overstock, plus one near_expiry or expired condition per in-stock batch.
 * @returns {Array<{alertType, severity, message, fingerprint, batchId, batch}>}
 */
export const evaluateMedicine = (medicine, now = new Date()) => {
  const conditions = [];
  const { quantity = 0, reorderLevel = 0 } = medicine;

  if (quantity <= reorderLevel / 2) {
    const outOfStock = quantity <= 0;
    conditions.push({
      alertType: 'low_stock',
      severity: 'critical',
      fingerprint: [outOfStock ? 'out_of_stock' : 'low'],
      message: outOfStock
        ? `Out of stock – Add stock immediately. Reorder Level: ${reorderLevel}`
        : `Stock going to less – Add stock immediately. Current: ${quantity}, Reorder Level: ${reorderLevel}`,
      batchId: null,
      batch: null,
    });
  }

  const { nearExpiry, expired } = getExpiringBatches(medicine.batches, EXPIRY_WINDOW_DAYS, now);
  for (const batch of expired) conditions.push(batchCondition('expired', batch));
  for (const batch of nearExpiry) conditions.push(batchCondition('near_expiry', batch));

  if (quantity > reorderLevel * 3) {
    conditions.push({
      alertType: 'overstock',
      severity: 'info',
      fingerprint: ['overstock'],
      message: `Overstock detected. Quantity: ${quantity}`,
      batchId: null,
      batch: null,
    });
  }

  return conditions;
};

/**
 * Whether an acknowledged (user-resolved) alert still covers the current situation.
 * Batch alerts (near_expiry, expired): yes while the batch keeps the same expiry day (the
 * fingerprint), so sales and rack moves stay silent; an expiry edit is a new situation and
 * re-raises. Clearing and returning also re-raises (clearing closes the acknowledged alert).
 * Low stock: same level, or "out of stock" was acknowledged and stock is now merely low.
 * Overstock: presence only.
 */
export const acknowledgementCovers = (alertType, acknowledged = [], current = []) => {
  if (sameList(acknowledged, current)) return true;
  if (alertType === 'low_stock') {
    return acknowledged[0] === 'out_of_stock' && current[0] === 'low';
  }
  return false;
};

/**
 * One generation run. Raises, updates and closes alerts so they match the inventory at `now`,
 * then prunes closed alerts older than `retentionMs`.
 */
export const runAlertGeneration = async ({ now = new Date(), retentionMs = DEFAULT_RETENTION_MS } = {}) => {
  const [medicines, currentAlerts] = await Promise.all([
    Medicine.find().select('name quantity reorderLevel batches').lean(),
    Alert.find({ isCurrent: true }),
  ]);

  const currentByKey = new Map(currentAlerts.map((a) => [alertKey(a.medicineId, a.alertType, a.batchId), a]));
  const holding = new Set();
  const created = [];
  let updated = 0;
  let autoResolved = 0;

  for (const medicine of medicines) {
    for (const condition of evaluateMedicine(medicine, now)) {
      const key = alertKey(medicine._id, condition.alertType, condition.batchId);
      holding.add(key);
      const existing = currentByKey.get(key);

      if (existing && !existing.isResolved) {
        // Still open: keep one alert and refresh it rather than raising a duplicate
        const changed = !sameList(existing.fingerprint, condition.fingerprint);
        const stale =
          existing.message !== condition.message ||
          existing.severity !== condition.severity ||
          existing.medicineName !== medicine.name;
        if (changed || stale) {
          existing.set({
            message: condition.message,
            severity: condition.severity,
            fingerprint: condition.fingerprint,
            batch: condition.batch,
            medicineName: medicine.name,
          });
          if (changed) existing.lastChangedAt = now;
          await existing.save();
          updated++;
        }
        continue;
      }

      if (existing && acknowledgementCovers(condition.alertType, existing.fingerprint, condition.fingerprint)) {
        continue; // acknowledged, and nothing new since
      }

      if (existing) {
        // Acknowledged, but the situation changed: retire it as history (keeping the snapshot
        // that was acknowledged) and raise a new alert
        existing.isCurrent = false;
        await existing.save();
      }

      try {
        created.push(
          await Alert.create({
            medicineId: medicine._id,
            medicineName: medicine.name,
            alertType: condition.alertType,
            message: condition.message,
            severity: condition.severity,
            fingerprint: condition.fingerprint,
            batchId: condition.batchId,
            batch: condition.batch,
            isCurrent: true,
            lastChangedAt: now,
            createdAt: now,
          })
        );
      } catch (error) {
        // Another process raised the same alert between our read and write
        if (error.code !== 11000) throw error;
      }
    }
  }

  // Conditions that no longer hold (or whose medicine was deleted) close their alert
  for (const alert of currentAlerts) {
    if (holding.has(alertKey(alert.medicineId, alert.alertType, alert.batchId))) continue;
    alert.isCurrent = false;
    alert.clearedAt = now;
    if (!alert.isResolved) {
      alert.isResolved = true;
      alert.resolvedAt = now;
      alert.autoResolved = true;
      autoResolved++;
    }
    await alert.save();
  }

  // History: keep closed alerts for the retention period, measured from when they closed
  const cutoff = new Date(now.getTime() - retentionMs);
  const { deletedCount: pruned = 0 } = await Alert.deleteMany({
    isResolved: true,
    isCurrent: false,
    $or: [
      { clearedAt: { $lt: cutoff } },
      { clearedAt: null, resolvedAt: { $lt: cutoff } },
    ],
  });

  const summary = { created, updated, autoResolved, pruned, ranAt: now };
  log('INFO', 'Alerts generated', { created: created.length, updated, autoResolved, pruned });
  return summary;
};

/**
 * Wraps `runAlertGeneration` with in-memory freshness tracking. Concurrent callers share one
 * in-flight run. Options are injectable for tests.
 */
export const createAlertService = ({
  clock = () => new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  retentionMs = DEFAULT_RETENTION_MS,
} = {}) => {
  let lastRunAt = null;
  let inFlight = null;
  let dirty = false;

  const start = () => {
    if (inFlight) return inFlight;
    const startedAt = clock();
    dirty = false; // writes from here on mark it dirty again
    inFlight = runAlertGeneration({ now: startedAt, retentionMs })
      .then((summary) => {
        lastRunAt = startedAt;
        return summary;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const isStale = () => dirty || !lastRunAt || clock() - lastRunAt >= staleAfterMs;

  return {
    /** Regenerate now (waits for a run already in progress first, so the result is fresh). */
    async generate() {
      if (inFlight) await inFlight.catch(() => {});
      return start();
    },

    /**
     * Regenerate if stale; otherwise do nothing. Never throws: on failure the caller
     * serves the alerts already stored and the next read retries.
     * @returns {Promise<{ran: boolean, summary?: object, error?: Error}>}
     */
    async refreshIfStale() {
      if (!inFlight && !isStale()) return { ran: false };
      try {
        return { ran: true, summary: await start() };
      } catch (error) {
        log('ERROR', 'Lazy alert generation failed', { error: error.message });
        return { ran: false, error };
      }
    },

    /** Called after stock changes, so the next read regenerates. */
    markStale() {
      dirty = true;
    },

    get lastRunAt() {
      return lastRunAt;
    },

    get staleAfterMs() {
      return staleAfterMs;
    },

    /** Forget the last run (tests). */
    reset() {
      lastRunAt = null;
      dirty = false;
    },
  };
};

/** The process-wide service used by the routes. */
export const alertService = createAlertService();

/**
 * Express middleware for routers that change stock: after a successful write, mark alerts
 * stale so the next read regenerates them.
 */
export const markAlertsStaleOnWrite = (service = alertService) => (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => {
      if (res.statusCode < 400) service.markStale();
    });
  }
  next();
};

/** Unresolved first, then by severity, then most recently changed. */
export const compareAlerts = (a, b) =>
  Number(a.isResolved) - Number(b.isResolved) ||
  (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
  new Date(b.lastChangedAt || b.createdAt) - new Date(a.lastChangedAt || a.createdAt);

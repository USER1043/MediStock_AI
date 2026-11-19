/**
 * @file Alert generation: evaluates every medicine, raises/updates/closes Alert documents,
 * prunes old history, and regenerates lazily when alerts are read.
 * @module services/alertService
 *
 * Freshness: the time of the last successful run is held **in memory, per Node process**.
 * A fresh process (restart, new serverless instance) therefore regenerates on its first read,
 * and two processes each keep their own clock; the partial unique index on Alert
 * (one current alert per medicine and type) keeps concurrent runs from creating duplicates.
 * Stock-changing requests call `markStale()`, so the next read regenerates straight away
 * instead of waiting for the 15-minute window.
 */

import { Alert } from '../models/alertModel.js';
import { Medicine } from '../models/medicineModel.js';
import { getExpiringBatches, describeBatches } from '../utils/helpers.js';
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

const dayOf = (date) => new Date(date).toISOString().slice(0, 10);
const batchKey = (b) => `${b.batchNumber}@${dayOf(b.expiryDate)}`;
const batchSnapshot = (b) => ({
  batchNumber: b.batchNumber,
  expiryDate: b.expiryDate,
  rackNumber: b.rackNumber || 'N/A',
  quantity: b.quantity,
});
const sortedUnique = (values) => [...new Set(values)].sort();
const sameList = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i]);
const pairKey = (medicineId, alertType) => `${medicineId}:${alertType}`;

/**
 * Lists the alert conditions that currently hold for one medicine.
 * @returns {Array<{alertType, severity, message, fingerprint, batches}>}
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
      batches: [],
    });
  }

  const { nearExpiry, expired } = getExpiringBatches(medicine.batches, EXPIRY_WINDOW_DAYS, now);
  if (nearExpiry.length > 0) {
    conditions.push({
      alertType: 'near_expiry',
      severity: 'warning',
      fingerprint: sortedUnique(nearExpiry.map(batchKey)),
      message: `Batches expiring within ${EXPIRY_WINDOW_DAYS} days: ${describeBatches(nearExpiry)}`,
      batches: nearExpiry.map(batchSnapshot),
    });
  }
  if (expired.length > 0) {
    conditions.push({
      alertType: 'expired',
      severity: 'critical',
      fingerprint: sortedUnique(expired.map(batchKey)),
      message: `Expired batches still in stock: ${describeBatches(expired)}`,
      batches: expired.map(batchSnapshot),
    });
  }

  if (quantity > reorderLevel * 3) {
    conditions.push({
      alertType: 'overstock',
      severity: 'info',
      fingerprint: ['overstock'],
      message: `Overstock detected. Quantity: ${quantity}`,
      batches: [],
    });
  }

  return conditions;
};

/**
 * Whether an acknowledged (user-resolved) alert still covers the current situation, i.e.
 * nothing new or worse has happened since. Expiry: no batch outside the acknowledged set
 * (batches selling out is not news). Low stock: same level, or "out of stock" was
 * acknowledged and stock is now merely low. Overstock: presence only.
 */
export const acknowledgementCovers = (alertType, acknowledged = [], current = []) => {
  if (sameList(acknowledged, current)) return true;
  if (alertType === 'near_expiry' || alertType === 'expired') {
    const seen = new Set(acknowledged);
    return current.every((key) => seen.has(key));
  }
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

  const currentByPair = new Map(currentAlerts.map((a) => [pairKey(a.medicineId, a.alertType), a]));
  const holding = new Set();
  const created = [];
  let updated = 0;
  let autoResolved = 0;

  for (const medicine of medicines) {
    for (const condition of evaluateMedicine(medicine, now)) {
      const key = pairKey(medicine._id, condition.alertType);
      holding.add(key);
      const existing = currentByPair.get(key);

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
            batches: condition.batches,
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
        // Acknowledged, but the situation changed: retire it and raise a new alert
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
            batches: condition.batches,
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
    if (holding.has(pairKey(alert.medicineId, alert.alertType))) continue;
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

/**
 * @file Schema and model for inventory Alerts.
 * @module models/alertModel
 *
 * Alerts are created, updated and closed by `services/alertService.js`. Lifecycle:
 * - `isCurrent: true` marks the one alert that describes the ongoing situation for a
 *   (medicine, alertType, batchId). Expiry alerts (near_expiry, expired) are per batch;
 *   low_stock and overstock are per medicine (batchId null). A partial unique index
 *   enforces at most one current alert per key.
 * - A user resolving it (`resolvedBy`) acknowledges that situation: it stays current and
 *   stops new alerts. A batch alert stays quiet until its expiry date is edited or its
 *   condition clears and returns; low_stock until it gets worse (low -> critical -> out) or
 *   clears and returns.
 * - When the condition stops holding, the alert is closed (`isCurrent: false`, `clearedAt`);
 *   if nobody had resolved it, the system resolves it (`autoResolved: true`).
 * - When an acknowledged situation changes, the old alert is closed (`isCurrent: false`)
 *   and a new current alert is raised.
 */

import mongoose from 'mongoose';

const alertBatchSchema = new mongoose.Schema(
  {
    batchNumber: String,
    expiryDate: Date,
    rackNumber: String,
    quantity: Number,
  },
  { _id: false }
);

const alertSchema = new mongoose.Schema(
  {
    medicineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
    },
    medicineName: String,
    alertType: {
      type: String,
      enum: ['low_stock', 'near_expiry', 'expired', 'overstock'],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    severity: {
      type: String,
      enum: ['critical', 'warning', 'info'],
      default: 'warning',
    },
    // Compared between runs: expiry alerts -> [expiry day "YYYY-MM-DD"] (a change updates an
    // open alert's lastChangedAt, and re-raises an acknowledged one), low_stock -> the stock level ['out' | 'critical' | 'low'] (utils/stockLevel.js), overstock -> ['overstock']
    fingerprint: {
      type: [String],
      default: [],
    },
    // The batch subdocument (_id within Medicine.batches) an expiry alert is about; null otherwise
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Snapshot of that batch for display, refreshed while the alert is open; null for stock alerts
    batch: {
      type: alertBatchSchema,
      default: null,
    },
    // True while this alert describes the ongoing situation for its (medicine, alertType)
    isCurrent: {
      type: Boolean,
      default: true,
    },
    // When the situation last changed (creation, or a fingerprint change while unresolved)
    lastChangedAt: {
      type: Date,
      default: Date.now,
    },
    isResolved: {
      type: Boolean,
      default: false,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    // Set when a user resolved (acknowledged) it; null when the system resolved it
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedByName: {
      type: String,
      default: null,
    },
    // True when the system resolved it because the condition no longer held
    autoResolved: {
      type: Boolean,
      default: false,
    },
    // When the system saw the condition stop holding (set for user-resolved alerts too)
    clearedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// At most one current alert per medicine, type and batch (null for stock alerts),
// even if two processes generate at once
alertSchema.index(
  { medicineId: 1, alertType: 1, batchId: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true }, name: 'one_current_alert_per_medicine_type_batch' }
);
alertSchema.index({ isResolved: 1, severity: 1 });

export const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);

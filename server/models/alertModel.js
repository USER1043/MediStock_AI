/**
 * @file Schema and model for inventory Alerts.
 * @module models/alertModel
 *
 * Alerts are created, updated and closed by `services/alertService.js`. Lifecycle:
 * - `isCurrent: true` marks the one alert that describes the ongoing situation for a
 *   (medicine, alertType) pair. A partial unique index enforces at most one.
 * - A user resolving it (`resolvedBy`) acknowledges that situation: it stays current and
 *   stops new alerts until the situation changes (see `fingerprint`).
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
    // What the alert is about, compared between runs to tell "same situation" from "changed":
    // expiry alerts -> the affected batches ("<batchNumber>@<YYYY-MM-DD>"),
    // low_stock -> ['low'] or ['out_of_stock'], overstock -> ['overstock']
    fingerprint: {
      type: [String],
      default: [],
    },
    // Snapshot of the affected batches (expiry alerts only), for display
    batches: {
      type: [alertBatchSchema],
      default: [],
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

// At most one current alert per medicine and type, even if two processes generate at once
alertSchema.index(
  { medicineId: 1, alertType: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true }, name: 'one_current_alert_per_medicine_type' }
);
alertSchema.index({ isResolved: 1, severity: 1 });

export const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);

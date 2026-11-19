/**
 * @file Schema and model for Medicine inventory items.
 * @module models/medicineModel
 */

import mongoose from 'mongoose';
import { STOCK_LEVELS, getStockLevel } from '../utils/stockLevel.js';

const medicineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
    },
    batches: [
      {
        batchNumber: { type: String, required: true },
        expiryDate: { type: Date, required: true },
        quantity: { type: Number, required: true, default: 0 },
        rackNumber: { type: String, required: true },
      }
    ],
    reorderLevel: {
      type: Number,
      default: 50,
    },
    purchasePrice: {
      type: Number,
      required: true,
    },
    sellingPrice: {
      type: Number,
      required: true,
    },
    stockStatus: {
      type: String,
      // Derived from quantity vs reorderLevel (utils/stockLevel.js); recomputed on every save below
      enum: STOCK_LEVELS,
      default: 'out',
    },
    // The _id of a Supplier, as a string (the controllers check it exists). Older records may hold a name.
    supplier: {
      type: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Document saves (create, upload import, PO receipt, seeds) keep stockStatus in step with
// quantity and reorderLevel. Query updates (billing, adjust, edit) set it explicitly.
medicineSchema.pre('validate', function () {
  this.stockStatus = getStockLevel(this.quantity, this.reorderLevel);
});

// Index for FEFO sorting
medicineSchema.index({ expiryDate: 1 });

export const Medicine = mongoose.models.Medicine || mongoose.model('Medicine', medicineSchema);

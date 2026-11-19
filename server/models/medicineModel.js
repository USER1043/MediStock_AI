/**
 * @file Schema and model for Medicine inventory items.
 * @module models/medicineModel
 */

import mongoose from 'mongoose';

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
      enum: ['low', 'medium', 'high'],
      default: 'medium',
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

// Index for FEFO sorting
medicineSchema.index({ expiryDate: 1 });

export const Medicine = mongoose.models.Medicine || mongoose.model('Medicine', medicineSchema);

/**
 * @file Schema and model for system AuditLogs.
 * @module models/auditLogModel
 */

import mongoose from 'mongoose';

// Keep in step with src/pages/ActivityLog.jsx (ACTION_OPTIONS, MODULE_OPTIONS). Values are only
// ever added: removing one would make older entries fail validation.
export const AUDIT_ACTIONS = [
  // Users
  'USER_LOGIN',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'TWO_FA_ENABLED',
  // Inventory
  'MEDICINE_CREATED',
  'MEDICINE_UPDATED',
  'MEDICINE_DELETED',
  'STOCK_UPDATE',
  'EXCEL_UPLOAD',
  // Billing
  'BILL_GENERATED',
  'PAYMENT_CONFIRMED',
  // Customers
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'CUSTOMER_DELETED',
  // Suppliers and orders
  'SUPPLIER_CREATED',
  'SUPPLIER_UPDATED',
  'REORDER_GENERATED',
  'ORDER_CREATED',
  'ORDER_STATUS_UPDATE',
  // Categories
  'CATEGORY_CREATED',
  'CATEGORY_APPROVED',
  // Forecasting
  'FORECAST_RUN',
  'MODEL_RETRAINED',
  'FORECAST_SETTINGS_UPDATED',
  'RECOMMENDATION_CREATED',
  'RECOMMENDATION_UPDATED',
  'RECOMMENDATION_DELETED',
  'REORDER_APPROVED',
  // Alerts
  'ALERT_RESOLVED',
  // System
  'TEMPORAL_REFRESH', // written by seedFiles/seedTemporal.js
  'DELETE', // generic delete, used by older entries
  'OTHER',
];

export const AUDIT_MODULES = [
  'Inventory',
  'Billing',
  'Customers',
  'UserManagement',
  'DataImport',
  'Alerts',
  'Orders',
  'Suppliers',
  'Categories',
  'Forecasting',
  'System',
];

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    username: {
      type: String,
      default: 'system',
    },
    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      default: 'OTHER',
    },
    module: {
      type: String,
      enum: AUDIT_MODULES,
      default: 'System',
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: 'unknown',
    },
    httpMethod: {
      type: String,
      default: '',
    },
    endpoint: {
      type: String,
      default: '',
    },
    statusCode: {
      type: Number,
      default: 200,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

// Index for fast filtering by common query patterns
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ module: 1, timestamp: -1 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

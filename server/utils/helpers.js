import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Generate JWT token
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// Get days until expiry (`now` can be passed in so callers and tests share one clock)
export const getDaysUntilExpiry = (expiryDate, now = new Date()) => {
  const expiry = new Date(expiryDate);
  const diffTime = expiry - new Date(now);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Get stock status
export const getStockStatus = (quantity, reorderLevel) => {
  if (quantity <= reorderLevel / 2) return 'low';
  if (quantity <= reorderLevel) return 'medium';
  return 'high';
};

// Compare two dates by calendar day (UTC), ignoring time of day
export const isSameExpiryDay = (a, b) => {
  const dayA = new Date(a);
  const dayB = new Date(b);
  if (isNaN(dayA) || isNaN(dayB)) return false;
  return dayA.toISOString().slice(0, 10) === dayB.toISOString().slice(0, 10);
};

// Add incoming stock to a medicine's batches. A batch is reused only when both its
// batch number and expiry day match; otherwise a new batch is created, so units with
// different expiry dates are never merged (and an existing batch's expiry is never overwritten)
export const addStockToBatches = (batches, { batchNumber, expiryDate, quantity, rackNumber }) => {
  const existing = batches.find(
    (b) => b.batchNumber === batchNumber && isSameExpiryDay(b.expiryDate, expiryDate)
  );

  if (existing) {
    existing.quantity += quantity;
    if (rackNumber) existing.rackNumber = rackNumber;
    return { batch: existing, created: false };
  }

  batches.push({ batchNumber, expiryDate, quantity, rackNumber: rackNumber || 'N/A' });
  return { batch: batches[batches.length - 1], created: true };
};

// FEFO sorting - sort by expiry date (ascending)
export const sortByFEFO = (medicines) => {
  return medicines.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
};

// Check if medicine is near expiry (within 7 days)
export const isNearExpiry = (expiryDate, days = 7, now = new Date()) => {
  const daysLeft = getDaysUntilExpiry(expiryDate, now);
  return daysLeft <= days && daysLeft > 0;
};

// Check if medicine is expired
export const isExpired = (expiryDate, now = new Date()) => {
  return getDaysUntilExpiry(expiryDate, now) <= 0;
};

// Split a medicine's in-stock batches into near-expiry and expired groups.
// Expiry lives on each batch, not on the medicine itself.
export const getExpiringBatches = (batches, days = 7, now = new Date()) => {
  const inStock = (batches || []).filter(b => b.quantity > 0 && b.expiryDate);
  return {
    nearExpiry: inStock.filter(b => isNearExpiry(b.expiryDate, days, now)),
    expired: inStock.filter(b => isExpired(b.expiryDate, now)),
  };
};

// Describe batches for alert messages, e.g. "B12 (exp 3/5/2026, rack A1, qty 20)"
export const describeBatches = (batches) =>
  batches
    .map(b => `${b.batchNumber} (exp ${new Date(b.expiryDate).toLocaleDateString()}, rack ${b.rackNumber || 'N/A'}, qty ${b.quantity})`)
    .join('; ');

// Detect anomalies in uploaded data
export const detectAnomalies = (data) => {
  const anomalies = [];

  data.forEach((row, index) => {
    if (row.quantity < 0) {
      anomalies.push({
        row: index + 1,
        field: 'quantity',
        issue: 'Negative quantity detected',
      });
    }

    if (row.quantity > 100000) {
      anomalies.push({
        row: index + 1,
        field: 'quantity',
        issue: 'Unusually high stock quantity',
      });
    }

    if (new Date(row.expiryDate) < new Date()) {
      anomalies.push({
        row: index + 1,
        field: 'expiryDate',
        issue: 'Expiry date in the past',
      });
    }

    if (row.sellingPrice < row.purchasePrice) {
      anomalies.push({
        row: index + 1,
        field: 'price',
        issue: 'Selling price is less than purchase price',
      });
    }
  });

  return anomalies;
};

// Format currency
export const formatCurrency = (amount) => {
  return `₹${parseFloat(amount).toFixed(2)}`;
};

// Generate bill number
export const generateBillNumber = () => {
  return `BILL-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

// Calculate demand forecast (mock)
export const calculateDemandForecast = (salesData, days = 7) => {
  if (salesData.length === 0) return [];

  const avgDaily = salesData.reduce((sum, item) => sum + item.quantity, 0) / salesData.length;
  const forecast = [];

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    forecast.push({
      date: date.toISOString().split('T')[0],
      predicted: Math.ceil(avgDaily * (0.8 + Math.random() * 0.4)), // ±20% variation
      actual: null,
    });
  }

  return forecast;
};

// Classify medicine movement
export const classifyMovement = (medicineId, salesData) => {
  const medicineSales = salesData.filter(s => s.medicineId === medicineId);
  const totalSales = medicineSales.reduce((sum, s) => sum + s.quantity, 0);

  if (totalSales > 100) return 'fast_moving';
  if (totalSales < 10) return 'slow_moving';
  return 'normal';
};

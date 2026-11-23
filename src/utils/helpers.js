/**
 * @file Helper utilities and shared constants for MediStock.
 * @module utils/helpers
 */
import { getStockLevel, isLowStock, STOCK_LEVEL_META } from './stockLevel';
import { daysUntilExpiry } from './expiry';

/**
 * Days until expiry, counted as the server does (utils/expiry.js): expiry day minus today in IST.
 */
export const getDaysUntilExpiry = (expiryDate) => daysUntilExpiry(expiryDate);

/**
 * Get expiry status with color coding
 */
export const getExpiryStatus = (expiryDate) => {
  const days = getDaysUntilExpiry(expiryDate);

  // Expired from 00:00 IST on the expiry day (days === 0), as on the server
  if (days <= 0) {
    return { status: 'expired', color: 'red', label: 'Expired', days };
  } else if (days <= 30) {
    return { status: 'critical', color: 'red', label: 'Expires Soon', days };
  } else if (days <= 90) {
    return { status: 'warning', color: 'yellow', label: 'Near Expiry', days };
  }
  return { status: 'good', color: 'green', label: 'Good', days };
};

/**
 * Get stock status based on quantity and reorder level ({ status, color, label }).
 * The levels are defined in ./stockLevel.js, mirroring the server.
 */
export const getStockStatus = (quantity, reorderLevel) => {
  const status = getStockLevel(quantity, reorderLevel);
  const { color, label } = STOCK_LEVEL_META[status];
  return { status, color, label };
};

/**
 * Format currency
 */
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(amount);
};

/**
 * Format date
 */
export const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Format date and time
 */
export const formatDateTime = (date) => {
  return new Date(date).toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Sort medicines by FEFO (First Expiry First Out) using primary batch
 */
export const sortByFEFO = (medicines) => {
  return [...medicines].sort((a, b) => {
    const aExpiry = (a.batches && a.batches.length > 0) ? new Date(a.batches[0].expiryDate) : new Date('2099-12-31');
    const bExpiry = (b.batches && b.batches.length > 0) ? new Date(b.batches[0].expiryDate) : new Date('2099-12-31');
    return aExpiry - bExpiry;
  });
};

/**
 * Filter medicines by search query gracefully handling batches
 */
export const filterMedicines = (medicines, searchQuery) => {
  if (!searchQuery) return medicines;

  const query = searchQuery.toLowerCase();
  return medicines.filter(med => {
    const matchesName = med.name.toLowerCase().includes(query);
    const matchesCategory = med.category.toLowerCase().includes(query);

    // Check if ANY batch matches the search criteria
    const matchesBatch = med.batches && med.batches.some(b =>
      (b.batchNumber && b.batchNumber.toLowerCase().includes(query)) ||
      (b.rackNumber && b.rackNumber.toLowerCase().includes(query))
    );

    return matchesName || matchesCategory || matchesBatch;
  });
};

/**
 * Get dashboard KPIs based on cumulative batch totals and closest expiry
 */
export const calculateKPIs = (medicines) => {
  const total = medicines.length;
  const lowStock = medicines.filter(m => isLowStock(m.quantity, m.reorderLevel)).length;

  // Expiry is relative to the absolute closest batch for any medicine
  const nearExpiry = medicines.filter(m => {
    if (!m.batches || m.batches.length === 0) return false;
    // Sort batches inside to find closest expiry for this med
    const closestBatch = [...m.batches].sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];
    const status = getExpiryStatus(closestBatch.expiryDate);
    return status.status === 'critical' || status.status === 'warning';
  }).length;

  const expired = medicines.filter(m => {
    if (!m.batches || m.batches.length === 0) return false;
    const closestBatch = [...m.batches].sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];
    return getExpiryStatus(closestBatch.expiryDate).status === 'expired';
  }).length;

  return { total, lowStock, nearExpiry, expired };
};

/**
 * Generate bill number
 */
export const generateBillNumber = () => {
  const timestamp = Date.now();
  return `BILL${timestamp.toString().slice(-6)}`;
};

/**
 * Calculate bill totals
 */
export const calculateBillTotals = (items) => {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const tax = subtotal * 0.1; // 10% tax
  const total = subtotal + tax;

  return { subtotal, tax, total };
};

/**
 * @file Stock levels, mirrored from server/utils/stockLevel.js (keep the two in step).
 * @module utils/stockLevel
 *
 * - out      : quantity <= 0
 * - critical : 0 < quantity <= reorderLevel / 2
 * - low      : reorderLevel / 2 < quantity <= reorderLevel
 * - ok       : quantity > reorderLevel
 *
 * "Low stock" = out + critical + low (quantity <= reorderLevel). A missing, zero or negative
 * reorderLevel counts as 0 (only out of stock is flagged); a missing or non-numeric quantity counts as 0.
 */

const toQuantity = (value) => {
  const n = Number(value ?? 0);
  return Number.isNaN(n) ? 0 : n;
};

const toReorderLevel = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const getStockLevel = (quantity, reorderLevel) => {
  const q = toQuantity(quantity);
  const r = toReorderLevel(reorderLevel);
  if (q <= 0) return 'out';
  if (q <= r / 2) return 'critical';
  if (q <= r) return 'low';
  return 'ok';
};

export const isLowStock = (quantity, reorderLevel) => getStockLevel(quantity, reorderLevel) !== 'ok';

/** Display metadata per level (label, Tailwind badge classes). */
export const STOCK_LEVEL_META = {
  out: { label: 'Out of Stock', color: 'red', badge: 'bg-red-100 text-red-700' },
  critical: { label: 'Critically Low', color: 'red', badge: 'bg-red-100 text-red-700' },
  low: { label: 'Low Stock', color: 'yellow', badge: 'bg-yellow-100 text-yellow-700' },
  ok: { label: 'In Stock', color: 'green', badge: 'bg-green-100 text-green-700' },
};

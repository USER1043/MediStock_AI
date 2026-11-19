/**
 * @file The one definition of stock levels. Every server path that asks "is this low stock?"
 * (stored stockStatus, dashboard counts, low-stock lists, alerts, reorder suggestions, chatbot)
 * goes through here. The frontend mirrors it in src/utils/stockLevel.js.
 * @module utils/stockLevel
 *
 * - out      : quantity <= 0
 * - critical : 0 < quantity <= reorderLevel / 2
 * - low      : reorderLevel / 2 < quantity <= reorderLevel
 * - ok       : quantity > reorderLevel
 *
 * "Low stock" (counts, lists, filters, alerts) means out + critical + low, i.e. quantity <= reorderLevel.
 * A missing, zero, negative or non-numeric reorderLevel counts as 0: only quantity <= 0 (out) is flagged.
 * A missing or non-numeric quantity counts as 0 (out), so bad data is surfaced rather than hidden.
 */

/** Stored values of Medicine.stockStatus, most urgent first. */
export const STOCK_LEVELS = ['out', 'critical', 'low', 'ok'];

/** The levels that count as "low stock" (at or below the reorder level). */
export const LOW_STOCK_LEVELS = ['out', 'critical', 'low'];

/** Lower rank = more urgent. */
export const STOCK_LEVEL_RANK = { out: 0, critical: 1, low: 2, ok: 3 };

const toQuantity = (value) => {
  const n = Number(value ?? 0);
  return Number.isNaN(n) ? 0 : n;
};

const toReorderLevel = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param {number} quantity
 * @param {number} reorderLevel
 * @returns {'out'|'critical'|'low'|'ok'}
 */
export const getStockLevel = (quantity, reorderLevel) => {
  const q = toQuantity(quantity);
  const r = toReorderLevel(reorderLevel);
  if (q <= 0) return 'out';
  if (q <= r / 2) return 'critical';
  if (q <= r) return 'low';
  return 'ok';
};

/** quantity <= reorderLevel (out, critical or low). */
export const isLowStock = (quantity, reorderLevel) =>
  LOW_STOCK_LEVELS.includes(getStockLevel(quantity, reorderLevel));

/** Convenience for medicine documents / lean objects. */
export const stockLevelOf = (medicine) => getStockLevel(medicine?.quantity, medicine?.reorderLevel);
export const isMedicineLowStock = (medicine) => isLowStock(medicine?.quantity, medicine?.reorderLevel);

/** Low-stock medicines, most urgent first (level, then quantity relative to reorder level, then name). */
export const sortByUrgency = (medicines) => {
  const ratio = (m) => {
    const r = toReorderLevel(m.reorderLevel);
    return r > 0 ? toQuantity(m.quantity) / r : toQuantity(m.quantity);
  };
  return [...medicines].sort(
    (a, b) =>
      STOCK_LEVEL_RANK[stockLevelOf(a)] - STOCK_LEVEL_RANK[stockLevelOf(b)] ||
      ratio(a) - ratio(b) ||
      String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
};

/** Counts per level, plus lowStock = out + critical + low. */
export const countStockLevels = (medicines) => {
  const counts = { out: 0, critical: 0, low: 0, ok: 0 };
  for (const m of medicines) counts[stockLevelOf(m)]++;
  return { ...counts, lowStock: counts.out + counts.critical + counts.low };
};

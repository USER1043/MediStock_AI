/**
 * @file Read-only inventory tools the chatbot model can call (Gemini function calling), instead of
 * receiving the whole inventory in its prompt. Each tool runs one small query and returns a compact,
 * capped JSON result, so a question costs only the data it needs.
 * @module services/chatbotTools
 *
 * Stock and expiry use the same rules as the rest of the app: utils/stockLevel.js and utils/expiry.js.
 * A batch is "active" (sellable) when it has stock left and has not expired (from 00:00 IST on its
 * expiry day); a medicine is in stock only if it has an active batch.
 */
import { Medicine } from '../models/medicineModel.js';
import { Bill } from '../models/billModel.js';
import { daysUntilExpiry, SHOP_UTC_OFFSET_MINUTES } from '../utils/expiry.js';
import { getStockLevel, isMedicineLowStock, STOCK_LEVEL_RANK } from '../utils/stockLevel.js';

/** At most this many medicines or batches in one tool result. */
export const MAX_RESULTS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHOP_OFFSET_MS = SHOP_UTC_OFFSET_MINUTES * 60 * 1000;
const FIELDS = 'name category quantity reorderLevel sellingPrice batches';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const day = (date) => new Date(date).toISOString().slice(0, 10);
const text = (value, max = 60) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// The compact shape the model sees for one medicine
const describeMedicine = (m, now) => {
  const activeBatches = (m.batches || [])
    .filter((b) => b.quantity > 0 && daysUntilExpiry(b.expiryDate, now) > 0)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
    .map((b) => ({
      batch: b.batchNumber,
      rack: b.rackNumber || 'N/A',
      quantity: b.quantity,
      expiry: day(b.expiryDate),
      daysLeft: daysUntilExpiry(b.expiryDate, now),
    }));
  const expiredStock = (m.batches || [])
    .filter((b) => b.quantity > 0 && daysUntilExpiry(b.expiryDate, now) <= 0)
    .reduce((sum, b) => sum + b.quantity, 0);
  return {
    name: m.name,
    category: m.category || 'N/A',
    inStock: activeBatches.length > 0,
    sellableQuantity: activeBatches.reduce((sum, b) => sum + b.quantity, 0),
    ...(expiredStock > 0 && { expiredQuantityStillOnShelf: expiredStock }),
    totalQuantity: m.quantity,
    reorderLevel: m.reorderLevel,
    stockLevel: getStockLevel(m.quantity, m.reorderLevel),
    price: m.sellingPrice,
    activeBatches,
  };
};

const capped = (key, items) => ({
  [key]: items.slice(0, MAX_RESULTS),
  ...(items.length > MAX_RESULTS && { truncated: true, total: items.length }),
});

// ── Tools ────────────────────────────────────────────────────────────────

/** Medicines whose name contains `query` (case-insensitive), optionally within one category; or every medicine of a category. */
const searchMedicines = async ({ query, category } = {}, now) => {
  const q = text(query);
  const cat = text(category);
  if (!q && !cat) return { error: 'query or category is required' };
  const filter = {};
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  if (cat) filter.category = { $regex: `^${escapeRegex(cat)}$`, $options: 'i' };
  const medicines = await Medicine.find(filter, FIELDS).sort({ name: 1 }).limit(MAX_RESULTS + 1).lean();
  return { query: q, ...capped('medicines', medicines.map((m) => describeMedicine(m, now))) };
};

/** In-stock medicines in a category, most stock first: alternatives for an unavailable medicine. */
const findAlternatives = async ({ category, exclude } = {}, now) => {
  const cat = text(category);
  if (!cat) return { error: 'category is required' };
  const filter = { category: { $regex: `^${escapeRegex(cat)}$`, $options: 'i' } };
  const ex = text(exclude);
  if (ex) filter.name = { $not: new RegExp(escapeRegex(ex), 'i') };
  const medicines = (await Medicine.find(filter, FIELDS).lean())
    .map((m) => describeMedicine(m, now))
    .filter((m) => m.inStock)
    .sort((a, b) => b.sellableQuantity - a.sellableQuantity);
  return { category: cat, ...capped('alternatives', medicines) };
};

/** Medicines at or below their reorder level, most urgent first. */
const listLowStock = async (_args, now) => {
  const medicines = (await Medicine.find({}, FIELDS).lean())
    .filter(isMedicineLowStock)
    .map((m) => describeMedicine(m, now))
    .sort((a, b) => STOCK_LEVEL_RANK[a.stockLevel] - STOCK_LEVEL_RANK[b.stockLevel] || a.totalQuantity - b.totalQuantity)
    .map(({ name, category, totalQuantity, reorderLevel, stockLevel, activeBatches }) => ({
      name, category, totalQuantity, reorderLevel, stockLevel, rack: activeBatches[0]?.rack || 'N/A',
    }));
  return capped('lowStock', medicines);
};

/** Batches with stock that have expired or expire within `days` days, soonest first. */
const listExpiringBatches = async ({ days } = {}, now) => {
  const window = Math.min(Math.max(Number.isFinite(Number(days)) ? Math.round(Number(days)) : 30, 1), 180);
  // Rough prefilter in the database (one spare day each side of the IST boundary), exact rule below
  const cutoff = new Date(now.getTime() + (window + 2) * DAY_MS);
  const medicines = await Medicine.find(
    { batches: { $elemMatch: { quantity: { $gt: 0 }, expiryDate: { $lte: cutoff } } } },
    'name category batches'
  ).lean();
  const batches = medicines
    .flatMap((m) => (m.batches || []).map((b) => ({ m, b, daysLeft: daysUntilExpiry(b.expiryDate, now) })))
    .filter(({ b, daysLeft }) => b.quantity > 0 && daysLeft <= window)
    .sort((x, y) => x.daysLeft - y.daysLeft)
    .map(({ m, b, daysLeft }) => ({
      medicine: m.name,
      category: m.category || 'N/A',
      batch: b.batchNumber,
      rack: b.rackNumber || 'N/A',
      quantity: b.quantity,
      expiry: day(b.expiryDate),
      daysLeft,
      status: daysLeft <= 0 ? 'expired' : 'near_expiry',
    }));
  return { windowDays: window, ...capped('batches', batches) };
};

/** Counts across the inventory, the category list, and today's sales (IST day). */
const getInventorySummary = async (_args, now) => {
  const startOfToday = new Date(Math.floor((now.getTime() + SHOP_OFFSET_MS) / DAY_MS) * DAY_MS - SHOP_OFFSET_MS);
  const [medicines, sales] = await Promise.all([
    Medicine.find({}, 'category quantity reorderLevel batches').lean(),
    Bill.aggregate([
      { $match: { createdAt: { $gte: startOfToday, $lte: now } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, bills: { $sum: 1 } } },
    ]),
  ]);
  const withExpired = medicines.filter((m) => (m.batches || []).some((b) => b.quantity > 0 && daysUntilExpiry(b.expiryDate, now) <= 0));
  return {
    totalMedicines: medicines.length,
    lowStockMedicines: medicines.filter(isMedicineLowStock).length,
    medicinesWithExpiredStock: withExpired.length,
    categories: [...new Set(medicines.map((m) => m.category).filter(Boolean))].sort(),
    todaySales: { amount: Math.round((sales[0]?.total || 0) * 100) / 100, bills: sales[0]?.bills || 0, currency: 'INR' },
  };
};

// ── Declarations sent to the model ───────────────────────────────────────

export const TOOLS = {
  search_medicines: {
    run: searchMedicines,
    declaration: {
      name: 'search_medicines',
      description: 'Find medicines by (part of) their name, or list a whole category. Returns stock, price, rack numbers and active batches. Use it for any question about a specific medicine.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Medicine name or part of it, e.g. "paracetamol". Leave out to list a whole category' },
          category: { type: 'STRING', description: 'Optional: only this category (required when there is no query)' },
        },
      },
    },
  },
  find_alternatives: {
    run: findAlternatives,
    declaration: {
      name: 'find_alternatives',
      description: 'In-stock medicines in a category, most stock first. Use it when a requested medicine is out of stock or expired.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', description: 'Exact category of the unavailable medicine' },
          exclude: { type: 'STRING', description: 'Optional: name of the unavailable medicine, to leave it out' },
        },
        required: ['category'],
      },
    },
  },
  list_low_stock: {
    run: listLowStock,
    declaration: {
      name: 'list_low_stock',
      description: 'Medicines at or below their reorder level (out, critical or low), most urgent first, with the rack of the batch to use first.',
      parameters: { type: 'OBJECT', properties: {} },
    },
  },
  list_expiring_batches: {
    run: listExpiringBatches,
    declaration: {
      name: 'list_expiring_batches',
      description: 'Batches with stock left that have expired or will expire within a number of days, soonest first, with rack numbers.',
      parameters: {
        type: 'OBJECT',
        properties: { days: { type: 'INTEGER', description: 'Look-ahead window in days (1-180, default 30)' } },
      },
    },
  },
  get_inventory_summary: {
    run: getInventorySummary,
    declaration: {
      name: 'get_inventory_summary',
      description: 'Overall counts (medicines, low stock, expired stock), the list of categories, and today\'s sales.',
      parameters: { type: 'OBJECT', properties: {} },
    },
  },
};

export const TOOL_DECLARATIONS = Object.values(TOOLS).map((t) => t.declaration);

/**
 * Runs one tool call from the model. Never throws: an unknown tool or a failure comes back as
 * `{ error }`, so the model can tell the user instead of the whole request failing.
 */
export const runTool = async (name, args, now = new Date()) => {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run(args && typeof args === 'object' ? args : {}, now);
  } catch (error) {
    return { error: `Tool ${name} failed: ${error.message}` };
  }
};

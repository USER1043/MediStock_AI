/**
 * The chatbot's read-only inventory tools (services/chatbotTools.js) against an in-memory MongoDB.
 * "now" is fixed at 25 Nov 2026 12:00 IST so expiry results are deterministic.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { runTool, TOOL_DECLARATIONS, MAX_RESULTS } = await import('../services/chatbotTools.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Bill } = await import('../models/billModel.js');

const NOW = new Date('2026-11-25T06:30:00Z'); // 25 Nov 2026, 12:00 IST
const d = (iso) => new Date(`${iso}T00:00:00Z`);
let server;

const med = (name, category, batches, overrides = {}) =>
  Medicine.create({
    name, category, purchasePrice: 2, sellingPrice: 5, reorderLevel: 20,
    quantity: batches.reduce((s, b) => s + b.quantity, 0),
    batches: batches.map((b, i) => ({ batchNumber: b.batch || `${name}-${i}`, expiryDate: d(b.expiry), quantity: b.quantity, rackNumber: b.rack || 'R1' })),
    ...overrides,
  });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([Medicine.deleteMany({}), Bill.deleteMany({})]);
  await med('Paracetamol 500mg', 'Analgesic', [
    { batch: 'P-OLD', expiry: '2026-11-25', quantity: 4, rack: 'A1' }, // expires today (IST): not sellable
    { batch: 'P-NEW', expiry: '2027-06-01', quantity: 50, rack: 'A2' },
    { batch: 'P-SOON', expiry: '2026-12-01', quantity: 10, rack: 'A3' },
  ]);
  await med('Ibuprofen 400mg', 'Analgesic', [{ expiry: '2027-01-01', quantity: 5, rack: 'B1' }]);
  await med('Aspirin 75mg', 'Analgesic', [{ expiry: '2026-10-01', quantity: 30, rack: 'B2' }]); // only expired stock
  await med('Cetirizine 10mg', 'Antihistamine', [{ expiry: '2027-03-01', quantity: 100, rack: 'C1' }]);
});

describe('search_medicines', () => {
  test('returns stock, price and active batches (earliest expiry first, expired ones left out)', async () => {
    const res = await runTool('search_medicines', { query: 'paracetamol' }, NOW);
    expect(res.medicines).toHaveLength(1);
    const p = res.medicines[0];
    expect(p).toMatchObject({
      name: 'Paracetamol 500mg', category: 'Analgesic', inStock: true, sellableQuantity: 60,
      expiredQuantityStillOnShelf: 4, totalQuantity: 64, reorderLevel: 20, stockLevel: 'ok', price: 5,
    });
    expect(p.activeBatches.map((b) => [b.batch, b.rack, b.expiry, b.daysLeft])).toEqual([
      ['P-SOON', 'A3', '2026-12-01', 6],
      ['P-NEW', 'A2', '2027-06-01', 188],
    ]);
  });

  test('a medicine with only expired stock is not in stock', async () => {
    const res = await runTool('search_medicines', { query: 'aspirin' }, NOW);
    expect(res.medicines[0]).toMatchObject({ inStock: false, sellableQuantity: 0, activeBatches: [] });
  });

  test('regex characters in the query are matched literally', async () => {
    expect((await runTool('search_medicines', { query: '.*' }, NOW)).medicines).toEqual([]);
  });

  test('a missing query is an error result, not an exception', async () => {
    expect(await runTool('search_medicines', {}, NOW)).toEqual({ error: 'query or category is required' });
    const byCategory = await runTool('search_medicines', { category: 'analgesic' }, NOW);
    expect(byCategory.medicines.length).toBeGreaterThan(0);
    expect(byCategory.medicines.every((m) => m.category === 'Analgesic')).toBe(true);
  });
});

test('find_alternatives: in-stock medicines of the category, most stock first, excluding the requested one', async () => {
  const res = await runTool('find_alternatives', { category: 'analgesic', exclude: 'Aspirin' }, NOW);
  expect(res.alternatives.map((m) => [m.name, m.sellableQuantity])).toEqual([
    ['Paracetamol 500mg', 60],
    ['Ibuprofen 400mg', 5],
  ]);
});

test('list_low_stock: at or below the reorder level, most urgent first', async () => {
  const res = await runTool('list_low_stock', {}, NOW);
  expect(res.lowStock).toEqual([
    { name: 'Ibuprofen 400mg', category: 'Analgesic', totalQuantity: 5, reorderLevel: 20, stockLevel: 'critical', rack: 'B1' },
  ]);
});

test('list_expiring_batches: expired and within the window, soonest first; the window is clamped', async () => {
  const res = await runTool('list_expiring_batches', { days: 7 }, NOW);
  expect(res.windowDays).toBe(7);
  expect(res.batches.map((b) => [b.medicine, b.batch, b.daysLeft, b.status])).toEqual([
    ['Aspirin 75mg', 'Aspirin 75mg-0', -55, 'expired'],
    ['Paracetamol 500mg', 'P-OLD', 0, 'expired'],
    ['Paracetamol 500mg', 'P-SOON', 6, 'near_expiry'],
  ]);
  expect((await runTool('list_expiring_batches', { days: 5000 }, NOW)).windowDays).toBe(180);
  expect((await runTool('list_expiring_batches', {}, NOW)).windowDays).toBe(30);
});

test('get_inventory_summary: counts, categories and today\'s sales from 00:00 IST', async () => {
  const bill = (createdAt, grandTotal) => Bill.collection.insertOne({ billNumber: `B-${grandTotal}`, customerName: 'x', items: [], subtotal: grandTotal, tax: 0, grandTotal, createdAt });
  await bill(new Date('2026-11-24T18:30:00Z'), 100); // 25 Nov 00:00 IST: today
  await bill(new Date('2026-11-24T18:29:59Z'), 999); // 24 Nov 23:59:59 IST: yesterday
  await bill(new Date('2026-11-25T05:00:00Z'), 50.5);

  const res = await runTool('get_inventory_summary', {}, NOW);
  expect(res).toEqual({
    totalMedicines: 4,
    lowStockMedicines: 1,
    medicinesWithExpiredStock: 2,
    categories: ['Analgesic', 'Antihistamine'],
    todaySales: { amount: 150.5, bills: 2, currency: 'INR' },
  });
});

test('results are capped', async () => {
  await Medicine.insertMany(Array.from({ length: MAX_RESULTS + 5 }, (_, i) => ({
    name: `Bulk ${i}`, category: 'Bulk', purchasePrice: 1, sellingPrice: 2, reorderLevel: 1, quantity: 5,
    batches: [{ batchNumber: `BK${i}`, expiryDate: d('2027-01-01'), quantity: 5, rackNumber: 'Z' }],
  })));
  const res = await runTool('find_alternatives', { category: 'Bulk' }, NOW);
  expect(res.alternatives).toHaveLength(MAX_RESULTS);
  expect(res).toMatchObject({ truncated: true, total: MAX_RESULTS + 5 });
});

test('an unknown tool is an error result', async () => {
  expect(await runTool('drop_database', {}, NOW)).toEqual({ error: 'Unknown tool: drop_database' });
  expect(await runTool('toString', {}, NOW)).toEqual({ error: 'Unknown tool: toString' });
});

test('every tool has a declaration with a name, description and parameters', () => {
  expect(TOOL_DECLARATIONS.map((t) => t.name).sort()).toEqual([
    'find_alternatives', 'get_inventory_summary', 'list_expiring_batches', 'list_low_stock', 'search_medicines',
  ]);
  for (const t of TOOL_DECLARATIONS) {
    expect(t.description.length).toBeGreaterThan(10);
    expect(t.parameters.type).toBe('OBJECT');
  }
});

/**
 * @file Load and concurrency tests for atomic FEFO stock deduction in billing and stock adjustments.
 *
 * Runs every scenario twice against a real MongoDB started by mongodb-memory-server:
 *   - a single-node replica set, where createBill uses a multi-document transaction
 *   - a standalone server, where createBill falls back to a compensating rollback
 *
 * After each load run the tests check the invariants the billing fix is meant to guarantee:
 *   - stock never goes negative and no batch goes negative (no overselling)
 *   - Medicine.quantity always equals the sum of its batch quantities
 *   - every unit that left stock is accounted for by exactly one bill and one sale history row
 *   - deductions follow FEFO: a later-expiring batch is never touched while an earlier one has stock
 *   - failed bills leave nothing behind (no bill, no history row, no stock change)
 *
 * Needs the MongoDB binary: mongodb-memory-server downloads it from fastdl.mongodb.org on first run,
 * or set MONGOMS_SYSTEM_BINARY to a local mongod. Set CONCURRENCY_LOAD to change the request count.
 */
import { jest } from '@jest/globals';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

jest.setTimeout(180000);

// Keep the tests about stock and data integrity: no PDFs, e-mails, WhatsApp messages or log files
jest.unstable_mockModule('../utils/notifications.js', () => ({
  sendBillNotification: jest.fn(async () => ({ success: true })),
  sendEmailNotification: jest.fn(async () => ({ success: true })),
  sendWhatsAppNotification: jest.fn(async () => ({ success: true })),
  sendAlertNotification: jest.fn(async () => ({ success: true })),
}));
jest.unstable_mockModule('../utils/pdfGenerator.js', () => ({
  generateBillPDF: jest.fn(async () => 'mock.pdf'),
  generatePrescriptionPDF: jest.fn(async () => 'mock.pdf'),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: () => {} }));

const { createBill } = await import('../controllers/billingController.js');
const { adjustQuantity } = await import('../controllers/inventoryController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Bill } = await import('../models/billModel.js');
const { InventoryHistory } = await import('../models/inventoryHistoryModel.js');

const LOAD = Number(process.env.CONCURRENCY_LOAD) || 40;
const DAY = 24 * 60 * 60 * 1000;
const STAFF_ID = new mongoose.Types.ObjectId().toString();

// ── Helpers ──────────────────────────────────────────────────────

const invoke = async (handler, req) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };
  await handler({ user: { id: STAFF_ID, role: 'staff', username: 'load-test' }, params: {}, ...req }, res);
  return result;
};

const bill = (items) =>
  invoke(createBill, {
    body: { customerName: 'Load Test', customerType: 'walking', paymentMethod: 'cash', items },
  });

// Adding stock must name the batch it goes into (batchNumber + expiryDate), so pass one for restocks
const adjust = (medicineId, quantityChanged, batch) =>
  invoke(adjustQuantity, {
    params: { id: medicineId.toString() },
    body: {
      quantityChanged,
      reason: 'load test',
      ...(batch ? { batchNumber: batch.batchNumber, expiryDate: batch.expiryDate } : {}),
    },
  });

// 0 - n instead of -n: when nothing sold, -0 would fail toBe(0) (Object.is treats them as different)
const negated = (n) => 0 - n;

// Retries a request the way a client should after a 409 (or a transaction write conflict)
const withRetry = async (fn, attempts = 50) => {
  let result;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (result.status !== 409 && result.status !== 500) return result;
    await new Promise((r) => setTimeout(r, Math.random() * 20));
  }
  return result;
};

const createMedicine = (name, batches, overrides = {}) =>
  Medicine.create({
    name,
    category: 'Analgesic',
    purchasePrice: 5,
    sellingPrice: 10,
    reorderLevel: 10,
    quantity: batches.reduce((s, b) => s + b.quantity, 0),
    batches: batches.map((b, i) => ({
      batchNumber: b.batchNumber,
      expiryDate: new Date(Date.now() + b.expiresInDays * DAY),
      quantity: b.quantity,
      rackNumber: b.rackNumber || `R${i + 1}`,
    })),
    ...overrides,
  });

const soldUnits = async (medicineId) => {
  const bills = await Bill.find({ 'items.medicineId': medicineId }).lean();
  return bills.reduce(
    (sum, b) => sum + b.items.filter((i) => i.medicineId.equals(medicineId)).reduce((s, i) => s + i.quantity, 0),
    0
  );
};

const historyTotal = async (medicineId, action) => {
  const rows = await InventoryHistory.find({ medicineId, action }).lean();
  return rows.reduce((sum, h) => sum + h.quantityChanged, 0);
};

/** Assert the stock invariants for one medicine and return its final state. */
const expectConsistentStock = async (medicineId) => {
  const med = await Medicine.findById(medicineId).lean();
  const batchTotal = med.batches.reduce((s, b) => s + b.quantity, 0);

  expect(med.quantity).toBeGreaterThanOrEqual(0);
  for (const b of med.batches) expect(b.quantity).toBeGreaterThanOrEqual(0);
  expect(med.quantity).toBe(batchTotal);
  return med;
};

/** FEFO: no batch may have been drawn from while an earlier-expiring batch still has stock. */
const expectFefoOrder = (initialBatches, finalBatches) => {
  const byNumber = new Map(finalBatches.map((b) => [b.batchNumber, b]));
  const ordered = [...initialBatches].sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  let earlierStillHasStock = false;
  for (const initial of ordered) {
    const final = byNumber.get(initial.batchNumber);
    const drawnFrom = final.quantity < initial.quantity;
    if (drawnFrom) expect(earlierStillHasStock).toBe(false);
    if (final.quantity > 0) earlierStillHasStock = true;
  }
};

const countStatuses = (results) =>
  results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

// ── Scenarios, run against both MongoDB topologies ───────────────

const topologies = [
  ['replica set (multi-document transactions)', () => MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } }), true],
  ['standalone server (compensating rollback)', () => MongoMemoryServer.create(), false],
];

describe.each(topologies)('Billing concurrency on a %s', (_label, startServer, expectTransactions) => {
  let server;

  beforeAll(async () => {
    server = await startServer();
    await mongoose.connect(server.getUri());
    await Promise.all([Medicine.init(), Bill.init(), InventoryHistory.init()]);

    const topology = mongoose.connection.client.topology.description.type;
    expect(topology === 'ReplicaSetWithPrimary').toBe(expectTransactions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    await Promise.all([Medicine.deleteMany({}), Bill.deleteMany({}), InventoryHistory.deleteMany({})]);
  });

  // Status codes a client may legitimately see under contention
  const allowedFailures = expectTransactions ? [400, 409, 500] : [400, 409];

  it(`never oversells when ${LOAD} concurrent bills compete for limited stock`, async () => {
    const med = await createMedicine('Paracetamol 500mg', [
      { batchNumber: 'LATE', expiresInDays: 300, quantity: 30 },
      { batchNumber: 'EARLY', expiresInDays: 30, quantity: 20 },
      { batchNumber: 'MID', expiresInDays: 120, quantity: 10 },
    ]);
    const initialStock = med.quantity; // 60 units; demand below is 3 × LOAD units

    const results = await Promise.all(
      Array.from({ length: LOAD }, () => bill([{ medicineId: med._id.toString(), quantity: 3 }]))
    );

    const succeeded = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    for (const r of failed) expect(allowedFailures).toContain(r.status);
    expect(succeeded.length).toBeGreaterThan(0);

    const final = await expectConsistentStock(med._id);
    const consumed = initialStock - final.quantity;

    expect(consumed).toBe(succeeded.length * 3);
    expect(consumed).toBeLessThanOrEqual(initialStock);
    expect(await soldUnits(med._id)).toBe(consumed);
    expect(await historyTotal(med._id, 'sale')).toBe(negated(consumed));
    expect(await Bill.countDocuments()).toBe(succeeded.length);
    expectFefoOrder(med.batches, final.batches);

    console.log(`[${_label}] ${LOAD} bills: ${JSON.stringify(countStatuses(results))}, ${consumed}/${initialStock} units sold`);
  });

  it('sells all stock exactly once when clients retry on conflict', async () => {
    const med = await createMedicine('Ibuprofen 400mg', [
      { batchNumber: 'A', expiresInDays: 10, quantity: 25 },
      { batchNumber: 'B', expiresInDays: 60, quantity: 25 },
    ]);
    const billsNeeded = 25; // 25 bills × 2 units = all 50 units

    const results = await Promise.all(
      Array.from({ length: billsNeeded }, () =>
        withRetry(() => bill([{ medicineId: med._id.toString(), quantity: 2 }]))
      )
    );

    expect(countStatuses(results)).toEqual({ 201: billsNeeded });
    const final = await expectConsistentStock(med._id);
    expect(final.quantity).toBe(0);
    expect(await soldUnits(med._id)).toBe(50);
    expect(await historyTotal(med._id, 'sale')).toBe(-50);
  });

  it('records the batches actually consumed on each bill line, earliest expiry first', async () => {
    const med = await createMedicine('Amoxicillin 250mg', [
      { batchNumber: 'LATER', expiresInDays: 200, quantity: 10 },
      { batchNumber: 'SOONER', expiresInDays: 20, quantity: 4 },
    ]);

    const result = await bill([{ medicineId: med._id.toString(), quantity: 6 }]);

    expect(result.status).toBe(201);
    expect(result.body.bill.items[0].batchNumber).toBe('SOONER, LATER');
    const final = await expectConsistentStock(med._id);
    const byNumber = Object.fromEntries(final.batches.map((b) => [b.batchNumber, b.quantity]));
    expect(byNumber).toEqual({ SOONER: 0, LATER: 8 });
  });

  it('rolls back earlier items when a later item in the same bill fails', async () => {
    const plenty = await createMedicine('Cetirizine 10mg', [{ batchNumber: 'C1', expiresInDays: 90, quantity: 50 }]);
    const scarce = await createMedicine('Insulin Glargine', [{ batchNumber: 'I1', expiresInDays: 90, quantity: 1 }]);

    const result = await bill([
      { medicineId: plenty._id.toString(), quantity: 5 },
      { medicineId: scarce._id.toString(), quantity: 2 },
    ]);

    expect(result.status).toBe(400);
    const final = await expectConsistentStock(plenty._id);
    expect(final.quantity).toBe(50);
    expect(final.batches[0].quantity).toBe(50);
    expect(await Bill.countDocuments()).toBe(0);
    expect(await InventoryHistory.countDocuments()).toBe(0);
  });

  it('keeps stock consistent when failing multi-item bills roll back during concurrent sales', async () => {
    const shared = await createMedicine('Vitamin D3', [
      { batchNumber: 'V-EARLY', expiresInDays: 15, quantity: 100 },
      { batchNumber: 'V-LATE', expiresInDays: 400, quantity: 100 },
    ]);
    const scarce = await createMedicine('Rare Antidote', [{ batchNumber: 'X1', expiresInDays: 90, quantity: 2 }]);

    // Half the bills also ask for the scarce item, so most of them fail after deducting `shared`
    // and must roll that deduction back while other bills are still selling `shared`.
    const requests = Array.from({ length: LOAD }, (_, i) =>
      i % 2 === 0
        ? bill([
            { medicineId: shared._id.toString(), quantity: 2 },
            { medicineId: scarce._id.toString(), quantity: 1 },
          ])
        : bill([{ medicineId: shared._id.toString(), quantity: 2 }])
    );
    const results = await Promise.all(requests);
    for (const r of results.filter((r) => r.status !== 201)) expect(allowedFailures).toContain(r.status);

    for (const id of [shared._id, scarce._id]) {
      const initial = id.equals(shared._id) ? 200 : 2;
      const final = await expectConsistentStock(id);
      const consumed = initial - final.quantity;
      expect(await soldUnits(id)).toBe(consumed);
      expect(await historyTotal(id, 'sale')).toBe(negated(consumed));
    }
    const finalShared = await Medicine.findById(shared._id).lean();
    expectFefoOrder(shared.batches, finalShared.batches);

    console.log(`[${_label}] mixed bills: ${JSON.stringify(countStatuses(results))}`);
  });

  it('keeps stock consistent under concurrent bills and stock adjustments', async () => {
    const med = await createMedicine('Omeprazole 20mg', [
      { batchNumber: 'O-EARLY', expiresInDays: 25, quantity: 40 },
      { batchNumber: 'O-LATE', expiresInDays: 250, quantity: 40 },
    ]);
    const initialStock = med.quantity;
    const restockBatch = med.batches.find((b) => b.batchNumber === 'O-LATE');

    const requests = Array.from({ length: LOAD }, (_, i) => {
      if (i % 4 === 0) return adjust(med._id, 5, restockBatch).then((r) => ({ ...r, kind: 'restock' }));
      if (i % 4 === 1) return adjust(med._id, -2).then((r) => ({ ...r, kind: 'writeoff' }));
      return bill([{ medicineId: med._id.toString(), quantity: 3 }]).then((r) => ({ ...r, kind: 'bill' }));
    });
    const results = await Promise.all(requests);

    const ok = (kind, status) => results.filter((r) => r.kind === kind && r.status === status).length;
    for (const r of results) {
      const success = r.kind === 'bill' ? 201 : 200;
      if (r.status !== success) expect(allowedFailures).toContain(r.status);
    }
    // A restock may lose a race (409/500) but must never be rejected as invalid, or this test stops covering restocks
    expect(results.filter((r) => r.kind === 'restock' && r.status === 400)).toEqual([]);

    const expected = initialStock + 5 * ok('restock', 200) - 2 * ok('writeoff', 200) - 3 * ok('bill', 201);
    const final = await expectConsistentStock(med._id);
    expect(final.quantity).toBe(expected);
    expect(await soldUnits(med._id)).toBe(3 * ok('bill', 201));
    expect(await historyTotal(med._id, 'sale')).toBe(negated(3 * ok('bill', 201)));
    expect(await historyTotal(med._id, 'adjustment')).toBe(5 * ok('restock', 200) - 2 * ok('writeoff', 200));

    console.log(`[${_label}] bills + adjustments: ${JSON.stringify(countStatuses(results))}`);
  });
});

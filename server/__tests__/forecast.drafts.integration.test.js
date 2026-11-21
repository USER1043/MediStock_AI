/**
 * Forecast → AI draft PO integration tests.
 * Runs the forecast handler against a real in-memory MongoDB,
 * once on a standalone server (insert-then-delete path) and once on a single-node replica set
 * (transaction path). Medicines have no sales history, so computeForecast takes its cold-start
 * path (no LSTM training) and the numbers are deterministic for given parameters.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: jest.fn(),
}));

const { runForecast, triggerRetraining } = await import('../controllers/forecastController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { PurchaseOrder, Supplier } = await import('../models/supplierModels.js');
const { ForecastParameters } = await import('../models/forecastModel.js');
const { AuditLog } = await import('../models/auditLogModel.js');

const ownerId = new mongoose.Types.ObjectId();

const mockReq = (url = '/api/forecast/run') => ({
  body: {},
  params: {},
  user: { id: ownerId, username: 'owner' },
  ip: '127.0.0.1',
  method: 'POST',
  originalUrl: url,
});
const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const flatSeason = (factor) => Object.fromEntries(months.map((m) => [m, factor]));

// With no sales history and these parameters the cold-start reorder quantity is
// ceil(reorderLevel * (7/30 + 0.45 * 28/30 * season) - quantity).
const saveParams = (season) =>
  ForecastParameters.create({
    forecastHorizon: 4,
    leadTimeDays: 7,
    safetyStockPercent: 20,
    seasonalMultipliers: flatSeason(season),
  });

const createMedicine = (overrides = {}) =>
  Medicine.create({
    name: 'Paracetamol 500mg',
    category: 'Analgesic',
    quantity: 0,
    reorderLevel: 100,
    purchasePrice: 2,
    sellingPrice: 5,
    batches: [],
    ...overrides,
  });

const createSupplier = () =>
  Supplier.create({
    supplier_name: 'Acme Pharma',
    contact_info: { phone: '9999999999', email: 'acme@test.local', address: '1 Test Street' },
    medicine_categories: ['Analgesic'],
    is_active: true,
  });

let oldSeq = 0;
// Drafts that a previous run (or a manual recommendation) left behind
const createOldDrafts = async (medicine, supplier, count = 2) => {
  const docs = [];
  for (let i = 0; i < count; i++) {
    oldSeq += 1;
    docs.push({
      order_number: `PO-AI-OLD-${oldSeq}`,
      medicine_id: medicine._id,
      medicine_name: medicine.name,
      supplier_id: supplier._id,
      requested_quantity: 5,
      unit_price: 2,
      total_amount: 10,
      expected_delivery_date: new Date(),
      order_status: 'AI_Draft',
      created_by: ownerId,
      ai_forecast_reference: { demand_predicted: 5, forecast_date: new Date(), priority: 'Medium' },
    });
  }
  const created = await PurchaseOrder.insertMany(docs);
  return created.map((d) => d._id.toString()).sort();
};

const draftIds = async () =>
  (await PurchaseOrder.find({ order_status: 'AI_Draft' }).lean()).map((d) => d._id.toString()).sort();

const topologies = [
  ['standalone (insert, then delete old drafts)', () => MongoMemoryServer.create()],
  [
    'replica set (transaction)',
    () => MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } }),
  ],
];

describe.each(topologies)('Forecast drafts on %s', (label, startServer) => {
  let server;
  const isReplSet = label.startsWith('replica');

  beforeAll(async () => {
    server = await startServer();
    await mongoose.connect(server.getUri());
    // Create collections and indexes up front so transactions don't need to
    await Promise.all([
      Medicine.init(),
      PurchaseOrder.init(),
      Supplier.init(),
      ForecastParameters.init(),
      AuditLog.init(),
    ]);
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Medicine.deleteMany({}),
      PurchaseOrder.deleteMany({}),
      Supplier.deleteMany({}),
      ForecastParameters.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses the expected topology', () => {
    const type = mongoose.connection.client.topology.description.type;
    expect(type).toBe(isReplSet ? 'ReplicaSetWithPrimary' : 'Single');
  });

  test.each([
    ['run', runForecast, '/api/forecast/run', 'FORECAST_RUN'],
    ['retrain', triggerRetraining, '/api/forecast/retrain', 'MODEL_RETRAINED'],
  ])('%s replaces the old drafts with new ones carrying valid priorities', async (_name, handler, url, action) => {
    const supplier = await createSupplier();
    await saveParams(5);
    // quantity <= reorderLevel → high; slow-moving with stock in (r, 2r] → medium; stock > 2r → low
    const high = await createMedicine({ name: 'Out of stock', quantity: 0 });
    const medium = await createMedicine({ name: 'Mid stock', quantity: 150 });
    const low = await createMedicine({ name: 'Plenty', quantity: 210 });
    const oldIds = await createOldDrafts(high, supplier, 3);

    const res = mockRes();
    await handler(mockReq(url), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(3);

    const drafts = await PurchaseOrder.find({ order_status: 'AI_Draft' }).lean();
    expect(drafts).toHaveLength(3);
    // None of the old drafts survive
    expect(drafts.map((d) => d._id.toString()).filter((id) => oldIds.includes(id))).toEqual([]);

    const byName = Object.fromEntries(drafts.map((d) => [d.medicine_name, d]));
    expect(byName[high.name].ai_forecast_reference.priority).toBe('High');
    expect(byName[medium.name].ai_forecast_reference.priority).toBe('Medium');
    expect(byName[low.name].ai_forecast_reference.priority).toBe('Low');
    for (const d of drafts) {
      expect(d.requested_quantity).toBeGreaterThanOrEqual(1);
      expect(d.order_number).toMatch(/^PO-AI-/);
    }
    expect(new Set(drafts.map((d) => d.order_number)).size).toBe(3);

    expect(await AuditLog.countDocuments({ action, 'details.count': 3 })).toBe(1);
  });

  test('keeps the old drafts when one new draft fails validation', async () => {
    const supplier = await createSupplier();
    await saveParams(5);
    const good = await createMedicine({ name: 'Good', quantity: 0 });
    // Written around Mongoose validation: no purchasePrice, so its draft has no unit_price
    await Medicine.collection.insertOne({
      name: 'Broken',
      category: 'Analgesic',
      quantity: 0,
      reorderLevel: 100,
      batches: [],
    });
    const oldIds = await createOldDrafts(good, supplier, 3);

    const res = mockRes();
    await runForecast(mockReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/unit_price/);
    expect(await draftIds()).toEqual(oldIds);
    expect(await AuditLog.countDocuments({ action: 'FORECAST_RUN' })).toBe(0);
  });

  test('keeps the old drafts when the insert fails', async () => {
    const supplier = await createSupplier();
    await saveParams(5);
    const med = await createMedicine({ quantity: 0 });
    const oldIds = await createOldDrafts(med, supplier, 2);
    jest.spyOn(PurchaseOrder, 'insertMany').mockRejectedValueOnce(new Error('insert failed'));

    const res = mockRes();
    await runForecast(mockReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('insert failed');
    expect(await draftIds()).toEqual(oldIds);
  });

  test('keeps the old drafts and leaves no new ones when the insert fails part-way', async () => {
    const supplier = await createSupplier();
    await saveParams(5);
    await createMedicine({ name: 'First', quantity: 0 });
    const second = await createMedicine({ name: 'Second', quantity: 0 });
    const oldIds = await createOldDrafts(second, supplier, 2);

    // Pin the run's timestamp and occupy the second draft's order number with a non-draft PO,
    // so the first new draft is written and the second hits the unique index.
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await PurchaseOrder.create({
      order_number: `PO-AI-${now}-2`,
      medicine_id: second._id,
      supplier_id: supplier._id,
      requested_quantity: 1,
      unit_price: 2,
      total_amount: 2,
      expected_delivery_date: new Date(),
      order_status: 'Pending',
      created_by: ownerId,
    });

    const res = mockRes();
    await runForecast(mockReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/duplicate key/);
    expect(await draftIds()).toEqual(oldIds);
    expect(await PurchaseOrder.countDocuments()).toBe(oldIds.length + 1);
  });

  test('a run with nothing to order clears the old drafts and returns count 0', async () => {
    const supplier = await createSupplier();
    await saveParams(1);
    const stocked = await createMedicine({ name: 'Well stocked', quantity: 1000, reorderLevel: 10 });
    // At its reorder level, so priority is high, but the computed reorder quantity is 0:
    // a PO needs at least 1 unit, so no draft is made for it.
    await createMedicine({ name: 'At reorder level', quantity: 100, reorderLevel: 100 });
    await createOldDrafts(stocked, supplier, 2);

    const res = mockRes();
    await runForecast(mockReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(0);
    expect(await draftIds()).toEqual([]);
  });
});

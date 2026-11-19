/**
 * Expiry alerts and the dashboard's near-expiry list against a real MongoDB (mongodb-memory-server),
 * so the real queries run: Alert.findOne's isResolved filter, Medicine.find().select(...).lean(), etc.
 * The first run downloads a mongod binary.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const { generateAlerts } = await import('../controllers/alertController.js');
const { getDashboardAnalytics } = await import('../controllers/reportController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Alert } = await import('../models/alertModel.js');
const { alertService } = await import('../services/alertService.js');

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

const invoke = async (handler, req = {}) => {
  const res = {};
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  await handler(req, res);
  return res;
};

// batches: [{ batchNumber, inDays, quantity, rackNumber? }]
const addMedicine = (name, batches, overrides = {}) =>
  Medicine.create({
    name,
    category: 'Analgesic',
    purchasePrice: 5,
    sellingPrice: 10,
    reorderLevel: 10,
    quantity: batches.reduce((sum, b) => sum + b.quantity, 0),
    batches: batches.map((b, i) => ({
      batchNumber: b.batchNumber,
      expiryDate: daysFromNow(b.inDays),
      quantity: b.quantity,
      rackNumber: b.rackNumber || `R${i + 1}`,
    })),
    ...overrides,
  });

const alertsOf = (medicineId, alertType) => Alert.find({ medicineId, alertType }).lean();

let server;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Alert.init(); // build the unique "one current alert" index before the tests run
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([Medicine.deleteMany({}), Alert.deleteMany({})]);
  alertService.reset();
});

describe('generateAlerts against a real database', () => {
  test('a medicine with an expired batch and a near-expiry batch gets both alerts, each naming its own batch', async () => {
    const med = await addMedicine('Paracetamol', [
      { batchNumber: 'OLD-1', inDays: -3, quantity: 5 },
      { batchNumber: 'SOON-1', inDays: 4, quantity: 8 },
      { batchNumber: 'LATER-1', inDays: 200, quantity: 100 },
    ]);

    const res = await invoke(generateAlerts);

    expect(res.statusCode).toBe(200);
    const [expired] = await alertsOf(med._id, 'expired');
    const [nearExpiry] = await alertsOf(med._id, 'near_expiry');
    expect(expired.severity).toBe('critical');
    expect(expired.message).toContain('OLD-1');
    expect(expired.message).not.toContain('SOON-1');
    expect(nearExpiry.severity).toBe('warning');
    expect(nearExpiry.message).toContain('SOON-1');
    expect(nearExpiry.message).not.toContain('OLD-1');
    expect(nearExpiry.message).not.toContain('LATER-1');
  });

  test('an unresolved expiry alert is not duplicated when alerts are generated again', async () => {
    const med = await addMedicine('Ibuprofen', [{ batchNumber: 'SOON-1', inDays: 2, quantity: 10 }]);

    await invoke(generateAlerts);
    await invoke(generateAlerts);

    expect(await alertsOf(med._id, 'near_expiry')).toHaveLength(1);
  });

  // Resolving now means "acknowledged": the same batches expiring again must not re-raise it.
  // (Before the alerts page, a resolved alert was followed by a fresh one on the next run.)
  test('a resolved expiry alert stays acknowledged while the same batch is still expiring', async () => {
    const med = await addMedicine('Cetirizine', [{ batchNumber: 'SOON-1', inDays: 2, quantity: 10 }]);
    await invoke(generateAlerts);
    await Alert.updateMany({ medicineId: med._id }, { isResolved: true, resolvedAt: new Date() });

    await invoke(generateAlerts);

    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].isResolved).toBe(true);
  });

  test('batches with no stock left raise no expiry alerts', async () => {
    const med = await addMedicine('Amoxicillin', [
      { batchNumber: 'GONE-OLD', inDays: -5, quantity: 0 },
      { batchNumber: 'GONE-SOON', inDays: 3, quantity: 0 },
      { batchNumber: 'OK-1', inDays: 120, quantity: 50 },
    ]);

    await invoke(generateAlerts);

    expect(await alertsOf(med._id, 'expired')).toHaveLength(0);
    expect(await alertsOf(med._id, 'near_expiry')).toHaveLength(0);
  });
});

describe('dashboard near-expiry list', () => {
  const dashboard = async (role = 'staff') => {
    const res = await invoke(getDashboardAnalytics, { user: { role } });
    expect(res.statusCode).toBe(200);
    return res.body.analytics;
  };

  test('lists each medicine with in-stock batches expiring within 7 days, soonest first, counting only those batches', async () => {
    await addMedicine('Later Med', [
      { batchNumber: 'L-SOON', inDays: 6, quantity: 7 },
      { batchNumber: 'L-FAR', inDays: 300, quantity: 90 },
    ]);
    await addMedicine('Sooner Med', [
      { batchNumber: 'S-1', inDays: 2, quantity: 4 },
      { batchNumber: 'S-2', inDays: 5, quantity: 6 },
    ]);
    await addMedicine('Expired Only', [{ batchNumber: 'E-1', inDays: -1, quantity: 9 }]);
    await addMedicine('Used Up', [{ batchNumber: 'U-1', inDays: 3, quantity: 0 }, { batchNumber: 'U-2', inDays: 90, quantity: 5 }]);
    await addMedicine('Far Off', [{ batchNumber: 'F-1', inDays: 60, quantity: 30 }]);

    const { nearExpiryMeds, kpis } = await dashboard();

    expect(nearExpiryMeds.map((m) => m.name)).toEqual(['Sooner Med', 'Later Med']);
    const [sooner, later] = nearExpiryMeds;
    expect(sooner.quantity).toBe(10); // S-1 + S-2, both within 7 days
    expect(later.quantity).toBe(7); // only L-SOON; L-FAR is not expiring
    expect(new Date(sooner.expiryDate).getTime()).toBeCloseTo(daysFromNow(2).getTime(), -5); // soonest batch, S-1
    expect(kpis.nearExpiryCount).toBe(2);
  });

  test('caps the near-expiry list at 10 while the KPI counts all of them', async () => {
    for (let i = 0; i < 12; i++) {
      await addMedicine(`Med ${String(i).padStart(2, '0')}`, [{ batchNumber: `B${i}`, inDays: 1 + (i % 6), quantity: 3 }]);
    }

    const { nearExpiryMeds, kpis } = await dashboard();

    expect(nearExpiryMeds).toHaveLength(10);
    expect(kpis.nearExpiryCount).toBe(12);
    const times = nearExpiryMeds.map((m) => new Date(m.expiryDate).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('low-stock entries do not carry the batches array', async () => {
    await addMedicine('Low Med', [{ batchNumber: 'LOW-1', inDays: 90, quantity: 2 }]);

    const { lowStockMeds } = await dashboard();

    expect(lowStockMeds).toHaveLength(1);
    expect(lowStockMeds[0].name).toBe('Low Med');
    expect(lowStockMeds[0]).not.toHaveProperty('batches');
  });

  test('also works for an owner, whose dashboard runs the sales and forecast queries too', async () => {
    await addMedicine('Owner Med', [{ batchNumber: 'O-1', inDays: 3, quantity: 12 }]);

    const { nearExpiryMeds } = await dashboard('owner');

    expect(nearExpiryMeds.map((m) => m.name)).toEqual(['Owner Med']);
  });
});

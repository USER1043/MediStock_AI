/**
 * Every "low stock" path agrees on one definition (utils/stockLevel.js), against a real MongoDB:
 * dashboard KPI and list, purchase/inventory reports, dashboard summary, the /low-stock list,
 * stored stockStatus, and low_stock alerts (level, severity, wording, upgrades and clearing).
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const {
  getDashboardAnalytics,
  getPurchaseReport,
  getInventoryReport,
  getDashboardSummary,
} = await import('../controllers/reportController.js');
const { getLowStockMedicines } = await import('../controllers/inventoryController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Alert } = await import('../models/alertModel.js');
const { runAlertGeneration, evaluateMedicine } = await import('../services/alertService.js');

const invoke = async (handler, req = {}) => {
  const res = {};
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  await handler({ query: {}, ...req }, res);
  return res;
};

const add = (name, quantity, reorderLevel = 50) =>
  Medicine.create({
    name,
    category: 'Analgesic',
    purchasePrice: 5,
    sellingPrice: 10,
    reorderLevel,
    quantity,
    batches: quantity > 0
      ? [{ batchNumber: `${name}-1`, expiryDate: new Date(Date.now() + 365 * 86400000), quantity, rackNumber: 'R1' }]
      : [],
  });

// One medicine per boundary against reorder level 50 (half 25)
const seedBoundaries = async () => {
  await add('Out', 0);
  await add('Critical 1', 1);
  await add('Critical at half', 25);
  await add('Low just above half', 26);
  await add('Low at reorder level', 50);
  await add('OK just above', 51);
  await add('OK plenty', 120);
  await add('Zero reorder, empty', 0, 0);
  await add('Zero reorder, in stock', 5, 0);
};
const LOW_NAMES = ['Out', 'Critical 1', 'Critical at half', 'Low just above half', 'Low at reorder level', 'Zero reorder, empty'];

let server;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Alert.init();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([Medicine.deleteMany({}), Alert.deleteMany({})]);
});

describe('low-stock counts and lists agree (quantity <= reorderLevel)', () => {
  beforeEach(seedBoundaries);

  test('dashboard analytics: KPI count and list, most urgent first, with each level', async () => {
    const res = await invoke(getDashboardAnalytics, { user: { role: 'staff' } });
    const { kpis, lowStockMeds } = res.body.analytics;

    expect(kpis.lowStockCount).toBe(LOW_NAMES.length);
    expect(lowStockMeds.map((m) => m.name).sort()).toEqual([...LOW_NAMES].sort());
    expect(lowStockMeds.map((m) => m.stockLevel)).toEqual(['out', 'out', 'critical', 'critical', 'low', 'low']);
    expect(lowStockMeds[2].name).toBe('Critical 1'); // lowest relative to its reorder level
  });

  test('purchase report count', async () => {
    const res = await invoke(getPurchaseReport);
    expect(res.body.report.lowStockCount).toBe(LOW_NAMES.length);
  });

  test('inventory report and dashboard summary counts by level', async () => {
    const report = (await invoke(getInventoryReport)).body.report;
    expect(report).toMatchObject({ outOfStockCount: 2, criticalStockCount: 2, lowStockCount: 6, okStockCount: 3 });

    const summary = (await invoke(getDashboardSummary)).body.summary;
    expect(summary.lowStockMedicines).toBe(6);
    expect(summary.inventory).toEqual({ out: 2, critical: 2, low: 2, ok: 3 });
  });

  test('GET /inventory/low-stock lists the same medicines, most urgent first', async () => {
    const res = await invoke(getLowStockMedicines);
    expect(res.body.count).toBe(LOW_NAMES.length);
    expect(res.body.medicines.map((m) => m.name).sort()).toEqual([...LOW_NAMES].sort());
    expect(res.body.medicines.map((m) => m.stockLevel)).toEqual(['out', 'out', 'critical', 'critical', 'low', 'low']);
  });

  test('stored stockStatus uses the same levels', async () => {
    const byName = Object.fromEntries((await Medicine.find().lean()).map((m) => [m.name, m.stockStatus]));
    expect(byName).toEqual({
      Out: 'out',
      'Critical 1': 'critical',
      'Critical at half': 'critical',
      'Low just above half': 'low',
      'Low at reorder level': 'low',
      'OK just above': 'ok',
      'OK plenty': 'ok',
      'Zero reorder, empty': 'out',
      'Zero reorder, in stock': 'ok',
    });
  });
});

describe('low_stock alerts', () => {
  const lowStockAlerts = () => Alert.find({ alertType: 'low_stock' }).sort({ createdAt: 1, _id: 1 }).lean();

  test('one alert per low medicine, with level, severity and wording', async () => {
    await seedBoundaries();
    await runAlertGeneration();

    const byName = Object.fromEntries((await lowStockAlerts()).map((a) => [a.medicineName, a]));
    expect(Object.keys(byName).sort()).toEqual([...LOW_NAMES].sort());
    expect(byName.Out).toMatchObject({
      severity: 'critical',
      fingerprint: ['out'],
      message: 'Out of stock — reorder now (reorder level 50)',
    });
    expect(byName['Critical at half']).toMatchObject({
      severity: 'critical',
      fingerprint: ['critical'],
      message: 'Critically low: 25 left (reorder level 50)',
    });
    expect(byName['Low at reorder level']).toMatchObject({
      severity: 'warning',
      fingerprint: ['low'],
      message: 'Low stock: 50 left (reorder level 50)',
    });
    expect(byName['Zero reorder, empty']).toMatchObject({
      severity: 'critical',
      message: 'Out of stock — reorder now (reorder level 0)',
    });
  });

  test('evaluateMedicine handles odd and missing values', () => {
    const stock = (m) => evaluateMedicine({ batches: [], ...m }).find((c) => c.alertType === 'low_stock');
    expect(stock({ quantity: 3, reorderLevel: 7 }).fingerprint).toEqual(['critical']);
    expect(stock({ quantity: 4, reorderLevel: 7 }).fingerprint).toEqual(['low']);
    expect(stock({ quantity: -2, reorderLevel: 7 }).fingerprint).toEqual(['out']);
    expect(stock({ quantity: NaN, reorderLevel: 7 }).fingerprint).toEqual(['out']);
    expect(stock({ quantity: 5 })).toBeUndefined(); // no reorder level: nothing is "low"
    expect(stock({})).toMatchObject({ fingerprint: ['out'], message: 'Out of stock — reorder now (reorder level 0)' });
  });

  test('moving between levels updates the open alert (upgrade and downgrade); restocking closes it', async () => {
    const med = await add('Mover', 40); // low
    const setQty = (quantity) => Medicine.updateOne({ _id: med._id }, { quantity });
    const t = (min) => new Date(Date.UTC(2026, 10, 20, 10, min));

    await runAlertGeneration({ now: t(0) });
    let [alert] = await lowStockAlerts();
    expect(alert).toMatchObject({ severity: 'warning', fingerprint: ['low'], isCurrent: true });
    const id = alert._id.toString();

    await setQty(20); // critical
    await runAlertGeneration({ now: t(1) });
    [alert] = await lowStockAlerts();
    expect(alert._id.toString()).toBe(id);
    expect(alert).toMatchObject({ severity: 'critical', fingerprint: ['critical'], message: 'Critically low: 20 left (reorder level 50)' });
    expect(alert.lastChangedAt).toEqual(t(1));

    await setQty(0); // out
    await runAlertGeneration({ now: t(2) });
    [alert] = await lowStockAlerts();
    expect(alert).toMatchObject({ severity: 'critical', fingerprint: ['out'] });

    await setQty(45); // back to low: downgraded, same alert
    await runAlertGeneration({ now: t(3) });
    const alerts = await lowStockAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: 'warning', fingerprint: ['low'], message: 'Low stock: 45 left (reorder level 50)' });

    await setQty(51); // above the reorder level: closed
    await runAlertGeneration({ now: t(4) });
    [alert] = await lowStockAlerts();
    expect(alert).toMatchObject({ isCurrent: false, isResolved: true, autoResolved: true });
  });

  test('an acknowledged low alert is re-raised when stock becomes critical, but not when it recovers to low', async () => {
    const med = await add('Acked', 40);
    const setQty = (quantity) => Medicine.updateOne({ _id: med._id }, { quantity });

    await runAlertGeneration();
    await Alert.updateMany({}, { isResolved: true, resolvedAt: new Date() });

    await setQty(45); // still low: stays acknowledged
    await runAlertGeneration();
    expect(await lowStockAlerts()).toHaveLength(1);

    await setQty(10); // critical: new alert
    await runAlertGeneration();
    let alerts = await lowStockAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ isCurrent: true, isResolved: false, fingerprint: ['critical'] });

    await Alert.updateOne({ _id: alerts[1]._id }, { isResolved: true, resolvedAt: new Date() });
    await setQty(30); // recovered to low: covered by the acknowledged critical alert
    await runAlertGeneration();
    alerts = await lowStockAlerts();
    expect(alerts).toHaveLength(2);
  });
});

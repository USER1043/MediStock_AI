/**
 * Alert lifecycle against a real MongoDB (mongodb-memory-server): lazy regeneration, sharing one
 * in-flight run, self-clearing, updating instead of duplicating, acknowledgements that hold until
 * the situation changes, pruning, and the resolve endpoint.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.JWT_SECRET = 'alerts-lifecycle-test-secret';

const { createAlertService, alertService, markAlertsStaleOnWrite, DEFAULT_STALE_AFTER_MS, DEFAULT_RETENTION_MS } =
  await import('../services/alertService.js');
const { resolveAlert } = await import('../controllers/alertController.js');
const { getDashboardAnalytics } = await import('../controllers/reportController.js');
const { auditLogger } = await import('../middleware/auditLogger.js');
const { default: alertRoutes } = await import('../routes/alertRoutes.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Alert } = await import('../models/alertModel.js');
const { AuditLog } = await import('../models/auditLogModel.js');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// A clock the tests move by hand; expiry is evaluated against it too
let nowMs;
const clock = () => new Date(nowMs);
const advance = (ms) => { nowMs += ms; };
const daysFromNow = (n) => new Date(nowMs + n * DAY);

let service;

const batch = (batchNumber, inDays, quantity, rackNumber = 'R1') => ({
  batchNumber,
  expiryDate: daysFromNow(inDays),
  quantity,
  rackNumber,
});

const addMedicine = (name, batches, overrides = {}) =>
  Medicine.create({
    name,
    category: 'Analgesic',
    purchasePrice: 5,
    sellingPrice: 10,
    reorderLevel: 10,
    quantity: batches.reduce((sum, b) => sum + b.quantity, 0),
    batches,
    ...overrides,
  });

// Replace a medicine's batches and recompute its quantity, like an inventory edit would
const setBatches = (id, batches, extra = {}) =>
  Medicine.updateOne({ _id: id }, { batches, quantity: batches.reduce((s, b) => s + b.quantity, 0), ...extra });

const alertsOf = (medicineId, alertType) =>
  Alert.find({ medicineId, alertType }).sort({ createdAt: 1, _id: 1 }).lean();

const userResolve = (alertId, username = 'owner') =>
  Alert.updateOne(
    { _id: alertId },
    { isResolved: true, resolvedAt: clock(), resolvedBy: new mongoose.Types.ObjectId(), resolvedByName: username }
  );

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
  await Promise.all([Medicine.deleteMany({}), Alert.deleteMany({}), AuditLog.deleteMany({})]);
  nowMs = Date.now();
  service = createAlertService({ clock });
  alertService.reset();
});

afterEach(() => jest.restoreAllMocks());

describe('lazy generation', () => {
  test('a read regenerates only when the last run is at least 15 minutes old', async () => {
    const med = await addMedicine('Lazy Med', [batch('OLD-1', -2, 5)]);

    expect((await service.refreshIfStale()).ran).toBe(true); // never run
    expect(await alertsOf(med._id, 'expired')).toHaveLength(1);

    await Alert.deleteMany({}); // so a second run would be visible
    advance(DEFAULT_STALE_AFTER_MS - 1);
    expect((await service.refreshIfStale()).ran).toBe(false);
    expect(await Alert.countDocuments()).toBe(0);

    advance(1);
    expect((await service.refreshIfStale()).ran).toBe(true);
    expect(await alertsOf(med._id, 'expired')).toHaveLength(1);
    expect(service.lastRunAt).toEqual(clock());
  });

  test('a stock change marks alerts stale, so the next read regenerates at once', async () => {
    await service.refreshIfStale();
    advance(MINUTE);
    expect((await service.refreshIfStale()).ran).toBe(false);

    service.markStale();
    expect((await service.refreshIfStale()).ran).toBe(true);
    expect((await service.refreshIfStale()).ran).toBe(false);
  });

  test('concurrent reads share one in-flight run', async () => {
    const med = await addMedicine('Busy Med', [batch('SOON-1', 3, 5)]);
    const find = jest.spyOn(Medicine, 'find');

    const results = await Promise.all([service.refreshIfStale(), service.refreshIfStale(), service.refreshIfStale()]);

    expect(find).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ran)).toBe(true);
    expect(new Set(results.map((r) => r.summary)).size).toBe(1);
    expect(await alertsOf(med._id, 'near_expiry')).toHaveLength(1);
  });

  test('a forced run waits for the in-flight one and then runs again', async () => {
    await addMedicine('Forced Med', [batch('SOON-1', 3, 5)]);
    const find = jest.spyOn(Medicine, 'find');

    await Promise.all([service.refreshIfStale(), service.generate()]);

    expect(find).toHaveBeenCalledTimes(2);
  });

  test('a failed run is reported, not thrown, and the next read retries', async () => {
    jest.spyOn(Medicine, 'find').mockImplementationOnce(() => { throw new Error('db down'); });

    const failed = await service.refreshIfStale();
    expect(failed.ran).toBe(false);
    expect(failed.error.message).toBe('db down');
    expect(service.lastRunAt).toBeNull();

    expect((await service.refreshIfStale()).ran).toBe(true);
  });

  test('the dashboard counts critical alerts without anyone pressing generate', async () => {
    await addMedicine('Expired Med', [batch('OLD-1', -1, 4), batch('OK-1', 200, 40)]);
    await addMedicine('Empty Med', [batch('Z-1', 200, 0)]);

    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn((body) => { res.body = body; return res; });
    await getDashboardAnalytics({ user: { role: 'staff' } }, res);

    // Expired Med: expired batch; Empty Med: out of stock
    expect(res.body.analytics.kpis.activeCriticalAlerts).toBe(2);
    expect(res.body.analytics.alertSummary.critical).toBe(2);
  });
});

describe('markAlertsStaleOnWrite', () => {
  const appWith = (fake) => {
    const app = express();
    app.use(markAlertsStaleOnWrite(fake));
    app.post('/ok', (req, res) => res.json({ ok: true }));
    app.post('/bad', (req, res) => res.status(400).json({ ok: false }));
    app.get('/read', (req, res) => res.json({ ok: true }));
    return app;
  };

  test('marks alerts stale after a successful write only', async () => {
    const fake = { markStale: jest.fn() };
    const app = appWith(fake);

    await request(app).get('/read');
    await request(app).post('/bad');
    expect(fake.markStale).not.toHaveBeenCalled();

    await request(app).post('/ok');
    expect(fake.markStale).toHaveBeenCalledTimes(1);
  });
});

describe('self-clearing', () => {
  test('a near-expiry alert resolves itself when the batch sells out', async () => {
    const med = await addMedicine('Clearing Med', [batch('SOON-1', 3, 5), batch('OK-1', 200, 50)]);
    await service.generate();

    advance(MINUTE);
    await setBatches(med._id, [batch('SOON-1', 3, 0), batch('OK-1', 200, 50)]);
    await service.generate();

    const [alert] = await alertsOf(med._id, 'near_expiry');
    expect(alert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false, resolvedBy: null });
    expect(alert.resolvedAt).toEqual(clock());
    expect(alert.clearedAt).toEqual(clock());
  });

  test('a low-stock alert resolves itself after a restock, and overstock after stock drops', async () => {
    const low = await addMedicine('Low Med', [batch('L-1', 200, 2)]);
    const over = await addMedicine('Over Med', [batch('O-1', 200, 100)]);
    await service.generate();
    expect(await alertsOf(low._id, 'low_stock')).toHaveLength(1);
    expect(await alertsOf(over._id, 'overstock')).toHaveLength(1);

    await setBatches(low._id, [batch('L-1', 200, 20)]);
    await setBatches(over._id, [batch('O-1', 200, 20)]);
    await service.generate();

    const [lowAlert] = await alertsOf(low._id, 'low_stock');
    const [overAlert] = await alertsOf(over._id, 'overstock');
    expect(lowAlert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
    expect(overAlert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
  });

  test("a deleted medicine's alerts resolve themselves", async () => {
    const med = await addMedicine('Gone Med', [batch('OLD-1', -3, 5)]);
    await service.generate();

    await Medicine.deleteOne({ _id: med._id });
    await service.generate();

    const [alert] = await alertsOf(med._id, 'expired');
    expect(alert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
  });
});

describe('open alerts are updated, not duplicated', () => {
  test('a second batch starting to expire updates the unresolved alert', async () => {
    const med = await addMedicine('Growing Med', [batch('SOON-1', 3, 5, 'A1'), batch('LATER-1', 30, 9, 'B2')]);
    await service.generate();
    const [before] = await alertsOf(med._id, 'near_expiry');

    advance(25 * DAY); // LATER-1 now has 5 days left; SOON-1 has expired
    await setBatches(med._id, [batch('SOON-1', -22, 0, 'A1'), batch('LATER-1', 5, 9, 'B2'), batch('NEW-1', 6, 3, 'C3')]);
    await service.generate();

    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(1);
    const [after] = alerts;
    expect(after._id).toEqual(before._id);
    expect(after.isResolved).toBe(false);
    expect(after.fingerprint).toHaveLength(2);
    expect(after.message).toContain('LATER-1');
    expect(after.message).toContain('NEW-1');
    expect(after.message).not.toContain('SOON-1');
    expect(after.batches.map((b) => b.rackNumber).sort()).toEqual(['B2', 'C3']);
    expect(after.lastChangedAt).toEqual(clock());
    expect(after.createdAt).toEqual(before.createdAt);
  });

  test('a quantity change refreshes the message without counting as a change', async () => {
    const med = await addMedicine('Selling Med', [batch('SOON-1', 3, 8)]);
    await service.generate();
    const [before] = await alertsOf(med._id, 'near_expiry');

    advance(MINUTE);
    await setBatches(med._id, [batch('SOON-1', 3, 6)]);
    await service.generate();

    const [after] = await alertsOf(med._id, 'near_expiry');
    expect(after.message).toContain('qty 6');
    expect(after.lastChangedAt).toEqual(before.lastChangedAt);
  });

  test('low stock running out updates the unresolved alert', async () => {
    const med = await addMedicine('Running Med', [batch('R-1', 200, 3)]);
    await service.generate();

    await setBatches(med._id, [batch('R-1', 200, 0)]);
    await service.generate();

    const alerts = await alertsOf(med._id, 'low_stock');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].fingerprint).toEqual(['out_of_stock']);
    expect(alerts[0].message).toMatch(/out of stock/i);
  });
});

describe('resolving acknowledges until the situation changes', () => {
  test('an acknowledged near-expiry alert is not raised again on later runs', async () => {
    const med = await addMedicine('Ack Med', [batch('SOON-1', 3, 5)]);
    await service.generate();
    const [alert] = await alertsOf(med._id, 'near_expiry');
    await userResolve(alert._id);

    advance(DEFAULT_STALE_AFTER_MS);
    await service.refreshIfStale();
    await service.generate();

    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ isResolved: true, isCurrent: true, resolvedByName: 'owner' });
  });

  test('a second batch starting to expire raises a new alert after an acknowledgement', async () => {
    const med = await addMedicine('Ack Grow Med', [batch('SOON-1', 3, 5), batch('NEXT-1', 20, 7)]);
    await service.generate();
    const [first] = await alertsOf(med._id, 'near_expiry');
    await userResolve(first._id);

    advance(14 * DAY); // NEXT-1 now has 6 days left
    await setBatches(med._id, [batch('SOON-1', -11, 0), batch('NEXT-1', 6, 7)]);
    await service.generate();

    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ _id: first._id, isResolved: true, isCurrent: false });
    expect(alerts[1]).toMatchObject({ isResolved: false, isCurrent: true });
    expect(alerts[1].message).toContain('NEXT-1');
  });

  test('one of two acknowledged batches selling out does not raise a new alert', async () => {
    const med = await addMedicine('Ack Shrink Med', [batch('A-1', 3, 5), batch('B-1', 4, 5)]);
    await service.generate();
    const [alert] = await alertsOf(med._id, 'near_expiry');
    await userResolve(alert._id);

    await setBatches(med._id, [batch('A-1', 3, 0), batch('B-1', 4, 5)]);
    await service.generate();

    expect(await alertsOf(med._id, 'near_expiry')).toHaveLength(1);
  });

  test('acknowledged low stock: restock above the threshold, then drop below again -> new alert', async () => {
    const med = await addMedicine('Ack Low Med', [batch('L-1', 200, 3)]);
    await service.generate();
    const [first] = await alertsOf(med._id, 'low_stock');
    await userResolve(first._id);

    await setBatches(med._id, [batch('L-1', 200, 30)]);
    await service.generate();
    const [cleared] = await alertsOf(med._id, 'low_stock');
    expect(cleared).toMatchObject({ isResolved: true, isCurrent: false, autoResolved: false, resolvedByName: 'owner' });
    expect(cleared.clearedAt).toEqual(clock());

    await setBatches(med._id, [batch('L-1', 200, 3)]); // same "low" fingerprint as before
    await service.generate();

    const alerts = await alertsOf(med._id, 'low_stock');
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ isResolved: false, isCurrent: true, fingerprint: ['low'] });
  });

  test('acknowledged low stock: stock hitting zero raises a new alert', async () => {
    const med = await addMedicine('Ack Zero Med', [batch('Z-1', 200, 3)]);
    await service.generate();
    const [first] = await alertsOf(med._id, 'low_stock');
    await userResolve(first._id);

    await setBatches(med._id, [batch('Z-1', 200, 0)]);
    await service.generate();

    const alerts = await alertsOf(med._id, 'low_stock');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ isCurrent: false, fingerprint: ['low'] });
    expect(alerts[1]).toMatchObject({ isResolved: false, isCurrent: true, fingerprint: ['out_of_stock'] });
  });

  test('the database refuses a second current alert for the same medicine and type', async () => {
    const med = await addMedicine('Unique Med', [batch('OLD-1', -3, 5)]);
    await service.generate();

    await expect(
      Alert.create({ medicineId: med._id, alertType: 'expired', message: 'dup', isCurrent: true })
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('pruning', () => {
  const closedAlert = (medicineId, closedDaysAgo, extra = {}) => ({
    medicineId,
    alertType: 'near_expiry',
    message: 'old',
    isResolved: true,
    isCurrent: false,
    resolvedAt: daysFromNow(-closedDaysAgo),
    clearedAt: daysFromNow(-closedDaysAgo),
    ...extra,
  });

  test(`keeps history for ${DEFAULT_RETENTION_MS / DAY} days after an alert closes`, async () => {
    // Expired batch, 5 units against a reorder level of 4: only an "expired" alert holds
    const med = await addMedicine('History Med', [batch('OLD-1', -3, 5)], { reorderLevel: 4 });
    await service.generate();
    // Acknowledged long ago but still current: it is what stops the alert coming back, so it stays
    const [acknowledged] = await alertsOf(med._id, 'expired');
    await Alert.updateOne({ _id: acknowledged._id }, { isResolved: true, resolvedAt: daysFromNow(-200) });

    const [old, recent, superseded] = await Alert.insertMany([
      closedAlert(med._id, 91),
      closedAlert(med._id, 89),
      // replaced by a newer alert, never cleared: measured from when it was resolved
      { ...closedAlert(med._id, 120), alertType: 'low_stock', clearedAt: null },
    ]);
    const unresolved = await Alert.create({ medicineId: med._id, alertType: 'overstock', message: 'open', createdAt: daysFromNow(-300) });
    await Alert.updateOne({ _id: unresolved._id }, { isCurrent: false }); // unresolved alerts are never pruned

    const { pruned } = await service.generate();

    const left = (await Alert.find().lean()).map((a) => a._id.toString()).sort();
    expect(left).toEqual([recent._id, acknowledged._id, unresolved._id].map(String).sort());
    expect(pruned).toBe(2);
    expect(left).not.toContain(old._id.toString());
    expect(left).not.toContain(superseded._id.toString());
  });
});

describe('PUT /api/alerts/:id/resolve', () => {
  const user = { id: new mongoose.Types.ObjectId().toString(), username: 'staffer', role: 'staff' };

  const app = () => {
    const a = express();
    a.use(express.json());
    a.use(auditLogger);
    a.use('/api/alerts', alertRoutes);
    return a;
  };
  const token = () => jwt.sign(user, process.env.JWT_SECRET);
  const settle = () => new Promise((r) => setTimeout(r, 100)); // audit middleware writes after 'finish'

  test('records who resolved it and when, and writes one ALERT_RESOLVED activity entry', async () => {
    const med = await addMedicine('Resolve Med', [batch('OLD-1', -3, 5)]);
    await service.generate();
    const [alert] = await alertsOf(med._id, 'expired');

    const before = Date.now();
    const res = await request(app())
      .put(`/api/alerts/${alert._id}/resolve`)
      .set('Authorization', `Bearer ${token()}`);
    await settle();

    expect(res.status).toBe(200);
    const saved = await Alert.findById(alert._id).lean();
    expect(saved).toMatchObject({ isResolved: true, autoResolved: false, resolvedByName: 'staffer', isCurrent: true });
    expect(saved.resolvedBy.toString()).toBe(user.id);
    expect(saved.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);

    const entries = await AuditLog.find().lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'ALERT_RESOLVED', module: 'Alerts', username: 'staffer' });
    expect(entries[0].userId.toString()).toBe(user.id);
    expect(entries[0].details).toMatchObject({ medicineName: 'Resolve Med', alertType: 'expired' });
  });

  test('a second resolve is a 409 and writes no second entry; unknown ids are 404', async () => {
    const med = await addMedicine('Twice Med', [batch('OLD-1', -3, 5)]);
    await service.generate();
    const [alert] = await alertsOf(med._id, 'expired');
    const put = (id) => request(app()).put(`/api/alerts/${id}/resolve`).set('Authorization', `Bearer ${token()}`);

    expect((await put(alert._id)).status).toBe(200);
    expect((await put(alert._id)).status).toBe(409);
    expect((await put(new mongoose.Types.ObjectId())).status).toBe(404);
    expect((await put('not-an-id')).status).toBe(404);
    await settle();

    expect(await AuditLog.countDocuments({ action: 'ALERT_RESOLVED' })).toBe(1);
  });

  test('the handler works without the HTTP layer too', async () => {
    const med = await addMedicine('Direct Med', [batch('OLD-1', -3, 5)]);
    await service.generate();
    const [alert] = await alertsOf(med._id, 'expired');

    const res = {};
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    await resolveAlert({ params: { id: alert._id.toString() }, user, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.alert.resolvedByName).toBe('staffer');
  });
});

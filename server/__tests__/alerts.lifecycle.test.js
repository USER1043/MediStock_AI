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

// Edit a medicine's batches in place, keeping their _ids as inventory edits and top-ups do, and
// recompute its quantity. changes: { [batchNumber]: { quantity?, expiryDate?, rackNumber? } | null (remove) }
const editBatches = async (id, changes = {}, added = []) => {
  const { batches } = await Medicine.findById(id).lean();
  const next = batches
    .filter((b) => changes[b.batchNumber] !== null)
    .map((b) => ({ ...b, ...(changes[b.batchNumber] || {}) }))
    .concat(added);
  await Medicine.updateOne({ _id: id }, { batches: next, quantity: next.reduce((sum, b) => sum + b.quantity, 0) });
};

const batchIdOf = async (medicineId, batchNumber) =>
  (await Medicine.findById(medicineId).lean()).batches.find((b) => b.batchNumber === batchNumber)._id;

// The alerts for one batch, oldest first
const batchAlerts = async (medicineId, batchNumber, alertType) =>
  Alert.find({ medicineId, alertType, batchId: await batchIdOf(medicineId, batchNumber) }).sort({ createdAt: 1, _id: 1 }).lean();

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
  test('a near-expiry alert resolves itself when its batch sells out', async () => {
    const med = await addMedicine('Clearing Med', [batch('SOON-1', 3, 5), batch('OK-1', 200, 50)]);
    await service.generate();

    advance(MINUTE);
    await editBatches(med._id, { 'SOON-1': { quantity: 0 } });
    await service.generate();

    const [alert] = await alertsOf(med._id, 'near_expiry');
    expect(alert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false, resolvedBy: null });
    expect(alert.resolvedAt).toEqual(clock());
    expect(alert.clearedAt).toEqual(clock());
  });

  test('a removed batch clears its alert', async () => {
    const med = await addMedicine('Removed Med', [batch('OLD-1', -3, 5), batch('OK-1', 200, 50)]);
    await service.generate();

    await editBatches(med._id, { 'OLD-1': null });
    await service.generate();

    const [alert] = await alertsOf(med._id, 'expired');
    expect(alert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
  });

  test('a low-stock alert resolves itself after a restock, and overstock after stock drops', async () => {
    const low = await addMedicine('Low Med', [batch('L-1', 200, 2)]);
    const over = await addMedicine('Over Med', [batch('O-1', 200, 100)]);
    await service.generate();
    expect(await alertsOf(low._id, 'low_stock')).toHaveLength(1);
    expect(await alertsOf(over._id, 'overstock')).toHaveLength(1);

    await editBatches(low._id, { 'L-1': { quantity: 20 } });
    await editBatches(over._id, { 'O-1': { quantity: 20 } });
    await service.generate();

    const [lowAlert] = await alertsOf(low._id, 'low_stock');
    const [overAlert] = await alertsOf(over._id, 'overstock');
    expect(lowAlert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
    expect(overAlert).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
  });

  test("a deleted medicine's alerts resolve themselves", async () => {
    const med = await addMedicine('Gone Med', [batch('OLD-1', -3, 5), batch('OLD-2', -1, 5)]);
    await service.generate();
    expect(await alertsOf(med._id, 'expired')).toHaveLength(2);

    await Medicine.deleteOne({ _id: med._id });
    await service.generate();

    const alerts = await alertsOf(med._id, 'expired');
    expect(alerts.every((a) => a.isResolved && a.autoResolved && !a.isCurrent)).toBe(true);
  });
});

describe('expiry alerts are per batch', () => {
  test('two expiring batches give two alerts, each naming its own batch', async () => {
    const med = await addMedicine('Two Med', [batch('A-1', 2, 5, 'R1'), batch('B-1', 5, 7, 'R2'), batch('OK-1', 200, 50)]);
    await service.generate();

    const [a] = await batchAlerts(med._id, 'A-1', 'near_expiry');
    const [b] = await batchAlerts(med._id, 'B-1', 'near_expiry');
    expect(await alertsOf(med._id, 'near_expiry')).toHaveLength(2);
    expect(a.message).toMatch(/^Batch A-1 expires on \d{2} \w{3} \d{4} \(rack R1, qty 5\)$/);
    expect(b.message).toMatch(/^Batch B-1 expires on .* \(rack R2, qty 7\)$/);
    expect(a.batch).toMatchObject({ batchNumber: 'A-1', rackNumber: 'R1', quantity: 5 });
    expect(a.message).not.toContain('B-1');
  });

  test('resolving one batch alert leaves the other open', async () => {
    const med = await addMedicine('Split Med', [batch('A-1', 2, 5), batch('B-1', 5, 7), batch('OK-1', 200, 50)]);
    await service.generate();
    const [a] = await batchAlerts(med._id, 'A-1', 'near_expiry');
    await userResolve(a._id);

    await service.generate();

    expect(await batchAlerts(med._id, 'A-1', 'near_expiry')).toEqual([expect.objectContaining({ isResolved: true, isCurrent: true })]);
    expect(await batchAlerts(med._id, 'B-1', 'near_expiry')).toEqual([expect.objectContaining({ isResolved: false, isCurrent: true })]);
  });

  test('one batch selling out clears only its own alert', async () => {
    const med = await addMedicine('Sellout Med', [batch('A-1', 2, 5), batch('B-1', 5, 7), batch('OK-1', 200, 50)]);
    await service.generate();
    const [bBefore] = await batchAlerts(med._id, 'B-1', 'near_expiry');

    await editBatches(med._id, { 'A-1': { quantity: 0 } });
    await service.generate();

    expect(await batchAlerts(med._id, 'A-1', 'near_expiry')).toEqual([
      expect.objectContaining({ isResolved: true, autoResolved: true, isCurrent: false }),
    ]);
    const [bAfter] = await batchAlerts(med._id, 'B-1', 'near_expiry');
    expect(bAfter).toMatchObject({ _id: bBefore._id, isResolved: false, isCurrent: true });
  });

  test('a new expiring batch raises only its own alert', async () => {
    const med = await addMedicine('Growing Med', [batch('A-1', 2, 5), batch('OK-1', 200, 50)]);
    await service.generate();
    const [aBefore] = await batchAlerts(med._id, 'A-1', 'near_expiry');
    await userResolve(aBefore._id);

    await editBatches(med._id, {}, [batch('NEW-1', 6, 3, 'C3')]);
    await service.generate();

    expect(await batchAlerts(med._id, 'A-1', 'near_expiry')).toEqual([
      expect.objectContaining({ _id: aBefore._id, isResolved: true, isCurrent: true }),
    ]);
    const newAlerts = await batchAlerts(med._id, 'NEW-1', 'near_expiry');
    expect(newAlerts).toHaveLength(1);
    expect(newAlerts[0]).toMatchObject({ isResolved: false, batch: { batchNumber: 'NEW-1', rackNumber: 'C3' } });
  });

  test('a quantity or rack change refreshes the message without counting as a change', async () => {
    const med = await addMedicine('Selling Med', [batch('SOON-1', 3, 8, 'A1')]);
    await service.generate();
    const [before] = await alertsOf(med._id, 'near_expiry');

    advance(MINUTE);
    await editBatches(med._id, { 'SOON-1': { quantity: 6, rackNumber: 'B7' } });
    await service.generate();

    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]._id).toEqual(before._id);
    expect(alerts[0].message).toContain('(rack B7, qty 6)');
    expect(alerts[0].batch).toMatchObject({ rackNumber: 'B7', quantity: 6 });
    expect(alerts[0].lastChangedAt).toEqual(before.lastChangedAt);
  });

  test('an expiry edit within the window updates the alert in place; moving it out of the window clears it', async () => {
    const med = await addMedicine('Edited Med', [batch('E-1', 3, 8)]);
    await service.generate();
    const [before] = await alertsOf(med._id, 'near_expiry');

    advance(MINUTE);
    await editBatches(med._id, { 'E-1': { expiryDate: daysFromNow(5) } });
    await service.generate();
    const [moved] = await alertsOf(med._id, 'near_expiry');
    expect(moved).toMatchObject({ _id: before._id, isResolved: false, isCurrent: true });
    expect(moved.lastChangedAt).toEqual(clock());
    expect(moved.message).not.toBe(before.message);
    expect(new Date(moved.batch.expiryDate)).toEqual(daysFromNow(5));

    await editBatches(med._id, { 'E-1': { expiryDate: daysFromNow(60) } });
    await service.generate();
    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ isResolved: true, autoResolved: true, isCurrent: false });
  });

  test('the database allows one current alert per batch and type, and one current low_stock per medicine', async () => {
    const med = await addMedicine('Unique Med', [batch('OLD-1', -3, 2), batch('OLD-2', -2, 1)]);
    await service.generate();
    const oldOne = await batchIdOf(med._id, 'OLD-1');

    // Two expired batches coexist as current alerts, and also with a near_expiry one for the same batch
    expect(await Alert.countDocuments({ medicineId: med._id, alertType: 'expired', isCurrent: true })).toBe(2);
    await Alert.create({ medicineId: med._id, alertType: 'near_expiry', batchId: oldOne, message: 'other type' });

    await expect(
      Alert.create({ medicineId: med._id, alertType: 'expired', batchId: oldOne, message: 'dup', isCurrent: true })
    ).rejects.toMatchObject({ code: 11000 });
    expect(await alertsOf(med._id, 'low_stock')).toHaveLength(1); // quantity 3 against a reorder level of 10
    await expect(
      Alert.create({ medicineId: med._id, alertType: 'low_stock', message: 'dup', isCurrent: true })
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('open stock alerts are updated, not duplicated', () => {
  test('low stock running out updates the unresolved alert', async () => {
    const med = await addMedicine('Running Med', [batch('R-1', 200, 3)]);
    await service.generate();

    await editBatches(med._id, { 'R-1': { quantity: 0 } });
    await service.generate();

    const alerts = await alertsOf(med._id, 'low_stock');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].fingerprint).toEqual(['out_of_stock']);
    expect(alerts[0].message).toMatch(/out of stock/i);
  });
});

describe('resolving acknowledges until the situation changes', () => {
  test('an acknowledged batch alert stays quiet across reruns', async () => {
    const med = await addMedicine('Ack Med', [batch('SOON-1', 3, 5)]);
    await service.generate();
    const [alert] = await alertsOf(med._id, 'near_expiry');
    await userResolve(alert._id);

    for (let i = 0; i < 3; i++) {
      advance(DEFAULT_STALE_AFTER_MS);
      await service.refreshIfStale();
    }
    await editBatches(med._id, { 'SOON-1': { quantity: 4 } }); // a sale is not a new situation
    await service.generate();

    const alerts = await alertsOf(med._id, 'near_expiry');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ isResolved: true, isCurrent: true, resolvedByName: 'owner' });
  });

  test('near expiry -> expired raises a critical alert even though the near-expiry one was acknowledged', async () => {
    const med = await addMedicine('Turning Med', [batch('T-1', 2, 5), batch('OK-1', 200, 50)]);
    await service.generate();
    const [near] = await batchAlerts(med._id, 'T-1', 'near_expiry');
    await userResolve(near._id);

    advance(3 * DAY); // T-1 is now one day past its expiry
    await service.generate();

    const [nearAfter] = await batchAlerts(med._id, 'T-1', 'near_expiry');
    expect(nearAfter).toMatchObject({ isResolved: true, autoResolved: false, isCurrent: false, resolvedByName: 'owner' });
    expect(nearAfter.clearedAt).toEqual(clock());
    const expired = await batchAlerts(med._id, 'T-1', 'expired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ severity: 'critical', isResolved: false, isCurrent: true });
    expect(expired[0].message).toMatch(/^Batch T-1 expired on .* and is still in stock \(rack R1, qty 5\)$/);
  });

  test('an acknowledged batch that hits zero and is restocked while still expiring raises a new alert', async () => {
    const med = await addMedicine('Restocked Med', [batch('S-1', 4, 5), batch('OK-1', 200, 50)]);
    await service.generate();
    const [first] = await batchAlerts(med._id, 'S-1', 'near_expiry');
    await userResolve(first._id);

    await editBatches(med._id, { 'S-1': { quantity: 0 } });
    await service.generate();
    await editBatches(med._id, { 'S-1': { quantity: 6 } }); // same batch (_id), topped up again
    await service.generate();

    const alerts = await batchAlerts(med._id, 'S-1', 'near_expiry');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ _id: first._id, isResolved: true, isCurrent: false });
    expect(alerts[1]).toMatchObject({ isResolved: false, isCurrent: true });
    expect(alerts[1].message).toContain('qty 6');
  });

  test('acknowledged low stock: restock above the threshold, then drop below again -> new alert', async () => {
    const med = await addMedicine('Ack Low Med', [batch('L-1', 200, 3)]);
    await service.generate();
    const [first] = await alertsOf(med._id, 'low_stock');
    await userResolve(first._id);

    await editBatches(med._id, { 'L-1': { quantity: 30 } });
    await service.generate();
    const [cleared] = await alertsOf(med._id, 'low_stock');
    expect(cleared).toMatchObject({ isResolved: true, isCurrent: false, autoResolved: false, resolvedByName: 'owner' });
    expect(cleared.clearedAt).toEqual(clock());

    await editBatches(med._id, { 'L-1': { quantity: 3 } }); // same "low" fingerprint as before
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

    await editBatches(med._id, { 'Z-1': { quantity: 0 } });
    await service.generate();

    const alerts = await alertsOf(med._id, 'low_stock');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ isCurrent: false, fingerprint: ['low'] });
    expect(alerts[1]).toMatchObject({ isResolved: false, isCurrent: true, fingerprint: ['out_of_stock'] });
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

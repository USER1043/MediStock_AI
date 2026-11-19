/**
 * Staff review forecast drafts, the owner decides. `/api/forecast/recommendations` used to be open to
 * any logged-in user and its PUT and DELETE acted on ANY purchase order by id, so staff could approve a
 * draft (→ Pending, the same step as the owner-only PO activation) and delete Ordered or Received POs.
 * Now staff may list, create and adjust drafts; approving, rejecting and deleting are owner-only, and
 * only forecast drafts (AI_Draft, or Adjusted) can be changed at all. Runs the API routers as server.js
 * mounts them (audit logger included), against a real MongoDB (mongodb-memory-server), with JWTs signed
 * like the login route signs them.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.JWT_SECRET = 'recommendation-permissions-test-secret';

const { mountApiRouters } = await import('../routes/index.js');
const { auditLogger } = await import('../middleware/auditLogger.js');
const { AuditLog } = await import('../models/auditLogModel.js');
const { User } = await import('../models/userModel.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Supplier, PurchaseOrder } = await import('../models/supplierModels.js');

const DAY = 24 * 60 * 60 * 1000;

let server;
let app;
let owner;
let ownerToken;
let staffToken;
let medicine;
let supplier;

const tokenFor = (user) =>
  jwt.sign({ id: user._id.toString(), username: user.username, email: user.email, role: user.role }, process.env.JWT_SECRET);

const as = (token) => ({
  put: (id, body) => request(app).put(`/api/forecast/recommendations/${id}`).set('Authorization', `Bearer ${token}`).send(body),
  del: (id) => request(app).delete(`/api/forecast/recommendations/${id}`).set('Authorization', `Bearer ${token}`),
  post: (body) => request(app).post('/api/forecast/recommendations').set('Authorization', `Bearer ${token}`).send(body),
});

const addPo = (order_status = 'AI_Draft', overrides = {}) =>
  PurchaseOrder.create({
    order_number: `PO-AI-${Math.random().toString(36).slice(2, 10)}`,
    medicine_id: medicine._id,
    medicine_name: medicine.name,
    supplier_id: supplier._id,
    requested_quantity: 77,
    unit_price: 2,
    total_amount: 154,
    expected_delivery_date: new Date(Date.now() + 7 * DAY),
    order_status,
    created_by: owner._id,
    ai_forecast_reference: { demand_predicted: 77, forecast_date: new Date(), priority: 'High' },
    ...overrides,
  });

const stored = (po) => PurchaseOrder.findById(po._id).lean();
// Let the fire-and-forget audit writes land
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  app = express();
  app.use(express.json());
  app.use(auditLogger);
  mountApiRouters(app);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([AuditLog, User, Medicine, Supplier, PurchaseOrder].map((M) => M.deleteMany({})));
  owner = await User.create({ username: 'owner', email: 'owner@test.local', password: 'Owner#2024', role: 'owner' });
  const staff = await User.create({ username: 'staff', email: 'staff@test.local', password: 'Staff#2024', role: 'staff' });
  ownerToken = tokenFor(owner);
  staffToken = tokenFor(staff);
  supplier = await Supplier.create({
    supplier_name: 'Acme Pharma',
    contact_info: { phone: '9000000000', email: 'acme@test.local', address: '1 Main St' },
    medicine_categories: ['Analgesic'],
  });
  medicine = await Medicine.create({
    name: 'Paracetamol 500mg',
    category: 'Analgesic',
    purchasePrice: 2,
    sellingPrice: 5,
    reorderLevel: 10,
    quantity: 1000,
    batches: [{ batchNumber: 'B1', expiryDate: new Date(Date.now() + 200 * DAY), quantity: 1000, rackNumber: 'R1' }],
  });
});

describe('staff: adjust only', () => {
  test('staff can adjust the quantity, priority and date of a draft', async () => {
    const po = await addPo();

    const res = await as(staffToken).put(po._id, { status: 'adjusted', optimalReorderQty: 40, priority: 'low' });

    expect(res.status).toBe(200);
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'Adjusted', requested_quantity: 40, total_amount: 80 });
    expect(after.ai_forecast_reference.priority).toBe('Low');
    expect(after.approved_by).toBeUndefined();
  });

  test('staff can re-adjust an adjusted draft, and change its date and priority without a status', async () => {
    const po = await addPo('Adjusted');

    const readjust = await as(staffToken).put(po._id, { status: 'adjusted', optimalReorderQty: 12 });
    const reschedule = await as(staffToken).put(po._id, { restockingDate: '2030-01-01', priority: 'medium' });

    expect(readjust.status).toBe(200);
    expect(reschedule.status).toBe(200);
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'Adjusted', requested_quantity: 12 });
    expect(after.expected_delivery_date.toISOString()).toMatch(/^2030-01-01/);
    expect(after.ai_forecast_reference.priority).toBe('Medium');
  });

  test('staff can still add a manual recommendation, and it is always an AI_Draft', async () => {
    const res = await as(staffToken).post({
      medicineId: medicine._id.toString(),
      optimalReorderQty: 30,
      priority: 'high',
      order_status: 'Received',
      approved_by: owner._id.toString(),
    });

    expect(res.status).toBe(201);
    const po = await PurchaseOrder.findById(res.body.recommendation._id).lean();
    expect(po.order_status).toBe('AI_Draft');
    expect(po.approved_by).toBeUndefined();
    expect(po.created_by.toString()).not.toBe(owner._id.toString());
  });

  test.each([['approved'], ['rejected']])('staff cannot set status "%s": 403, PO unchanged, nothing audited', async (status) => {
    const po = await addPo();
    const before = await stored(po);

    const res = await as(staffToken).put(po._id, { status, approvedQty: 999 });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorCode: 'OWNER_ONLY' });
    expect(await stored(po)).toEqual(before);
    await settle();
    expect(await AuditLog.countDocuments({ module: 'Forecasting' })).toBe(0);
  });

  test('staff cannot delete a draft: 403 and the draft is still there', async () => {
    const po = await addPo();
    const before = await stored(po);

    const res = await as(staffToken).del(po._id);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorCode: 'OWNER_ONLY' });
    expect(await stored(po)).toEqual(before);
  });

  test('staff cannot delete an Ordered or Received PO either', async () => {
    const ordered = await addPo('Ordered');
    const received = await addPo('Received');

    expect((await as(staffToken).del(ordered._id)).status).toBe(403);
    expect((await as(staffToken).del(received._id)).status).toBe(403);
    expect(await PurchaseOrder.countDocuments({ _id: { $in: [ordered._id, received._id] } })).toBe(2);
  });
});

describe('owner decides', () => {
  test('approving a draft moves it to Pending, records the approver and is audited as REORDER_APPROVED', async () => {
    const po = await addPo();

    const res = await as(ownerToken).put(po._id, { status: 'approved', approvedQty: 90 });

    expect(res.status).toBe(200);
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'Pending', requested_quantity: 90, total_amount: 180 });
    expect(after.approved_by.toString()).toBe(owner._id.toString());
    await settle();
    expect(await AuditLog.countDocuments({ action: 'REORDER_APPROVED', username: 'owner' })).toBe(1);
  });

  test('an adjusted draft can be approved', async () => {
    const po = await addPo('Adjusted');
    const res = await as(ownerToken).put(po._id, { status: 'approved' });
    expect(res.status).toBe(200);
    expect((await stored(po)).order_status).toBe('Pending');
  });

  test('rejecting a draft cancels it', async () => {
    const po = await addPo();
    const res = await as(ownerToken).put(po._id, { status: 'rejected' });
    expect(res.status).toBe(200);
    expect((await stored(po)).order_status).toBe('Cancelled');
  });

  test('the owner can delete a draft', async () => {
    const po = await addPo();
    const adjusted = await addPo('Adjusted');

    expect((await as(ownerToken).del(po._id)).status).toBe(200);
    expect((await as(ownerToken).del(adjusted._id)).status).toBe(200);

    expect(await stored(po)).toBeNull();
    expect(await stored(adjusted)).toBeNull();
    await settle();
    expect(await AuditLog.countDocuments({ action: 'RECOMMENDATION_DELETED' })).toBe(2);
  });
});

describe('only forecast drafts can be changed', () => {
  test.each([['Pending'], ['Approved'], ['Ordered'], ['Shipped'], ['Received'], ['Cancelled']])(
    'the owner gets 409 on PUT and DELETE for a %s PO, and it is unchanged',
    async (order_status) => {
      const po = await addPo(order_status);
      const before = await stored(po);

      const put = await as(ownerToken).put(po._id, { status: 'adjusted', optimalReorderQty: 1 });
      const approve = await as(ownerToken).put(po._id, { status: 'approved' });
      const del = await as(ownerToken).del(po._id);

      for (const res of [put, approve, del]) {
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, errorCode: 'NOT_A_DRAFT' });
      }
      expect(await stored(po)).toEqual(before);
    }
  );

  test('staff also get 409 when adjusting a non-draft PO', async () => {
    const po = await addPo('Ordered');
    const before = await stored(po);
    const res = await as(staffToken).put(po._id, { status: 'adjusted', optimalReorderQty: 1 });
    expect(res.status).toBe(409);
    expect(await stored(po)).toEqual(before);
  });

  test('an unknown or malformed id is 404', async () => {
    const missing = new mongoose.Types.ObjectId();
    for (const id of [missing, 'not-an-id']) {
      expect((await as(ownerToken).put(id, { status: 'approved' })).status).toBe(404);
      expect((await as(ownerToken).del(id)).status).toBe(404);
      expect((await as(staffToken).put(id, { status: 'adjusted' })).status).toBe(404);
    }
  });

  test('without a token it is 401', async () => {
    expect((await request(app).delete(`/api/forecast/recommendations/${new mongoose.Types.ObjectId()}`)).status).toBe(401);
  });
});

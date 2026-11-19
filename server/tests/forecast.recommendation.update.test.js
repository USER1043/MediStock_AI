/**
 * PUT /api/forecast/recommendations/:id  { status?: approved|rejected, quantity?, priority?, restockingDate? }
 *   - no status: the edits are applied and the draft becomes Adjusted
 *   - approved → Pending (edits in the same request applied), rejected → Cancelled (no edits allowed)
 *   - the transition is one conditional update on the draft statuses, so two requests racing for the same
 *     draft cannot both win and an approve is never overwritten by a late adjust (409 NOT_A_DRAFT)
 * GET /api/forecast/recommendations labels each order new | adjusted | approved | rejected
 * Runs the API routers as server.js mounts them, against a real MongoDB (mongodb-memory-server).
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.JWT_SECRET = 'recommendation-update-test-secret';

const { mountApiRouters } = await import('../routes/index.js');
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

const get = (token) => request(app).get('/api/forecast/recommendations').set('Authorization', `Bearer ${token}`);

const put = (token, id, body) =>
  request(app).put(`/api/forecast/recommendations/${id}`).set('Authorization', `Bearer ${token}`).send(body);

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

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  app = express();
  app.use(express.json());
  mountApiRouters(app);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([User, Medicine, Supplier, PurchaseOrder].map((M) => M.deleteMany({})));
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

describe('adjusting (no status)', () => {
  test('staff can change the quantity; the draft becomes Adjusted and the total follows', async () => {
    const po = await addPo();

    const res = await put(staffToken, po._id, { quantity: 40 });

    expect(res.status).toBe(200);
    expect(res.body.recommendation).toMatchObject({ order_status: 'Adjusted', requested_quantity: 40, total_amount: 80 });
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'Adjusted', requested_quantity: 40, total_amount: 80 });
    expect(after.approved_by).toBeUndefined();
    expect(after.updatedAt.getTime()).toBeGreaterThan(po.updatedAt.getTime());
  });

  test('an already adjusted draft stays Adjusted; a numeric string quantity works', async () => {
    const po = await addPo('Adjusted');
    expect((await put(staffToken, po._id, { quantity: '12' })).status).toBe(200);
    expect(await stored(po)).toMatchObject({ order_status: 'Adjusted', requested_quantity: 12, total_amount: 24 });
  });

  test('changing only priority and date is an adjustment too', async () => {
    const po = await addPo();
    expect((await put(staffToken, po._id, { priority: 'low', restockingDate: '2030-01-01' })).status).toBe(200);
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'Adjusted', requested_quantity: 77 });
    expect(after.ai_forecast_reference.priority).toBe('Low');
    expect(after.expected_delivery_date.toISOString()).toMatch(/^2030-01-01/);
    expect(after.ai_forecast_reference.demand_predicted).toBe(77);
  });

  test('staff cannot approve or reject', async () => {
    const po = await addPo();
    const before = await stored(po);
    expect((await put(staffToken, po._id, { status: 'approved', quantity: 5 })).status).toBe(403);
    expect((await put(staffToken, po._id, { status: 'rejected' })).status).toBe(403);
    expect(await stored(po)).toEqual(before);
  });
});

describe('deciding (owner)', () => {
  test('approve → Pending with approved_by; a quantity sent with it is applied', async () => {
    const plain = await addPo();
    const withQty = await addPo();
    expect((await put(ownerToken, plain._id, { status: 'approved' })).status).toBe(200);
    expect((await put(ownerToken, withQty._id, { status: 'approved', quantity: 90 })).status).toBe(200);
    expect(await stored(plain)).toMatchObject({ order_status: 'Pending', requested_quantity: 77 });
    const approved = await stored(withQty);
    expect(approved).toMatchObject({ order_status: 'Pending', requested_quantity: 90, total_amount: 180 });
    expect(approved.approved_by.toString()).toBe(owner._id.toString());
  });

  test('reject → Cancelled; a reject with edits is 400', async () => {
    const po = await addPo();
    const before = await stored(po);
    expect((await put(ownerToken, po._id, { status: 'rejected', quantity: 5 })).status).toBe(400);
    expect(await stored(po)).toEqual(before);
    expect((await put(ownerToken, po._id, { status: 'rejected' })).status).toBe(200);
    expect((await stored(po)).order_status).toBe('Cancelled');
  });
});

describe('validation', () => {
  test.each([[0], [-5], [2.5], ['abc'], ['1e3'], [true], [[5]], [{ $gt: 1 }], [Number.MAX_SAFE_INTEGER + 2]])(
    'quantity %j is 400 INVALID_INPUT and the draft is untouched',
    async (bad) => {
      const po = await addPo();
      const before = await stored(po);
      for (const [token, body] of [[staffToken, { quantity: bad }], [ownerToken, { status: 'approved', quantity: bad }]]) {
        const res = await put(token, po._id, body);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
      }
      expect(await stored(po)).toEqual(before);
    }
  );

  test.each([['adjusted'], ['pending'], ['shipped'], [''], [null]])('status %j is 400 (only approved or rejected)', async (bad) => {
    const po = await addPo();
    const before = await stored(po);
    const res = await put(staffToken, po._id, { status: bad, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_INPUT');
    expect(await stored(po)).toEqual(before);
  });

  test('an empty body, an unknown priority and a bad date are 400', async () => {
    const po = await addPo();
    const before = await stored(po);
    expect((await put(staffToken, po._id, {})).status).toBe(400);
    expect((await put(staffToken, po._id, { priority: 'urgent' })).status).toBe(400);
    expect((await put(staffToken, po._id, { restockingDate: 'not a date' })).status).toBe(400);
    expect(await stored(po)).toEqual(before);
  });
});

describe('atomic transitions', () => {
  test('approving an already approved order is 409 NOT_A_DRAFT and nothing changes', async () => {
    const po = await addPo();
    expect((await put(ownerToken, po._id, { status: 'approved', quantity: 90 })).status).toBe(200);
    const approved = await stored(po);

    const again = await put(ownerToken, po._id, { status: 'approved', quantity: 500 });

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ success: false, errorCode: 'NOT_A_DRAFT' });
    expect(await stored(po)).toEqual(approved);
  });

  test('an adjust that arrives after the approve is 409 and does not overwrite the approved quantity', async () => {
    const po = await addPo();
    await put(ownerToken, po._id, { status: 'approved', quantity: 90 });
    const approved = await stored(po);

    const late = await put(staffToken, po._id, { quantity: 3 });

    expect(late.status).toBe(409);
    expect(late.body.errorCode).toBe('NOT_A_DRAFT');
    expect(await stored(po)).toEqual(approved);
  });

  test('a reject after an approve (or the reverse) is 409', async () => {
    const a = await addPo();
    await put(ownerToken, a._id, { status: 'approved' });
    expect((await put(ownerToken, a._id, { status: 'rejected' })).status).toBe(409);
    expect((await stored(a)).order_status).toBe('Pending');

    const b = await addPo();
    await put(ownerToken, b._id, { status: 'rejected' });
    expect((await put(ownerToken, b._id, { status: 'approved' })).status).toBe(409);
    expect((await stored(b)).order_status).toBe('Cancelled');
  });

  test('simultaneous decisions on one draft: exactly one wins, the rest get 409', async () => {
    for (let round = 0; round < 5; round++) {
      const po = await addPo();
      const results = await Promise.all([
        put(ownerToken, po._id, { status: 'approved', quantity: 10 }),
        put(ownerToken, po._id, { status: 'approved', quantity: 20 }),
        put(ownerToken, po._id, { status: 'rejected' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);

      const winner = results.find((r) => r.status === 200).body.recommendation;
      const after = await stored(po);
      expect(after.order_status).toBe(winner.order_status);
      expect(after.requested_quantity).toBe(winner.requested_quantity);
    }
  });

  test('a missing or malformed id is 404, an unrelated PO is 409', async () => {
    expect((await put(staffToken, new mongoose.Types.ObjectId(), { quantity: 5 })).status).toBe(404);
    expect((await put(staffToken, 'not-an-id', { quantity: 5 })).status).toBe(404);
    const ordered = await addPo('Ordered');
    expect((await put(staffToken, ordered._id, { quantity: 5 })).status).toBe(409);
    expect((await stored(ordered)).requested_quantity).toBe(77);
  });
});

describe('GET labels', () => {
  test('each stored state maps to new, adjusted, approved or rejected', async () => {
    const states = ['AI_Draft', 'Adjusted', 'Pending', 'Approved', 'Ordered', 'Shipped', 'Received', 'Cancelled'];
    const pos = {};
    for (const st of states) pos[st] = await addPo(st);

    const res = await get(staffToken);

    expect(res.status).toBe(200);
    const label = Object.fromEntries(res.body.recommendations.map((r) => [r.orderStatus, r.status]));
    expect(label).toEqual({
      AI_Draft: 'new',
      Adjusted: 'adjusted',
      Pending: 'approved',
      Approved: 'approved',
      Ordered: 'approved',
      Shipped: 'approved',
      Received: 'approved',
      Cancelled: 'rejected',
    });
  });
});

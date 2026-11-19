/**
 * PUT /api/forecast/recommendations/:id
 *   - a quantity with no status adjusts the draft (→ Adjusted); the quantity is validated (positive whole number)
 *   - the transition is one conditional update on the draft statuses, so two requests racing for the same
 *     draft cannot both win and an approve is never overwritten by a late adjust (409 NOT_A_DRAFT)
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

describe('quantity-only PUT', () => {
  test.each([['optimalReorderQty'], ['approvedQty']])('staff can adjust a draft by sending only %s', async (field) => {
    const po = await addPo();

    const res = await put(staffToken, po._id, { [field]: 40 });

    expect(res.status).toBe(200);
    expect(res.body.recommendation).toMatchObject({ order_status: 'Adjusted', requested_quantity: 40, total_amount: 80 });
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'Adjusted', requested_quantity: 40, total_amount: 80 });
    expect(after.approved_by).toBeUndefined();
    expect(after.updatedAt.getTime()).toBeGreaterThan(po.updatedAt.getTime());
  });

  test('a quantity-only PUT on an already adjusted draft keeps it Adjusted; a numeric string works', async () => {
    const po = await addPo('Adjusted');
    const res = await put(staffToken, po._id, { optimalReorderQty: '12' });
    expect(res.status).toBe(200);
    expect(await stored(po)).toMatchObject({ order_status: 'Adjusted', requested_quantity: 12, total_amount: 24 });
  });

  test('priority and date without a quantity or status still leave the status alone', async () => {
    const po = await addPo();
    const res = await put(staffToken, po._id, { priority: 'low', restockingDate: '2030-01-01' });
    expect(res.status).toBe(200);
    const after = await stored(po);
    expect(after).toMatchObject({ order_status: 'AI_Draft', requested_quantity: 77 });
    expect(after.ai_forecast_reference.priority).toBe('Low');
    expect(after.expected_delivery_date.toISOString()).toMatch(/^2030-01-01/);
    expect(after.ai_forecast_reference.demand_predicted).toBe(77);
  });

  test('an empty body changes nothing', async () => {
    const po = await addPo();
    const before = await stored(po);
    expect((await put(staffToken, po._id, {})).status).toBe(200);
    expect(await stored(po)).toEqual(before);
  });

  test('staff still cannot approve or reject, even with a quantity', async () => {
    const po = await addPo();
    const before = await stored(po);
    expect((await put(staffToken, po._id, { status: 'approved', optimalReorderQty: 5 })).status).toBe(403);
    expect((await put(staffToken, po._id, { status: 'rejected' })).status).toBe(403);
    expect(await stored(po)).toEqual(before);
  });
});

describe('validation', () => {
  test.each([[0], [-5], [2.5], ['abc'], ['1e3'], [true], [[5]], [{ $gt: 1 }], [Number.MAX_SAFE_INTEGER + 2]])(
    'quantity %j is 400 INVALID_INPUT and the draft is untouched',
    async (bad) => {
      const po = await addPo();
      const before = await stored(po);

      for (const body of [{ optimalReorderQty: bad }, { approvedQty: bad }, { status: 'adjusted', optimalReorderQty: bad }]) {
        const res = await put(staffToken, po._id, body);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
      }
      const approve = await put(ownerToken, po._id, { status: 'approved', approvedQty: bad });
      expect(approve.status).toBe(400);
      expect(await stored(po)).toEqual(before);
    }
  );

  test('an unknown status, an unknown priority and a bad date are 400', async () => {
    const po = await addPo();
    const before = await stored(po);
    expect((await put(staffToken, po._id, { status: 'shipped' })).status).toBe(400);
    expect((await put(staffToken, po._id, { priority: 'urgent' })).status).toBe(400);
    expect((await put(staffToken, po._id, { restockingDate: 'not a date' })).status).toBe(400);
    expect(await stored(po)).toEqual(before);
  });

  test('the original status/quantity forms still work', async () => {
    const adjust = await addPo();
    const approve = await addPo();
    const reject = await addPo();
    expect((await put(staffToken, adjust._id, { status: 'adjusted', optimalReorderQty: 40, priority: 'low' })).status).toBe(200);
    expect((await put(ownerToken, approve._id, { status: 'approved', approvedQty: 90 })).status).toBe(200);
    expect((await put(ownerToken, reject._id, { status: 'rejected' })).status).toBe(200);
    expect(await stored(adjust)).toMatchObject({ order_status: 'Adjusted', requested_quantity: 40, total_amount: 80 });
    const approved = await stored(approve);
    expect(approved).toMatchObject({ order_status: 'Pending', requested_quantity: 90, total_amount: 180 });
    expect(approved.approved_by.toString()).toBe(owner._id.toString());
    expect((await stored(reject)).order_status).toBe('Cancelled');
  });
});

describe('atomic transitions', () => {
  test('approving an already approved order is 409 NOT_A_DRAFT and nothing changes', async () => {
    const po = await addPo();
    expect((await put(ownerToken, po._id, { status: 'approved', approvedQty: 90 })).status).toBe(200);
    const approved = await stored(po);

    const again = await put(ownerToken, po._id, { status: 'approved', approvedQty: 500 });

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ success: false, errorCode: 'NOT_A_DRAFT' });
    expect(await stored(po)).toEqual(approved);
  });

  test('an adjust that arrives after the approve is 409 and does not overwrite the approved quantity', async () => {
    const po = await addPo();
    await put(ownerToken, po._id, { status: 'approved', approvedQty: 90 });
    const approved = await stored(po);

    const late = await put(staffToken, po._id, { optimalReorderQty: 3 });

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
        put(ownerToken, po._id, { status: 'approved', approvedQty: 10 }),
        put(ownerToken, po._id, { status: 'approved', approvedQty: 20 }),
        put(ownerToken, po._id, { status: 'rejected' }),
      ]);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 409, 409]);

      const winner = results.find((r) => r.status === 200).body.recommendation;
      const after = await stored(po);
      expect(after.order_status).toBe(winner.order_status);
      expect(after.requested_quantity).toBe(winner.requested_quantity);
    }
  });

  test('a missing or malformed id is still 404, an unrelated PO is 409', async () => {
    expect((await put(staffToken, new mongoose.Types.ObjectId(), { optimalReorderQty: 5 })).status).toBe(404);
    expect((await put(staffToken, 'not-an-id', { optimalReorderQty: 5 })).status).toBe(404);
    const ordered = await addPo('Ordered');
    expect((await put(staffToken, ordered._id, { optimalReorderQty: 5 })).status).toBe(409);
    expect((await stored(ordered)).requested_quantity).toBe(77);
  });
});

/**
 * Who may regenerate the AI draft purchase orders. `POST /api/forecast/run` and
 * `POST /api/forecast/retrain` both delete every `AI_Draft` PO and build new ones, so both are
 * owner-only. Before this was enforced, a staff Excel import fired `/retrain` and replaced the
 * owner's drafts. Runs the API routers as server.js mounts them, against a real MongoDB
 * (mongodb-memory-server), with JWTs signed like the login route signs them.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.JWT_SECRET = 'forecast-permissions-test-secret';

const { mountApiRouters } = await import('../routes/index.js');
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

const post = (path, token) => request(app).post(path).set('Authorization', `Bearer ${token}`);

// Drafts as plain objects, for comparing before and after a request
const drafts = () => PurchaseOrder.find({ order_status: 'AI_Draft' }).sort({ _id: 1 }).lean();

// An existing draft the owner has been working with
const addDraft = (overrides = {}) =>
  PurchaseOrder.create({
    order_number: 'PO-AI-OWNER-1',
    medicine_id: medicine._id,
    medicine_name: medicine.name,
    supplier_id: supplier._id,
    requested_quantity: 77,
    unit_price: 2,
    total_amount: 154,
    expected_delivery_date: new Date(Date.now() + 7 * DAY),
    order_status: 'AI_Draft',
    created_by: owner._id,
    ai_forecast_reference: { demand_predicted: 77, forecast_date: new Date(), priority: 'High' },
    ...overrides,
  });

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
  // Well stocked, so a forecast run drafts no new order for it and a successful run leaves no
  // drafts at all. (A run that does draft one currently fails with a 500: the forecast's
  // lowercase priority fails the PO schema's 'Low'/'Medium'/'High' enum. That is a separate bug.)
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

describe('POST /api/forecast/retrain', () => {
  test('staff get 403 and the AI draft purchase orders are left exactly as they were', async () => {
    await addDraft();
    await addDraft({ order_number: 'PO-AI-OWNER-2', requested_quantity: 12, total_amount: 24 });
    const before = await drafts();

    const res = await post('/api/forecast/retrain', staffToken);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorCode: 'OWNER_ONLY' });
    expect(await drafts()).toEqual(before);
    expect(await AuditLog.countDocuments({ action: 'MODEL_RETRAINED' })).toBe(0);
  });

  test('the owner can retrain: the old drafts are replaced by the new forecast and it is audited', async () => {
    await addDraft();

    const res = await post('/api/forecast/retrain', ownerToken);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, count: 0 });
    expect(await drafts()).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'MODEL_RETRAINED', username: 'owner' })).toBe(1);
  }, 30000);

  test('without a token it is 401', async () => {
    const res = await request(app).post('/api/forecast/retrain');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/forecast/run (unchanged)', () => {
  test('staff get 403 and the drafts are left as they were', async () => {
    await addDraft();
    const before = await drafts();

    const res = await post('/api/forecast/run', staffToken);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorCode: 'OWNER_ONLY' });
    expect(await drafts()).toEqual(before);
  });

  test('the owner can run it: the old drafts are replaced and it is audited', async () => {
    await addDraft();

    const res = await post('/api/forecast/run', ownerToken);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, count: 0 });
    expect(await drafts()).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'FORECAST_RUN', username: 'owner' })).toBe(1);
  }, 30000);
});

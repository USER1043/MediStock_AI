/**
 * Reorders page API: the rule-based generator is gone (drafts come only from the forecast run or a
 * manual recommendation), and GET /api/suppliers/reorder/suggestions shows each draft's live stock
 * and reorder level instead of 0/0. Real routers on mongodb-memory-server.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.JWT_SECRET = 'reorder-suggestions-test-secret';

const { mountApiRouters } = await import('../routes/index.js');
const { User } = await import('../models/userModel.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Supplier, PurchaseOrder } = await import('../models/supplierModels.js');

const DAY = 24 * 60 * 60 * 1000;
let server;
let app;
let owner;
let staff;

const tokenFor = (user) =>
  jwt.sign({ id: user._id.toString(), username: user.username, email: user.email, role: user.role }, process.env.JWT_SECRET);
const as = (user) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`),
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${tokenFor(user)}`),
});

const addMedicine = (name, quantity, reorderLevel) =>
  Medicine.create({
    name,
    category: 'Analgesic',
    purchasePrice: 2,
    sellingPrice: 5,
    reorderLevel,
    quantity,
    batches: quantity > 0
      ? [{ batchNumber: `${name}-B1`, expiryDate: new Date(Date.now() + 200 * DAY), quantity, rackNumber: 'R1' }]
      : [],
  });

let seq = 0;
const addDraft = (medicine, supplier, status = 'AI_Draft') =>
  PurchaseOrder.create({
    order_number: `PO-TEST-${++seq}`,
    medicine_id: medicine._id,
    medicine_name: medicine.name,
    supplier_id: supplier._id,
    requested_quantity: 12,
    unit_price: 2,
    total_amount: 24,
    expected_delivery_date: new Date(Date.now() + 7 * DAY),
    order_status: status,
    created_by: owner._id,
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

let supplier;
beforeEach(async () => {
  await Promise.all([User, Medicine, Supplier, PurchaseOrder].map((M) => M.deleteMany({})));
  owner = await User.create({ username: 'owner', email: 'owner@test.local', password: 'Owner#2024', role: 'owner' });
  staff = await User.create({ username: 'staff', email: 'staff@test.local', password: 'Staff#2024', role: 'staff' });
  supplier = await Supplier.create({
    supplier_name: 'Acme Pharma',
    contact_info: { phone: '9000000000', email: 'acme@test.local', address: '1 Main St' },
    medicine_categories: ['Analgesic'],
  });
});

describe('POST /api/suppliers/reorder/generate (removed)', () => {
  test.each([['owner'], ['staff']])('is 404 for %s and creates no drafts', async (role) => {
    await addMedicine('Out of stock', 0, 40);
    const res = await as(role === 'owner' ? owner : staff).post('/api/suppliers/reorder/generate');
    expect(res.status).toBe(404);
    expect(await PurchaseOrder.countDocuments()).toBe(0);
  });
});

describe('GET /api/suppliers/reorder/suggestions', () => {
  test('shows each draft with its medicine\'s current stock and reorder level', async () => {
    const low = await addMedicine('Low', 7, 40);
    const out = await addMedicine('Out', 0, 15);
    await addDraft(low, supplier);
    await addDraft(out, supplier);

    const res = await as(staff).get('/api/suppliers/reorder/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const byName = Object.fromEntries(res.body.suggestions.map((s) => [s.medicine_name, s]));
    expect(byName.Low).toMatchObject({ current_stock: 7, reorder_level: 40, suggested_quantity: 12 });
    expect(byName.Out).toMatchObject({ current_stock: 0, reorder_level: 15 });
    expect(byName.Low.medicine_id).toEqual({ _id: low._id.toString(), name: 'Low' });
    expect(byName.Low.suggested_suppliers[0].supplier_id.supplier_name).toBe('Acme Pharma');
  });

  test('reflects stock changes made after the draft was created', async () => {
    const med = await addMedicine('Restocked', 5, 40);
    await addDraft(med, supplier);
    await Medicine.updateOne({ _id: med._id }, { quantity: 55 });

    const res = await as(owner).get('/api/suppliers/reorder/suggestions');
    expect(res.body.suggestions[0]).toMatchObject({ current_stock: 55, reorder_level: 40 });
  });

  test('a draft whose medicine was deleted shows null stock and keeps the stored name', async () => {
    const med = await addMedicine('Gone', 5, 40);
    await addDraft(med, supplier);
    await Medicine.deleteOne({ _id: med._id });

    const res = await as(owner).get('/api/suppliers/reorder/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.suggestions[0]).toMatchObject({
      medicine_name: 'Gone',
      medicine_id: { _id: null, name: 'Gone' },
      current_stock: null,
      reorder_level: null,
    });
  });

  test('lists only AI_Draft orders', async () => {
    const med = await addMedicine('Med', 5, 40);
    await addDraft(med, supplier, 'AI_Draft');
    await addDraft(med, supplier, 'Pending');
    await addDraft(med, supplier, 'Adjusted');

    const res = await as(owner).get('/api/suppliers/reorder/suggestions');
    expect(res.body.count).toBe(1);
  });
});

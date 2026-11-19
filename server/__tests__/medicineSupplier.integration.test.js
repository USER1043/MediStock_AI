/**
 * Medicine.supplier must hold the _id of an existing Supplier.
 * Runs createMedicine / updateMedicine against a real in-memory MongoDB to check the supplier rule
 * together with the batch handling and __v versioning of those handlers.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: jest.fn(),
}));

const { createMedicine, updateMedicine } = await import('../controllers/inventoryController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { InventoryHistory } = await import('../models/inventoryHistoryModel.js');
const { Supplier } = await import('../models/supplierModels.js');

const staffId = new mongoose.Types.ObjectId();

// Minimal Express req/res doubles
const mockReq = (body = {}, params = {}) => ({ body, params, user: { id: staffId } });
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

const UNKNOWN_ID = new mongoose.Types.ObjectId().toString();

const newSupplier = (name) =>
  Supplier.create({
    supplier_name: name,
    contact_info: { phone: '9999999999', email: `${name.replace(/\W/g, '').toLowerCase()}@test.local`, address: 'Somewhere' },
  });

// Same shape MedicineInventory.jsx sends on insert: batch details nested under batches[0]
const createBody = (extra = {}) => ({
  name: 'Testamol',
  category: 'Analgesic',
  purchasePrice: 2,
  sellingPrice: 5,
  quantity: 10,
  batches: [{ batchNumber: 'T-1', expiryDate: '2027-06-01', quantity: 10, rackNumber: 'A1' }],
  ...extra,
});

const callCreate = async (body) => {
  const res = mockRes();
  await createMedicine(mockReq(body), res);
  return res;
};

const callUpdate = async (med, body) => {
  const res = mockRes();
  await updateMedicine(mockReq(body, { id: med._id.toString() }), res);
  return res;
};

// A plain snapshot of what's stored, for "nothing changed" checks
const snapshot = async (id) => {
  const doc = await Medicine.findById(id).lean();
  return JSON.parse(JSON.stringify(doc));
};

describe('Medicine supplier (real database)', () => {
  let server;
  let supplierA;
  let supplierB;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all([Medicine.init(), InventoryHistory.init(), Supplier.init()]);
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await Promise.all([Medicine.deleteMany({}), InventoryHistory.deleteMany({}), Supplier.deleteMany({})]);
    supplierA = (await newSupplier('PharmaHub Distributors'))._id.toString();
    supplierB = (await newSupplier('MedSupply India'))._id.toString();
  });

  // One medicine with two batches, stored with supplier A
  const seedMedicine = (overrides = {}) =>
    Medicine.create({
      name: 'Cetirizine 10mg',
      category: 'Antihistamine',
      quantity: 30,
      reorderLevel: 10,
      purchasePrice: 1,
      sellingPrice: 3,
      stockStatus: 'high',
      supplier: supplierA,
      batches: [
        { batchNumber: 'C-1', expiryDate: '2027-01-31', quantity: 20, rackNumber: 'R1' },
        { batchNumber: 'C-2', expiryDate: '2027-09-30', quantity: 10, rackNumber: 'R2' },
      ],
      ...overrides,
    });
  const batchOf = (med, number) => med.batches.find((b) => b.batchNumber === number);

  describe('createMedicine', () => {
    test('stores an existing supplier id', async () => {
      const res = await callCreate(createBody({ supplier: supplierA }));

      expect(res.statusCode).toBe(201);
      const med = await Medicine.findOne({ name: 'Testamol' });
      expect(med.supplier).toBe(supplierA);
      expect(med.quantity).toBe(10);
      expect(med.batches).toHaveLength(1);
    });

    test.each([
      ['a supplier name', () => 'PharmaHub Distributors'],
      ['an id no supplier has', () => UNKNOWN_ID],
    ])('rejects %s with 400 and writes nothing', async (_label, supplier) => {
      const res = await callCreate(createBody({ supplier: supplier() }));

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('supplier must be the id of an existing supplier');
      expect(await Medicine.countDocuments()).toBe(0);
    });

    test('rejects an invalid supplier when topping up an existing medicine, leaving it as it was', async () => {
      const med = await seedMedicine();
      const before = await snapshot(med._id);

      const res = await callCreate(createBody({
        name: 'Cetirizine 10mg',
        supplier: 'MedSupply India',
        batches: [{ batchNumber: 'C-3', expiryDate: '2028-01-01', quantity: 5, rackNumber: 'R3' }],
      }));

      expect(res.statusCode).toBe(400);
      expect(await snapshot(med._id)).toEqual(before);
    });

    test.each([
      ['omitted', {}],
      ['empty', { supplier: '' }],
      ['null', { supplier: null }],
    ])('with the supplier %s, stores none (no "Default Supplier" placeholder)', async (_label, extra) => {
      const res = await callCreate(createBody(extra));

      expect(res.statusCode).toBe(201);
      const med = await Medicine.findOne({ name: 'Testamol' }).lean();
      expect(med).not.toHaveProperty('supplier');
    });
  });

  describe('updateMedicine', () => {
    test('saves an existing supplier id', async () => {
      const med = await seedMedicine();

      const res = await callUpdate(med, { __v: med.__v, supplier: supplierB });

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.supplier).toBe(supplierB);
      expect(after.__v).toBe(med.__v + 1);
      expect(after.quantity).toBe(30);
    });

    test.each([
      ['a supplier name', () => 'MedSupply India'],
      ['an id no supplier has', () => UNKNOWN_ID],
    ])('rejects %s with 400 and changes nothing, batches and version included', async (_label, supplier) => {
      const med = await seedMedicine();
      const before = await snapshot(med._id);

      const res = await callUpdate(med, {
        __v: med.__v,
        name: 'Cetirizine Renamed',
        sellingPrice: 4,
        supplier: supplier(),
        batches: [{ _id: batchOf(med, 'C-1')._id, quantity: 25, rackNumber: 'R9' }],
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('supplier must be the id of an existing supplier');
      expect(await snapshot(med._id)).toEqual(before);
      expect(await InventoryHistory.countDocuments()).toBe(0);
    });

    test.each([
      ['empty', ''],
      ['null', null],
      ['omitted', undefined],
    ])('with the supplier %s, applies a batch quantity edit and keeps the stored supplier', async (_label, supplier) => {
      // An older record whose supplier is a name the form can't map: the form sends '' for it
      const med = await seedMedicine({ supplier: 'Default Supplier' });
      const c1 = batchOf(med, 'C-1');

      const res = await callUpdate(med, {
        __v: med.__v,
        supplier,
        batches: [{ _id: c1._id, quantity: 15 }],
      });

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.supplier).toBe('Default Supplier');
      expect(after.batches.id(c1._id).quantity).toBe(15);
      expect(batchOf(after, 'C-2').quantity).toBe(10);
      expect(after.quantity).toBe(25);
      expect(after.__v).toBe(med.__v + 1);
      const history = await InventoryHistory.find({ action: 'adjustment' });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ quantityChanged: -5, previousQuantity: 30, newQuantity: 25 });
    });

    test('changes the supplier and a batch quantity in one request', async () => {
      const med = await seedMedicine();
      const c2 = batchOf(med, 'C-2');

      const res = await callUpdate(med, {
        __v: med.__v,
        supplier: supplierB,
        batches: [{ _id: c2._id, quantity: 14 }],
      });

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.supplier).toBe(supplierB);
      expect(after.batches.id(c2._id).quantity).toBe(14);
      expect(batchOf(after, 'C-1').quantity).toBe(20);
      expect(after.quantity).toBe(34);
      expect(after.__v).toBe(med.__v + 1);
      expect(await InventoryHistory.countDocuments({ action: 'adjustment', quantityChanged: 4 })).toBe(1);
    });

    test('replaces an older stored name with a supplier id', async () => {
      const med = await seedMedicine({ supplier: 'PharmaHub Distributors' });

      const res = await callUpdate(med, { __v: med.__v, supplier: supplierA });

      expect(res.statusCode).toBe(200);
      expect((await Medicine.findById(med._id)).supplier).toBe(supplierA);
    });

    test('reports a missing medicine or a stale version before an invalid supplier', async () => {
      const med = await seedMedicine();

      const missing = mockRes();
      await updateMedicine(mockReq({ supplier: 'MedSupply India' }, { id: UNKNOWN_ID }), missing);
      expect(missing.statusCode).toBe(404);

      const stale = await callUpdate(med, { __v: med.__v + 1, supplier: 'MedSupply India' });
      expect(stale.statusCode).toBe(409);
      expect((await Medicine.findById(med._id)).supplier).toBe(supplierA);
    });
  });
});

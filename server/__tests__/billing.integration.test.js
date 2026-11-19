/**
 * Billing & Inventory Integration Tests
 * Runs createBill and adjustQuantity against a real in-memory MongoDB, once on a
 * standalone server (compensating-rollback path) and once on a single-node replica
 * set (transaction path).
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';

// Keep side effects (PDF files, email/WhatsApp, log files) out of the tests
jest.unstable_mockModule('../utils/notifications.js', () => ({
  sendBillNotification: jest.fn(async () => {}),
  sendEmailNotification: jest.fn(async () => {}),
  sendWhatsAppNotification: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../utils/pdfGenerator.js', () => ({
  generateBillPDF: jest.fn(async () => '/tmp/test-bill.pdf'),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: jest.fn(),
}));

const { createBill } = await import('../controllers/billingController.js');
const { adjustQuantity, createMedicine: createMedicineHandler, updateMedicine } = await import(
  '../controllers/inventoryController.js'
);
const { Medicine } = await import('../models/medicineModel.js');
const { Bill } = await import('../models/billModel.js');
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

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

// Batches are stored latest-expiry first so FEFO has to reorder them
const createMedicine = (overrides = {}) =>
  Medicine.create({
    name: 'Paracetamol 500mg',
    category: 'Analgesic',
    quantity: 15,
    reorderLevel: 10,
    purchasePrice: 2,
    sellingPrice: 5,
    stockStatus: 'ok',
    batches: [
      { batchNumber: 'B-LATE', expiryDate: daysFromNow(365), quantity: 10, rackNumber: 'R1' },
      { batchNumber: 'B-SOON', expiryDate: daysFromNow(30), quantity: 5, rackNumber: 'R2' },
    ],
    ...overrides,
  });

const batchQty = (medicine, batchNumber) =>
  medicine.batches.find((b) => b.batchNumber === batchNumber).quantity;

const topologies = [
  ['standalone (compensating rollback)', () => MongoMemoryServer.create()],
  [
    'replica set (transaction)',
    () => MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } }),
  ],
];

describe.each(topologies)('Billing integration on %s', (label, startServer) => {
  let server;
  const isReplSet = label.startsWith('replica');

  beforeAll(async () => {
    server = await startServer();
    await mongoose.connect(server.getUri());
    // Create collections and indexes up front so transactions don't need to
    await Promise.all([Medicine.init(), Bill.init(), InventoryHistory.init()]);
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await Promise.all([Medicine.deleteMany({}), Bill.deleteMany({}), InventoryHistory.deleteMany({})]);
  });

  test('uses the expected topology', () => {
    const type = mongoose.connection.client.topology.description.type;
    expect(type).toBe(isReplSet ? 'ReplicaSetWithPrimary' : 'Single');
  });

  describe('createBill', () => {
    test('deducts stock FEFO across batches and records the batches consumed', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await createBill(
        mockReq({ customerName: 'Walk-in', items: [{ medicineId: med._id, quantity: 7 }] }),
        res
      );

      expect(res.statusCode).toBe(201);
      expect(res.body.bill.items[0].batchNumber).toBe('B-SOON, B-LATE');
      expect(res.body.bill.subtotal).toBe(35);
      expect(res.body.bill.grandTotal).toBeCloseTo(39.2);

      const updated = await Medicine.findById(med._id);
      expect(updated.quantity).toBe(8);
      expect(batchQty(updated, 'B-SOON')).toBe(0);
      expect(batchQty(updated, 'B-LATE')).toBe(8);
      expect(updated.stockStatus).toBe('low'); // 8 against reorder level 10
      expect(updated.__v).toBe(med.__v + 1);

      const history = await InventoryHistory.find({ action: 'sale' });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ quantityChanged: -7, previousQuantity: 15, newQuantity: 8 });
      expect(await Bill.countDocuments()).toBe(1);
    });

    test('takes only from the soonest batch when it covers the sale', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await createBill(
        mockReq({ customerName: 'Walk-in', items: [{ medicineId: med._id, quantity: 3 }] }),
        res
      );

      expect(res.statusCode).toBe(201);
      expect(res.body.bill.items[0].batchNumber).toBe('B-SOON');
      const updated = await Medicine.findById(med._id);
      expect(batchQty(updated, 'B-SOON')).toBe(2);
      expect(batchQty(updated, 'B-LATE')).toBe(10);
    });

    test('rolls back earlier items when a later item has insufficient stock', async () => {
      const medA = await createMedicine();
      const medB = await createMedicine({ name: 'Ibuprofen 400mg', quantity: 2, batches: [
        { batchNumber: 'I-1', expiryDate: daysFromNow(60), quantity: 2, rackNumber: 'R3' },
      ] });
      const res = mockRes();

      await createBill(
        mockReq({
          customerName: 'Walk-in',
          items: [
            { medicineId: medA._id, quantity: 7 },
            { medicineId: medB._id, quantity: 5 },
          ],
        }),
        res
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock for Ibuprofen/);

      const afterA = await Medicine.findById(medA._id);
      expect(afterA.quantity).toBe(15);
      expect(batchQty(afterA, 'B-SOON')).toBe(5);
      expect(batchQty(afterA, 'B-LATE')).toBe(10);
      expect(afterA.stockStatus).toBe('ok');

      expect(await InventoryHistory.countDocuments()).toBe(0);
      expect(await Bill.countDocuments()).toBe(0);
    });

    test('rolls back earlier items when a later medicine does not exist', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await createBill(
        mockReq({
          customerName: 'Walk-in',
          items: [
            { medicineId: med._id, quantity: 4 },
            { medicineId: new mongoose.Types.ObjectId(), quantity: 1 },
          ],
        }),
        res
      );

      expect(res.statusCode).toBe(404);
      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(15);
      expect(batchQty(after, 'B-SOON')).toBe(5);
      expect(await InventoryHistory.countDocuments()).toBe(0);
      expect(await Bill.countDocuments()).toBe(0);
    });

    test('rolls back stock and sale history when saving the bill fails', async () => {
      const med = await createMedicine();
      const res = mockRes();

      // An invalid paymentMethod fails Bill validation after all deductions succeeded
      await createBill(
        mockReq({
          customerName: 'Walk-in',
          items: [{ medicineId: med._id, quantity: 6 }],
          paymentMethod: 'bitcoin',
        }),
        res
      );

      expect(res.statusCode).toBe(500);
      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(15);
      expect(batchQty(after, 'B-SOON')).toBe(5);
      expect(batchQty(after, 'B-LATE')).toBe(10);
      expect(await InventoryHistory.countDocuments()).toBe(0);
      expect(await Bill.countDocuments()).toBe(0);
    });

    test('rejects a non-positive quantity without touching stock', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await createBill(
        mockReq({ customerName: 'Walk-in', items: [{ medicineId: med._id, quantity: 0 }] }),
        res
      );

      expect(res.statusCode).toBe(400);
      expect((await Medicine.findById(med._id)).quantity).toBe(15);
    });

    test('rejects a request with no items', async () => {
      const res = mockRes();
      await createBill(mockReq({ customerName: 'Walk-in', items: [] }), res);
      expect(res.statusCode).toBe(400);
    });

    test('never oversells when two bills race for the same stock', async () => {
      const med = await createMedicine({ quantity: 10, batches: [
        { batchNumber: 'B-ONLY', expiryDate: daysFromNow(90), quantity: 10, rackNumber: 'R1' },
      ] });
      const resA = mockRes();
      const resB = mockRes();
      const body = { customerName: 'Walk-in', items: [{ medicineId: med._id, quantity: 8 }] };

      await Promise.all([createBill(mockReq(body), resA), createBill(mockReq(body), resB)]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      // The loser gets 409 (OCC conflict) or 400 (saw the reduced stock); inside a
      // transaction MongoDB's WriteConflict currently surfaces as 500 (documented limitation)
      const loser = statuses.find((s) => s !== 201);
      expect(isReplSet ? [400, 409, 500] : [400, 409]).toContain(loser);

      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(2);
      expect(batchQty(after, 'B-ONLY')).toBe(2);
      expect(await InventoryHistory.countDocuments({ action: 'sale' })).toBe(1);
      expect(await Bill.countDocuments()).toBe(1);
    });
  });

  describe('createMedicine (adding stock)', () => {
    // Medicine.supplier must be the _id of an existing supplier
    let supplierId;
    beforeEach(async () => {
      await Supplier.deleteMany({});
      const supplier = await Supplier.create({
        supplier_name: 'Test Supplier',
        contact_info: { phone: '9999999999', email: 'supplier@test.local', address: 'Somewhere' },
      });
      supplierId = supplier._id.toString();
    });

    // Same shape MedicineInventory.jsx sends: batch details nested under batches[0]
    const formPayload = (batch) => ({
      name: 'Paracetamol 500mg',
      category: 'Analgesic',
      purchasePrice: 2,
      sellingPrice: 5,
      quantity: batch.quantity,
      supplier: supplierId,
      batches: [batch],
    });

    test('accepts the inventory form payload and creates the medicine', async () => {
      const res = mockRes();

      await createMedicineHandler(
        mockReq(formPayload({ batchNumber: 'B-1', expiryDate: '2027-03-01', quantity: 20, rackNumber: 'R1' })),
        res
      );

      expect(res.statusCode).toBe(201);
      const med = await Medicine.findOne({ name: 'Paracetamol 500mg' });
      expect(med.quantity).toBe(20);
      expect(med.batches).toHaveLength(1);
      expect(med.batches[0].expiryDate.toISOString().slice(0, 10)).toBe('2027-03-01');
    });

    test('merges into the existing batch only when number and expiry both match', async () => {
      const med = await createMedicine();
      const soonDay = med.batches.find((b) => b.batchNumber === 'B-SOON').expiryDate.toISOString().slice(0, 10);
      const res = mockRes();

      await createMedicineHandler(
        mockReq(formPayload({ batchNumber: 'B-SOON', expiryDate: soonDay, quantity: 3, rackNumber: 'R2' })),
        res
      );

      expect(res.statusCode).toBe(201);
      const after = await Medicine.findById(med._id);
      expect(after.batches).toHaveLength(2);
      expect(after.quantity).toBe(18);
      expect(batchQty(after, 'B-SOON')).toBe(8);
      // Version moves so a concurrent bill can't overwrite this top-up
      expect(after.__v).toBe(med.__v + 1);
    });

    test('creates a separate batch for a different expiry instead of overwriting it', async () => {
      const med = await createMedicine();
      const originalSoon = med.batches.find((b) => b.batchNumber === 'B-SOON').expiryDate.toISOString();
      const res = mockRes();

      await createMedicineHandler(
        mockReq(formPayload({ batchNumber: 'B-SOON', expiryDate: '2029-01-15', quantity: 4, rackNumber: 'R2' })),
        res
      );

      expect(res.statusCode).toBe(201);
      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(19);
      expect(after.batches).toHaveLength(3);
      const soonBatches = after.batches.filter((b) => b.batchNumber === 'B-SOON');
      expect(soonBatches.map((b) => b.expiryDate.toISOString()).sort()).toEqual(
        [originalSoon, new Date('2029-01-15').toISOString()].sort()
      );
      // The original lot keeps its quantity and expiry
      expect(soonBatches.find((b) => b.expiryDate.toISOString() === originalSoon).quantity).toBe(5);
    });

    test('creates a new batch for a new batch number', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await createMedicineHandler(
        mockReq(formPayload({ batchNumber: 'B-NEW', expiryDate: '2028-08-08', quantity: 7, rackNumber: 'R5' })),
        res
      );

      expect(res.statusCode).toBe(201);
      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(22);
      expect(after.batches).toHaveLength(3);
      expect(batchQty(after, 'B-NEW')).toBe(7);
    });
  });

  describe('updateMedicine (inventory form edit)', () => {
    const batchOf = (med, number) => med.batches.find((b) => b.batchNumber === number);
    const update = async (med, body) => {
      const res = mockRes();
      await updateMedicine(mockReq(body, { id: med._id.toString() }), res);
      return res;
    };

    test('edits the named batch in place and leaves other batches alone', async () => {
      const med = await createMedicine();
      const soon = batchOf(med, 'B-SOON');

      const res = await update(med, {
        __v: med.__v,
        batches: [{ _id: soon._id, batchNumber: 'B-SOON-2', expiryDate: '2027-12-31', rackNumber: 'R7' }],
      });

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.batches).toHaveLength(2);
      const edited = after.batches.id(soon._id);
      expect(edited).toMatchObject({ batchNumber: 'B-SOON-2', rackNumber: 'R7', quantity: 5 });
      expect(edited.expiryDate.toISOString().slice(0, 10)).toBe('2027-12-31');
      expect(batchOf(after, 'B-LATE')).toMatchObject({ quantity: 10, rackNumber: 'R1' });
      expect(after.quantity).toBe(15);
      // No stock moved, so nothing is logged
      expect(await InventoryHistory.countDocuments()).toBe(0);
    });

    test('a batch quantity change moves the total by the same amount and is logged', async () => {
      const med = await createMedicine();
      const late = batchOf(med, 'B-LATE');

      const res = await update(med, { __v: med.__v, batches: [{ _id: late._id, quantity: 4 }] });

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.batches.id(late._id).quantity).toBe(4);
      expect(after.quantity).toBe(9);
      expect(after.stockStatus).toBe('low'); // 9 against reorder level 10

      const history = await InventoryHistory.find({ action: 'adjustment' });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ quantityChanged: -6, previousQuantity: 15, newQuantity: 9 });
    });

    test('updates medicine-level fields without touching stock', async () => {
      const med = await createMedicine();

      const res = await update(med, { __v: med.__v, sellingPrice: 6.5, category: 'Pain Relief', reorderLevel: 40 });

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after).toMatchObject({ sellingPrice: 6.5, category: 'Pain Relief', reorderLevel: 40, quantity: 15 });
      // stockStatus follows the new reorder level: 15 <= 40 / 2
      expect(after.stockStatus).toBe('critical');
    });

    test('rejects a stale version with 409 and changes nothing', async () => {
      const med = await createMedicine();
      // Someone sells in between: the version moves on
      await createBill(mockReq({ customerName: 'Walk-in', items: [{ medicineId: med._id, quantity: 2 }] }), mockRes());

      const res = await update(med, {
        __v: med.__v,
        sellingPrice: 9,
        batches: [{ _id: batchOf(med, 'B-LATE')._id, quantity: 20 }],
      });

      expect(res.statusCode).toBe(409);
      const after = await Medicine.findById(med._id);
      expect(after.sellingPrice).toBe(5);
      expect(after.quantity).toBe(13);
      expect(batchOf(after, 'B-LATE').quantity).toBe(10);
    });

    test('rejects setting the medicine total directly', async () => {
      const med = await createMedicine();
      const res = await update(med, { __v: med.__v, quantity: 99 });
      expect(res.statusCode).toBe(400);
      expect((await Medicine.findById(med._id)).quantity).toBe(15);
    });

    test('rejects a batch _id that does not belong to the medicine', async () => {
      const med = await createMedicine();
      const res = await update(med, { batches: [{ _id: new mongoose.Types.ObjectId(), quantity: 1 }] });
      expect(res.statusCode).toBe(400);
    });

    test('rejects a negative batch quantity and an invalid expiry', async () => {
      const med = await createMedicine();
      const soonId = batchOf(med, 'B-SOON')._id;

      expect((await update(med, { batches: [{ _id: soonId, quantity: -1 }] })).statusCode).toBe(400);
      expect((await update(med, { batches: [{ _id: soonId, expiryDate: 'not-a-date' }] })).statusCode).toBe(400);
      expect(batchOf(await Medicine.findById(med._id), 'B-SOON').quantity).toBe(5);
    });

    test('rejects an edit that would make two batches share a number and expiry', async () => {
      const med = await createMedicine();
      const late = batchOf(med, 'B-LATE');
      const soon = batchOf(med, 'B-SOON');

      const res = await update(med, {
        batches: [{ _id: soon._id, batchNumber: 'B-LATE', expiryDate: late.expiryDate }],
      });

      expect(res.statusCode).toBe(400);
      expect(batchOf(await Medicine.findById(med._id), 'B-SOON')).toBeDefined();
    });

    test('rejects renaming to the name of another medicine', async () => {
      const med = await createMedicine();
      await createMedicine({ name: 'Ibuprofen 400mg' });

      const res = await update(med, { name: 'Ibuprofen 400mg' });

      expect(res.statusCode).toBe(409);
      expect((await Medicine.findById(med._id)).name).toBe('Paracetamol 500mg');
    });
  });

  describe('adjustQuantity', () => {
    test('deducts a negative adjustment FEFO and returns the updated medicine', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await adjustQuantity(
        mockReq({ quantityChanged: -6, reason: 'Damaged' }, { id: med._id.toString() }),
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.medicine.quantity).toBe(9);
      const after = await Medicine.findById(med._id);
      expect(batchQty(after, 'B-SOON')).toBe(0);
      expect(batchQty(after, 'B-LATE')).toBe(9);
      expect(after.__v).toBe(med.__v + 1);

      const history = await InventoryHistory.find({ action: 'adjustment' });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ quantityChanged: -6, previousQuantity: 15, newQuantity: 9 });
    });

    test('adds a positive adjustment to the batch with the same number and expiry', async () => {
      const med = await createMedicine();
      const res = mockRes();
      const soonExpiry = med.batches.find((b) => b.batchNumber === 'B-SOON').expiryDate;

      await adjustQuantity(
        mockReq(
          { quantityChanged: 4, reason: 'Recount', batchNumber: 'B-SOON', expiryDate: soonExpiry },
          { id: med._id.toString() }
        ),
        res
      );

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(19);
      expect(after.batches).toHaveLength(2);
      expect(batchQty(after, 'B-SOON')).toBe(9);
      expect(batchQty(after, 'B-LATE')).toBe(10);
    });

    test('creates a new batch when no batch has that number and expiry', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await adjustQuantity(
        mockReq(
          { quantityChanged: 6, reason: 'Found stock', batchNumber: 'B-NEW', expiryDate: '2028-06-30', rackNumber: 'R9' },
          { id: med._id.toString() }
        ),
        res
      );

      expect(res.statusCode).toBe(200);
      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(21);
      expect(after.batches).toHaveLength(3);
      const added = after.batches.find((b) => b.batchNumber === 'B-NEW');
      expect(added).toMatchObject({ quantity: 6, rackNumber: 'R9' });
      expect(added.expiryDate.toISOString().slice(0, 10)).toBe('2028-06-30');
      expect(batchQty(after, 'B-LATE')).toBe(10);
      expect(batchQty(after, 'B-SOON')).toBe(5);
    });

    test('requires a batch number and expiry when adding stock', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await adjustQuantity(
        mockReq({ quantityChanged: 4, reason: 'Recount' }, { id: med._id.toString() }),
        res
      );

      expect(res.statusCode).toBe(400);
      expect((await Medicine.findById(med._id)).quantity).toBe(15);
    });

    test('refuses to go below zero', async () => {
      const med = await createMedicine();
      const res = mockRes();

      await adjustQuantity(
        mockReq({ quantityChanged: -20, reason: 'Oops' }, { id: med._id.toString() }),
        res
      );

      expect(res.statusCode).toBe(400);
      expect((await Medicine.findById(med._id)).quantity).toBe(15);
    });

    test('returns 409 instead of losing an update when two adjustments race', async () => {
      const med = await createMedicine({ quantity: 10, batches: [
        { batchNumber: 'B-ONLY', expiryDate: daysFromNow(90), quantity: 10, rackNumber: 'R1' },
      ] });
      const resA = mockRes();
      const resB = mockRes();
      const req = () => mockReq({ quantityChanged: -8, reason: 'Race' }, { id: med._id.toString() });

      await Promise.all([adjustQuantity(req(), resA), adjustQuantity(req(), resB)]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect([400, 409]).toContain(statuses.find((s) => s !== 200));

      const after = await Medicine.findById(med._id);
      expect(after.quantity).toBe(2);
      expect(batchQty(after, 'B-ONLY')).toBe(2);
      expect(await InventoryHistory.countDocuments({ action: 'adjustment' })).toBe(1);
    });
  });
});

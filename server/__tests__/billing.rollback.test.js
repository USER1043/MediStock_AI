/**
 * Compensating rollback in createBill on a standalone MongoDB (no transactions).
 *
 * Bill A sells medicine X, then fails on medicine Y, so X's deduction is rolled back. Between X's
 * deduction and the rollback, bill B sells X too. The rollback must give back only A's units, per batch,
 * and keep B's sale: restoring A's earlier snapshot of the batches would erase B's batch deduction and
 * leave Medicine.quantity different from the sum of its batches.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/notifications.js', () => ({
  sendBillNotification: jest.fn(async () => ({ success: true })),
  sendEmailNotification: jest.fn(async () => ({ success: true })),
  sendWhatsAppNotification: jest.fn(async () => ({ success: true })),
  sendAlertNotification: jest.fn(async () => ({ success: true })),
}));
jest.unstable_mockModule('../utils/pdfGenerator.js', () => ({
  generateBillPDF: jest.fn(async () => 'mock.pdf'),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: () => {} }));

const { createBill } = await import('../controllers/billingController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Bill } = await import('../models/billModel.js');
const { InventoryHistory } = await import('../models/inventoryHistoryModel.js');
const { getStockLevel } = await import('../utils/stockLevel.js');

const DAY = 24 * 60 * 60 * 1000;
let server;

const bill = async (items) => {
  const result = {};
  const res = {
    status(code) { result.status = code; return res; },
    json(body) { result.body = body; return res; },
  };
  await createBill(
    {
      user: { id: new mongoose.Types.ObjectId().toString(), role: 'staff' },
      body: { customerName: 'Walk-in', customerType: 'walking', paymentMethod: 'cash', items },
    },
    res
  );
  return result;
};

const createMedicine = (name, batches, reorderLevel = 10) =>
  Medicine.create({
    name,
    category: 'Analgesic',
    purchasePrice: 5,
    sellingPrice: 10,
    reorderLevel,
    quantity: batches.reduce((sum, b) => sum + b.quantity, 0),
    batches: batches.map((b) => ({
      batchNumber: b.batchNumber,
      expiryDate: new Date(Date.now() + b.days * DAY),
      quantity: b.quantity,
      rackNumber: 'R1',
    })),
  });

const batchQuantities = (med) =>
  Object.fromEntries(med.batches.map((b) => [b.batchNumber, b.quantity]));

// Runs `during` once, just before createBill looks up `medicineId` (i.e. after it has deducted
// every earlier item of the same bill)
const runBeforeLookupOf = (medicineId, during) => {
  const original = Medicine.findById.bind(Medicine);
  let done = false;
  jest.spyOn(Medicine, 'findById').mockImplementation((id, ...rest) => {
    if (!done && String(id) === String(medicineId)) {
      done = true;
      return { session: async () => { await during(); return original(id).session(null); } };
    }
    return original(id, ...rest);
  });
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([Medicine.deleteMany({}), Bill.deleteMany({}), InventoryHistory.deleteMany({})]);
});

afterEach(() => jest.restoreAllMocks());

test('rollback gives back only the failed bill\'s units and keeps a concurrent sale', async () => {
  // X: 13 units, earliest batch first. Bill A takes 5 (3 from EARLY, 2 from LATE), bill B then takes 2 from LATE.
  const x = await createMedicine('X', [
    { batchNumber: 'EARLY', days: 30, quantity: 3 },
    { batchNumber: 'LATE', days: 300, quantity: 10 },
  ]);
  const y = await createMedicine('Y', [{ batchNumber: 'Y1', days: 100, quantity: 1 }]);

  let billB;
  runBeforeLookupOf(y._id, async () => {
    billB = await bill([{ medicineId: x._id.toString(), quantity: 2 }]);
  });

  const billA = await bill([
    { medicineId: x._id.toString(), quantity: 5 },
    { medicineId: y._id.toString(), quantity: 5 }, // only 1 in stock: fails, rolls back X
  ]);

  expect(billB.status).toBe(201);
  expect(billA.status).toBe(400);

  const after = await Medicine.findById(x._id).lean();
  expect(after.quantity).toBe(11); // 13 - B's 2
  expect(batchQuantities(after)).toEqual({ EARLY: 3, LATE: 8 });
  expect(after.batches.reduce((sum, b) => sum + b.quantity, 0)).toBe(after.quantity);
  expect(after.stockStatus).toBe(getStockLevel(11, 10));

  // Y untouched; only bill B and its sale row remain
  expect((await Medicine.findById(y._id).lean()).quantity).toBe(1);
  expect(await Bill.countDocuments()).toBe(1);
  expect(await InventoryHistory.countDocuments()).toBe(1);
});

test('rollback with no concurrent sale restores the batches and the stock status', async () => {
  // reorderLevel 10: 12 units is ok; after A's deduction of 8 (4 left) it would be critical
  const x = await createMedicine('X', [
    { batchNumber: 'EARLY', days: 30, quantity: 5 },
    { batchNumber: 'LATE', days: 300, quantity: 7 },
  ]);
  const y = await createMedicine('Y', [{ batchNumber: 'Y1', days: 100, quantity: 1 }]);

  const billA = await bill([
    { medicineId: x._id.toString(), quantity: 8 },
    { medicineId: y._id.toString(), quantity: 5 },
  ]);

  expect(billA.status).toBe(400);
  const after = await Medicine.findById(x._id).lean();
  expect(after.quantity).toBe(12);
  expect(batchQuantities(after)).toEqual({ EARLY: 5, LATE: 7 });
  expect(after.stockStatus).toBe(getStockLevel(12, 10));
  expect(await Bill.countDocuments()).toBe(0);
  expect(await InventoryHistory.countDocuments()).toBe(0);
});

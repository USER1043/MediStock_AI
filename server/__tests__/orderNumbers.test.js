/**
 * Bill and purchase-order numbers stay unique even when many are made in the same millisecond.
 * Date.now() is frozen so only the random part can keep them apart.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const helpers = await import('../utils/helpers.js');
const { createRecommendation } = await import('../controllers/forecastController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Supplier, PurchaseOrder } = await import('../models/supplierModels.js');

const FROZEN = 1763700000000;
let server;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

afterEach(() => jest.restoreAllMocks());

describe.each([
  ['generateBillNumber', /^BILL-1763700000000-[0-9A-F]{8}$/],
  ['generateDraftOrderNumber', /^PO-AI-1763700000000-[0-9A-F]{8}$/],
])('%s', (name, format) => {
  test('5000 numbers in the same millisecond are all unique and well formed', () => {
    jest.spyOn(Date, 'now').mockReturnValue(FROZEN);
    const numbers = Array.from({ length: 5000 }, () => helpers[name]());
    expect(new Set(numbers).size).toBe(5000);
    for (const n of numbers) expect(n).toMatch(format);
  });
});

describe('manual recommendation (POST /api/forecast/recommendations)', () => {
  test('200 recommendations created in the same millisecond all succeed with distinct numbers', async () => {
    const supplier = await Supplier.create({
      supplier_name: 'Acme Pharma',
      contact_info: { phone: '9000000000', email: 'acme@test.local', address: '1 Main St' },
      medicine_categories: ['Analgesic'],
    });
    const medicine = await Medicine.create({
      name: 'Paracetamol 500mg', category: 'Analgesic', purchasePrice: 2, sellingPrice: 5,
      reorderLevel: 10, quantity: 0, batches: [], supplier: supplier._id.toString(),
    });
    await PurchaseOrder.init(); // unique index on order_number must exist before the inserts

    jest.spyOn(Date, 'now').mockReturnValue(FROZEN);
    const statuses = [];
    for (let i = 0; i < 200; i++) {
      const res = { status(code) { statuses.push(code); return this; }, json() { return this; } };
      await createRecommendation(
        { body: { medicineId: medicine._id, optimalReorderQty: 5, priority: 'high' }, user: { id: new mongoose.Types.ObjectId() } },
        res
      );
    }
    jest.restoreAllMocks();

    expect(statuses.filter((s) => s !== 201)).toEqual([]);
    const numbers = (await PurchaseOrder.find().lean()).map((po) => po.order_number);
    expect(numbers).toHaveLength(200);
    expect(new Set(numbers).size).toBe(200);
  });
});

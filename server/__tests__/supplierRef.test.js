/**
 * Medicine.supplier must hold an existing Supplier _id.
 * Covers the resolveSupplierId helper and how createMedicine / updateMedicine use it (models mocked, no DB).
 */
import { jest } from '@jest/globals';

const SUPPLIER_ID = '6afeed1a276cb3df4532baf5';
const UNKNOWN_ID = '6afeed1a276cb3df4532b000';

// Supplier.exists() finds only SUPPLIER_ID
const supplierExists = jest.fn(async ({ _id }) => (_id === SUPPLIER_ID ? { _id } : null));
jest.unstable_mockModule('../models/supplierModels.js', () => ({
  Supplier: { exists: supplierExists },
  PurchaseOrder: {},
}));

const medicineCreate = jest.fn(async (doc) => ({ _id: 'm1', ...doc }));
const medicineFindOne = jest.fn(async () => null);
const medicineFindByIdAndUpdate = jest.fn(async (id, updates) => ({ _id: id, ...updates }));
jest.unstable_mockModule('../models/medicineModel.js', () => ({
  Medicine: { create: medicineCreate, findOne: medicineFindOne, findByIdAndUpdate: medicineFindByIdAndUpdate },
}));
jest.unstable_mockModule('../models/inventoryHistoryModel.js', () => ({ InventoryHistory: {} }));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: () => {} }));

const { resolveSupplierId, isBlankSupplier } = await import('../utils/supplierRef.js');
const { createMedicine, updateMedicine } = await import('../controllers/inventoryController.js');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const newMedicineBody = (extra = {}) => ({
  name: 'Testamol', category: 'Analgesic', batchNumber: 'T-1', expiryDate: '2027-06-01',
  quantity: 10, purchasePrice: 2, sellingPrice: 5, rackNumber: 'A1', ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('resolveSupplierId', () => {
  test('returns the id of an existing supplier', async () => {
    await expect(resolveSupplierId(SUPPLIER_ID)).resolves.toBe(SUPPLIER_ID);
  });

  test('returns null for an id no supplier has', async () => {
    await expect(resolveSupplierId(UNKNOWN_ID)).resolves.toBeNull();
  });

  test('returns null for a supplier name without querying the database', async () => {
    await expect(resolveSupplierId('MedSupply India')).resolves.toBeNull();
    expect(supplierExists).not.toHaveBeenCalled();
  });

  test('returns null for non-string values', async () => {
    await expect(resolveSupplierId(123)).resolves.toBeNull();
    await expect(resolveSupplierId({ $ne: null })).resolves.toBeNull();
  });
});

describe('isBlankSupplier', () => {
  test.each([[undefined, true], [null, true], ['', true], [SUPPLIER_ID, false], ['MedSupply India', false]])(
    '%p -> %p',
    (value, expected) => expect(isBlankSupplier(value)).toBe(expected),
  );
});

describe('createMedicine supplier', () => {
  test('stores an existing supplier id', async () => {
    const res = mockRes();
    await createMedicine({ body: newMedicineBody({ supplier: SUPPLIER_ID }) }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(medicineCreate.mock.calls[0][0].supplier).toBe(SUPPLIER_ID);
  });

  test('rejects a supplier name with 400 and creates nothing', async () => {
    const res = mockRes();
    await createMedicine({ body: newMedicineBody({ supplier: 'MedSupply India' }) }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(medicineCreate).not.toHaveBeenCalled();
  });

  test('rejects an unknown supplier id with 400', async () => {
    const res = mockRes();
    await createMedicine({ body: newMedicineBody({ supplier: UNKNOWN_ID }) }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(medicineCreate).not.toHaveBeenCalled();
  });

  test('without a supplier, stores none (no "Default Supplier" placeholder)', async () => {
    const res = mockRes();
    await createMedicine({ body: newMedicineBody() }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(medicineCreate.mock.calls[0][0]).not.toHaveProperty('supplier');
  });
});

describe('updateMedicine supplier', () => {
  test('saves an existing supplier id', async () => {
    const res = mockRes();
    await updateMedicine({ params: { id: 'm1' }, body: { supplier: SUPPLIER_ID } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(medicineFindByIdAndUpdate.mock.calls[0][1].supplier).toBe(SUPPLIER_ID);
  });

  test('rejects a supplier name with 400 and changes nothing', async () => {
    const res = mockRes();
    await updateMedicine({ params: { id: 'm1' }, body: { supplier: 'MedSupply India', name: 'X' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(medicineFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('an empty supplier leaves the stored one unchanged', async () => {
    const res = mockRes();
    await updateMedicine({ params: { id: 'm1' }, body: { supplier: '', name: 'Renamed' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const updates = medicineFindByIdAndUpdate.mock.calls[0][1];
    expect(updates).not.toHaveProperty('supplier');
    expect(updates.name).toBe('Renamed');
  });
});

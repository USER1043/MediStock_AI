/**
 * Unit tests for the supplier-reference helpers (no database: Supplier is replaced by a stub).
 * How createMedicine / updateMedicine apply them is covered against a real database in
 * medicineSupplier.integration.test.js.
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

const { resolveSupplierId, isBlankSupplier } = await import('../utils/supplierRef.js');

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

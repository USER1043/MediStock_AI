import { Supplier } from '../models/supplierModels.js';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Medicine.supplier stores a Supplier _id (as a string). Returns that id when `value` is the id of an
// existing supplier, otherwise null. `SupplierModel` can be swapped out in tests.
export const resolveSupplierId = async (value, SupplierModel = Supplier) => {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) return null;
  return (await SupplierModel.exists({ _id: value })) ? value : null;
};

// A supplier field left empty means "no change" on update and "no supplier" on create
export const isBlankSupplier = (value) => value === undefined || value === null || value === '';

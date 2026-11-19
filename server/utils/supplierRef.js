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

const isObjectIdString = (value) => typeof value === 'string' && OBJECT_ID.test(value);

// Excel cells can arrive as numbers; anything else non-string (dates, booleans) is not a usable reference
const cellText = (value) => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '');

// Loads the supplier directory once so a whole import can be matched in memory (no query per row).
// `resolve(cell)` maps the sheet's `supplier` cell to
//   { blank: true }            nothing to set (empty cell)
//   { id }                     a valid _id, or a supplier_name (trimmed, case-insensitive, exact)
//   { notFound: true, text }   no such supplier
//   { ambiguous: true, text }  the name only matches several suppliers that differ by case
export const buildSupplierLookup = async (SupplierModel = Supplier) => {
  const suppliers = await SupplierModel.find({}, '_id supplier_name').lean();
  const byId = new Set();
  const byExactName = new Map();
  const byLowerName = new Map();
  for (const s of suppliers) {
    const id = String(s._id);
    const name = String(s.supplier_name ?? '').trim();
    byId.add(id.toLowerCase());
    byExactName.set(name, id);
    const key = name.toLowerCase();
    byLowerName.set(key, [...(byLowerName.get(key) || []), id]);
  }

  const resolve = (cell) => {
    const text = cellText(cell);
    if (text === '') return { blank: true };
    if (isObjectIdString(text) && byId.has(text.toLowerCase())) return { id: text.toLowerCase() };
    if (byExactName.has(text)) return { id: byExactName.get(text) };
    const matches = byLowerName.get(text.toLowerCase()) || [];
    if (matches.length === 1) return { id: matches[0] };
    if (matches.length > 1) return { ambiguous: true, text };
    return { notFound: true, text };
  };

  return { resolve };
};

// For export: maps supplier ids to their supplier_name in a single query. Values that are not valid ids
// (legacy names) and ids with no supplier any more are returned unchanged; missing values become ''.
export const supplierDisplayNames = async (values, SupplierModel = Supplier) => {
  const ids = [...new Set(values.filter(isObjectIdString))];
  const names = new Map();
  if (ids.length > 0) {
    const found = await SupplierModel.find({ _id: { $in: ids } }, '_id supplier_name').lean();
    for (const s of found) names.set(String(s._id), s.supplier_name);
  }
  return (value) => {
    if (isBlankSupplier(value)) return '';
    return names.get(value) ?? value;
  };
};

// Medicine.supplier stores a Supplier _id. Older records may hold the supplier's name instead,
// so both helpers accept either and match it against the suppliers list.

// The supplier's _id for a stored value, or '' when it matches no known supplier
export const supplierIdOf = (value, suppliers) => {
  if (!value) return '';
  const match = suppliers.find((s) => s._id === value || s.supplier_name === value);
  return match ? match._id : '';
};

// The supplier's name for a stored value; falls back to the stored text when it matches no known supplier
export const supplierNameOf = (value, suppliers) => {
  if (!value) return '—';
  const match = suppliers.find((s) => s._id === value || s.supplier_name === value);
  return match ? match.supplier_name : value;
};

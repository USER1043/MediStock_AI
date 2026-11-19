/**
 * Excel import / export and Medicine.supplier (a Supplier _id).
 * Runs uploadExcel / exportExcel against an in-memory MongoDB. (tests/upload.test.js needs a real database
 * and the whole app, so it is left out of the normal run; this file covers the supplier handling.)
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const { uploadExcel, exportExcel } = await import('../controllers/uploadController.js');
const { Medicine } = await import('../models/medicineModel.js');
const { AuditLog } = await import('../models/auditLogModel.js');
const { Supplier } = await import('../models/supplierModels.js');

let mongod;
let tmpDir;
const userId = new mongoose.Types.ObjectId();

const newSupplier = (name) =>
  Supplier.create({
    supplier_name: name,
    contact_info: { phone: '9999999999', email: `s${new mongoose.Types.ObjectId()}@test.local`, address: 'Somewhere' },
  });

const baseRow = (name, extra = {}) => ({
  name,
  category: 'Analgesic',
  batchNumber: 'B1',
  expiryDate: '2030-01-01',
  quantity: 10,
  purchasePrice: 2,
  sellingPrice: 5,
  rackNumber: 'A1',
  reorderLevel: 20,
  ...extra,
});

const mockRes = () => {
  const res = { statusCode: 200, body: null, sent: null, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (p) => ((res.body = p), res);
  res.setHeader = (k, v) => ((res.headers[k] = v), res);
  res.send = (b) => ((res.sent = b), res);
  return res;
};

// Writes the rows to a real .xlsx file (the controller reads and deletes it) and runs the import
const writeSheet = (rows) => {
  const file = path.join(tmpDir, `import_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Data');
  XLSX.writeFile(wb, file);
  return file;
};
const runImport = async (rows) => {
  const file = writeSheet(rows);
  const res = mockRes();
  await uploadExcel(
    { file: { path: file, originalname: 'in.xlsx', size: 1 }, user: { id: userId, username: 'u' }, headers: {}, socket: {} },
    res
  );
  expect(res.statusCode).toBe(200);
  return res.body.uploadLog;
};

const runExport = async () => {
  const res = mockRes();
  await exportExcel({}, res);
  expect(res.statusCode).toBe(200);
  const wb = XLSX.read(res.sent, { type: 'buffer' });
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]), buffer: res.sent };
};

describe('Excel import: supplier column', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([Medicine.init(), Supplier.init(), AuditLog.init()]);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-supplier-'));
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await Promise.all([Medicine.deleteMany({}), Supplier.deleteMany({}), AuditLog.deleteMany({})]);
  });

  test('matches the supplier name ignoring case and surrounding spaces, and stores the _id', async () => {
    const s = await newSupplier('MedCorp India');
    const log = await runImport([baseRow('Alpha', { supplier: '  medCORP india ' })]);

    expect(log.recordsSuccessful).toBe(1);
    expect(log.recordsFailed).toBe(0);
    expect((await Medicine.findOne({ name: 'Alpha' })).supplier).toBe(String(s._id));
  });

  test('accepts a valid supplier _id', async () => {
    const s = await newSupplier('MedCorp');
    const log = await runImport([baseRow('Alpha', { supplier: String(s._id) })]);

    expect(log.recordsFailed).toBe(0);
    expect((await Medicine.findOne({ name: 'Alpha' })).supplier).toBe(String(s._id));
  });

  test('an unknown supplier fails only that row, with a clear message; other rows import', async () => {
    const s = await newSupplier('MedCorp');
    const log = await runImport([
      baseRow('Good1', { supplier: 'MedCorp' }),
      baseRow('Bad', { supplier: 'Nobody Ltd' }),
      baseRow('Good2', { supplier: 'medcorp' }),
    ]);

    expect(log.recordsProcessed).toBe(3);
    expect(log.recordsSuccessful).toBe(2);
    expect(log.recordsFailed).toBe(1);
    expect(log.errors).toEqual([
      { row: 3, message: "Row 3: supplier 'Nobody Ltd' not found — add it on the Suppliers page first" },
    ]);
    expect(await Medicine.findOne({ name: 'Bad' })).toBeNull();
    expect((await Medicine.findOne({ name: 'Good2' })).supplier).toBe(String(s._id));

    // The audit entry keeps the row errors too
    const audit = await AuditLog.findOne({ action: 'EXCEL_UPLOAD' });
    expect(audit.details.errors).toHaveLength(1);
  });

  test('a well-formed id that no supplier has is reported as not found', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const log = await runImport([baseRow('Alpha', { supplier: ghost })]);

    expect(log.recordsFailed).toBe(1);
    expect(log.errors[0].message).toContain(`supplier '${ghost}' not found`);
    expect(await Medicine.countDocuments()).toBe(0);
  });

  test('an unknown supplier on an existing medicine leaves its stock and supplier untouched', async () => {
    const s = await newSupplier('MedCorp');
    await runImport([baseRow('Alpha', { supplier: 'MedCorp', quantity: 10 })]);
    const log = await runImport([baseRow('Alpha', { supplier: 'Nobody', quantity: 5 })]);

    expect(log.recordsFailed).toBe(1);
    const m = await Medicine.findOne({ name: 'Alpha' });
    expect(m.quantity).toBe(10);
    expect(m.supplier).toBe(String(s._id));
  });

  test('a blank supplier on a new medicine stores no supplier', async () => {
    const log = await runImport([baseRow('NoSup'), baseRow('Blank', { supplier: '   ' })]);

    expect(log.recordsFailed).toBe(0);
    for (const name of ['NoSup', 'Blank']) {
      const m = await Medicine.findOne({ name }).lean();
      expect(m.supplier).toBeUndefined();
    }
  });

  test('a blank supplier on an existing medicine keeps its supplier; a non-blank one updates it', async () => {
    const a = await newSupplier('Alpha Pharma');
    const b = await newSupplier('Beta Pharma');
    await runImport([baseRow('Med', { supplier: 'Alpha Pharma' })]);

    await runImport([baseRow('Med', { batchNumber: 'B2', supplier: '' })]);
    let m = await Medicine.findOne({ name: 'Med' });
    expect(m.supplier).toBe(String(a._id));
    expect(m.quantity).toBe(20);

    await runImport([baseRow('Med', { batchNumber: 'B3', supplier: 'beta pharma' })]);
    m = await Medicine.findOne({ name: 'Med' });
    expect(m.supplier).toBe(String(b._id));
    expect(m.quantity).toBe(30);
  });

  test('regex characters in the sheet or in supplier names are matched literally', async () => {
    const dots = await newSupplier('A.B & Co (India)+');
    await newSupplier('AxB & Co (India)+');
    const log = await runImport([
      baseRow('Lit', { supplier: 'a.b & co (india)+' }),
      baseRow('Wild', { supplier: '.*' }),
      baseRow('Anchor', { supplier: '^A.B' }),
    ]);

    expect(log.recordsSuccessful).toBe(1);
    expect(log.recordsFailed).toBe(2);
    expect((await Medicine.findOne({ name: 'Lit' })).supplier).toBe(String(dots._id));
    expect(log.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  test('a name that matches several suppliers only by case is rejected, an exact match still works', async () => {
    const lower = await newSupplier('acme');
    await newSupplier('ACME');
    const log = await runImport([baseRow('Exact', { supplier: 'acme' }), baseRow('Ambig', { supplier: 'Acme' })]);

    expect(log.recordsSuccessful).toBe(1);
    expect(log.errors[0].message).toContain("supplier 'Acme' matches more than one supplier");
    expect((await Medicine.findOne({ name: 'Exact' })).supplier).toBe(String(lower._id));
  });

  test('looks suppliers up once per import, not once per row', async () => {
    await newSupplier('MedCorp');
    const spy = jest.spyOn(Supplier, 'find');
    try {
      await runImport([1, 2, 3, 4, 5].map((i) => baseRow(`Med${i}`, { supplier: 'MedCorp' })));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  describe('row numbers match the Excel sheet', () => {
    test('errors and anomalies use the Excel row (header = row 1), even across a blank row', async () => {
      await newSupplier('MedCorp');
      const rows = [
        baseRow('First', { supplier: 'MedCorp' }),
        baseRow('Ghost', { supplier: 'Nobody Ltd' }),
        baseRow('Negative', { supplier: 'MedCorp', quantity: -5 }),
      ];
      const headers = Object.keys(rows[0]);
      // Excel: row 1 header, row 2 First, row 3 blank, row 4 Ghost, row 5 Negative
      const aoa = [headers, headers.map((h) => rows[0][h]), [], headers.map((h) => rows[1][h]), headers.map((h) => rows[2][h])];
      const file = path.join(tmpDir, `blank_${Date.now()}.xlsx`);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Data');
      XLSX.writeFile(wb, file);
      const res = mockRes();
      await uploadExcel(
        { file: { path: file, originalname: 'in.xlsx', size: 1 }, user: { id: userId, username: 'u' }, headers: {}, socket: {} },
        res
      );

      const log = res.body.uploadLog;
      expect(log.errors).toEqual([{ row: 4, message: "Row 4: supplier 'Nobody Ltd' not found — add it on the Suppliers page first" }]);
      expect(log.anomalies.filter((a) => a.field === 'quantity').map((a) => a.row)).toEqual([5]);
    });
  });
});

describe('Excel export: supplier column', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([Medicine.init(), Supplier.init(), AuditLog.init()]);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-supplier-'));
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await Promise.all([Medicine.deleteMany({}), Supplier.deleteMany({}), AuditLog.deleteMany({})]);
  });

  const makeMedicine = (name, supplier) =>
    Medicine.create({
      name,
      category: 'Analgesic',
      quantity: 10,
      purchasePrice: 2,
      sellingPrice: 5,
      ...(supplier === undefined ? {} : { supplier }),
      batches: [{ batchNumber: 'B1', expiryDate: '2030-01-01', quantity: 10, rackNumber: 'A1' }],
    });

  test('writes supplier names; legacy names stay as they are; missing is empty, not "Default"', async () => {
    const s = await newSupplier('MedCorp');
    await makeMedicine('ById', String(s._id));
    await makeMedicine('Legacy', 'Old Supplier Name');
    await makeMedicine('None');

    const { rows } = await runExport();
    const supplierOf = (name) => rows.find((r) => r.name === name).supplier;

    expect(supplierOf('ById')).toBe('MedCorp');
    expect(supplierOf('Legacy')).toBe('Old Supplier Name');
    expect(supplierOf('None') ?? '').toBe('');
    expect(rows.some((r) => r.supplier === 'Default')).toBe(false);
  });

  test('resolves all supplier ids in a single query', async () => {
    const a = await newSupplier('A One');
    const b = await newSupplier('B Two');
    await makeMedicine('M1', String(a._id));
    await makeMedicine('M2', String(b._id));
    await makeMedicine('M3', String(a._id));

    const spy = jest.spyOn(Supplier, 'find');
    try {
      await runExport();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('an export re-imports cleanly and keeps each medicine on its supplier', async () => {
    const a = await newSupplier('Alpha Pharma');
    const b = await newSupplier('Beta Pharma');
    await makeMedicine('M1', String(a._id));
    await makeMedicine('M2', String(b._id));
    await makeMedicine('M3');

    const { rows } = await runExport();
    await Medicine.deleteMany({});
    const file = writeSheet(rows.map((r) => ({ ...r, expiryDate: '2030-01-01' })));
    const res = mockRes();
    await uploadExcel({ file: { path: file, originalname: 'x.xlsx', size: 1 }, user: { id: userId }, headers: {}, socket: {} }, res);

    expect(res.body.uploadLog.recordsFailed).toBe(0);
    expect((await Medicine.findOne({ name: 'M1' })).supplier).toBe(String(a._id));
    expect((await Medicine.findOne({ name: 'M2' })).supplier).toBe(String(b._id));
    expect((await Medicine.findOne({ name: 'M3' }).lean()).supplier).toBeUndefined();
  });
});

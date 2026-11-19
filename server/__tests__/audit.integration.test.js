/**
 * Activity-log entries for real requests: the API routers as server.js mounts them, behind the
 * audit middleware, against a real MongoDB (mongodb-memory-server). Each successful write leaves
 * exactly one entry with the right action, module and full endpoint; routes logged by their own
 * controller are not logged twice; skipped and failed requests leave none.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import speakeasy from 'speakeasy';
import XLSX from 'xlsx';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('../utils/notifications.js', () => ({
  sendBillNotification: jest.fn(async () => {}),
  sendEmailNotification: jest.fn(async () => {}),
  sendWhatsAppNotification: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../utils/pdfGenerator.js', () => ({
  generateBillPDF: jest.fn(async () => '/tmp/test-bill.pdf'),
}));
// The chatbot calls Gemini through axios; fail it so the handler answers from its keyword fallback
jest.unstable_mockModule('axios', () => ({
  default: { post: jest.fn(async () => { throw new Error('offline in tests'); }) },
}));

process.env.JWT_SECRET = 'audit-integration-test-secret';

const { default: log } = await import('../utils/logger.js');
const { auditLogger, createAuditEntry } = await import('../middleware/auditLogger.js');
const { mountApiRouters } = await import('../routes/index.js');
const { AuditLog } = await import('../models/auditLogModel.js');
const { User } = await import('../models/userModel.js');
const { Medicine } = await import('../models/medicineModel.js');
const { Bill } = await import('../models/billModel.js');
const { Customer } = await import('../models/customerModel.js');
const { Supplier, PurchaseOrder } = await import('../models/supplierModels.js');
const { Alert } = await import('../models/alertModel.js');
const { alertService } = await import('../services/alertService.js');

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

// The API as server.js builds it (minus CORS, request logging and alert staleness), plus one
// write route that has no row in the audit table
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(auditLogger);
  mountApiRouters(app);
  const extra = express.Router();
  extra.post('/things/:id', (req, res) => res.status(201).json({ ok: true }));
  app.use('/api/unmapped', extra);
  return app;
};

let server;
let app;
let owner;
let ownerToken;

const tokenFor = (user) =>
  jwt.sign({ id: user._id.toString(), username: user.username, email: user.email, role: user.role }, process.env.JWT_SECRET);

const api = () => {
  const as = (method) => (path) => request(app)[method](path).set('Authorization', `Bearer ${ownerToken}`);
  return { post: as('post'), put: as('put'), patch: as('patch'), delete: as('delete') };
};

// The audit middleware writes after 'finish' without awaiting; give the write time to land
const settle = () => new Promise((r) => setTimeout(r, 150));

const entries = async () => {
  await settle();
  return AuditLog.find().sort({ timestamp: 1, _id: 1 }).lean();
};

// Runs one request and checks it left exactly one entry, as described
const expectOneEntry = async (send, { status, action, module, endpoint, method }) => {
  await AuditLog.deleteMany({});
  const res = await send();
  expect(res.status).toBe(status);
  const logged = await entries();
  expect(logged.map((e) => `${e.action} ${e.module}`)).toEqual([`${action} ${module}`]);
  expect(logged[0]).toMatchObject({ endpoint, httpMethod: method, statusCode: status, username: owner.username });
  expect(logged[0].userId.toString()).toBe(owner._id.toString());
  return { res, entry: logged[0] };
};

const expectNoEntry = async (send, status) => {
  await AuditLog.deleteMany({});
  const res = await send();
  expect(res.status).toBe(status);
  expect(await entries()).toEqual([]);
  return res;
};

const addSupplier = (name = 'Acme Pharma', categories = ['Analgesic']) =>
  Supplier.create({
    supplier_name: name,
    contact_info: { phone: '9000000000', email: `${name.replace(/\s/g, '').toLowerCase()}@test.local`, address: '1 Main St' },
    medicine_categories: categories,
  });

const addMedicine = (overrides = {}) =>
  Medicine.create({
    name: 'Paracetamol 500mg',
    category: 'Analgesic',
    purchasePrice: 2,
    sellingPrice: 5,
    reorderLevel: 10,
    quantity: 20,
    batches: [{ batchNumber: 'B1', expiryDate: daysFromNow(200), quantity: 20, rackNumber: 'R1' }],
    ...overrides,
  });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  app = buildApp();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all(
    [AuditLog, User, Medicine, Bill, Customer, Supplier, PurchaseOrder, Alert].map((M) => M.deleteMany({}))
  );
  alertService.reset();
  owner = await User.create({ username: 'owner', email: 'owner@test.local', password: 'Owner#2024', role: 'owner' });
  ownerToken = tokenFor(owner);
  log.mockClear();
});

describe('users', () => {
  test('register, edit and delete are USER_CREATED / USER_UPDATED / USER_DELETED, with passwords redacted', async () => {
    const { res, entry } = await expectOneEntry(
      () => api().post('/api/auth/register').send({
        username: 'nurse', email: 'nurse@test.local', password: 'Nurse#2024', confirmPassword: 'Nurse#2024', role: 'staff',
      }),
      { status: 201, action: 'USER_CREATED', module: 'UserManagement', endpoint: '/api/auth/register', method: 'POST' }
    );
    expect(entry.details.body).toEqual({
      username: 'nurse', email: 'nurse@test.local', password: '[REDACTED]', confirmPassword: '[REDACTED]', role: 'staff',
    });
    expect(JSON.stringify(entry)).not.toContain('Nurse#2024');
    const id = res.body.user?._id || res.body.user?.id || (await User.findOne({ username: 'nurse' }))._id.toString();

    const updated = await expectOneEntry(
      () => api().put(`/api/auth/users/${id}`).send({
        email: 'nurse2@test.local',
        password: 'Nurse#2025',
        currentPassword: 'Nurse#2024',
        newPassword: 'Nurse#2025',
        profile: { keyword: 'night shift', devices: [{ name: 'tablet', refreshToken: 'rt-secret-value' }] },
      }),
      { status: 200, action: 'USER_UPDATED', module: 'UserManagement', endpoint: `/api/auth/users/${id}`, method: 'PUT' }
    );
    expect(updated.entry.details.body).toEqual({
      email: 'nurse2@test.local',
      password: '[REDACTED]',
      currentPassword: '[REDACTED]',
      newPassword: '[REDACTED]',
      profile: { keyword: 'night shift', devices: [{ name: 'tablet', refreshToken: '[REDACTED]' }] },
    });
    expect(JSON.stringify(updated.entry)).not.toContain('rt-secret-value');
    expect(JSON.stringify(updated.entry)).not.toContain('Nurse#2024');
    expect(updated.entry.details.params).toEqual({ id });
    expect(JSON.stringify(updated.entry)).not.toContain('Nurse#2025');

    await expectOneEntry(() => api().delete(`/api/auth/users/${id}`), {
      status: 200, action: 'USER_DELETED', module: 'UserManagement', endpoint: `/api/auth/users/${id}`, method: 'DELETE',
    });
  });

  test('2FA: setup leaves no entry; verify-setup is TWO_FA_ENABLED with the token and secret redacted', async () => {
    const setup = await expectNoEntry(() => api().post('/api/auth/2fa/setup'), 200);
    const { secret } = setup.body;
    const token = speakeasy.totp({ secret, encoding: 'base32' });

    const { entry } = await expectOneEntry(() => api().post('/api/auth/2fa/verify-setup').send({ token, secret }), {
      status: 200, action: 'TWO_FA_ENABLED', module: 'UserManagement', endpoint: '/api/auth/2fa/verify-setup', method: 'POST',
    });
    expect(entry.details.body).toEqual({ token: '[REDACTED]', secret: '[REDACTED]' });
  });

  test('login leaves exactly one USER_LOGIN entry, its explicit one', async () => {
    await AuditLog.deleteMany({});
    const res = await request(app).post('/api/auth/login').send({ username: 'owner', password: 'Owner#2024' });
    expect(res.status).toBe(200);
    const logged = await entries();
    expect(logged.map((e) => e.action)).toEqual(['USER_LOGIN']);
    expect(logged[0]).toMatchObject({ module: 'System', endpoint: '/api/auth/login', username: 'owner' });
    expect(logged[0].details).toEqual({ role: 'owner' });
    expect(JSON.stringify(logged[0])).not.toContain('Owner#2024');
  });

  test('explicit entries are redacted too', async () => {
    await AuditLog.deleteMany({});
    await createAuditEntry({
      userId: owner._id, username: 'owner', action: 'OTHER', module: 'System',
      details: { role: 'owner', session: { accessToken: 'at-value', keyword: 'kept' } },
    });
    const [entry] = await AuditLog.find().lean();
    expect(entry.details).toEqual({ role: 'owner', session: { accessToken: '[REDACTED]', keyword: 'kept' } });
  });
});

describe('inventory', () => {
  test('add, edit, adjust and delete a medicine each leave one entry with their own action', async () => {
    const supplier = await addSupplier();
    const { res } = await expectOneEntry(
      () => api().post('/api/inventory').send({
        name: 'Ibuprofen 200mg', category: 'Analgesic', purchasePrice: 3, sellingPrice: 6, reorderLevel: 5,
        supplier: supplier._id.toString(),
        batches: [{ batchNumber: 'IB-1', expiryDate: daysFromNow(300), quantity: 40, rackNumber: 'R2' }],
      }),
      { status: 201, action: 'MEDICINE_CREATED', module: 'Inventory', endpoint: '/api/inventory', method: 'POST' }
    );
    const med = await Medicine.findOne({ name: 'Ibuprofen 200mg' }).lean();
    const id = med._id.toString();
    expect(res.body.success).toBe(true);

    await expectOneEntry(() => api().put(`/api/inventory/${id}`).send({ sellingPrice: 7 }), {
      status: 200, action: 'MEDICINE_UPDATED', module: 'Inventory', endpoint: `/api/inventory/${id}`, method: 'PUT',
    });

    await expectOneEntry(
      () => api().post(`/api/inventory/${id}/adjust-quantity`).send({ quantityChanged: -5, reason: 'damaged', batchNumber: 'IB-1' }),
      { status: 200, action: 'STOCK_UPDATE', module: 'Inventory', endpoint: `/api/inventory/${id}/adjust-quantity`, method: 'POST' }
    );

    await expectOneEntry(() => api().delete(`/api/inventory/${id}`), {
      status: 200, action: 'MEDICINE_DELETED', module: 'Inventory', endpoint: `/api/inventory/${id}`, method: 'DELETE',
    });
  });
});

describe('billing', () => {
  test('creating a bill is BILL_GENERATED and confirming its payment is PAYMENT_CONFIRMED', async () => {
    const med = await addMedicine();
    const { res } = await expectOneEntry(
      () => api().post('/api/billing').send({ customerName: 'Walk-in', items: [{ medicineId: med._id.toString(), quantity: 2 }], paymentMethod: 'cash' }),
      { status: 201, action: 'BILL_GENERATED', module: 'Billing', endpoint: '/api/billing', method: 'POST' }
    );
    const billId = res.body.bill._id;

    await expectOneEntry(() => api().post('/api/billing/payment/confirm').send({ billId }), {
      status: 200, action: 'PAYMENT_CONFIRMED', module: 'Billing', endpoint: '/api/billing/payment/confirm', method: 'POST',
    });
  });
});

describe('customers', () => {
  test('create, edit and delete are CUSTOMER_CREATED / _UPDATED / _DELETED in Customers; the query string is not stored', async () => {
    const { res } = await expectOneEntry(
      () => api().post('/api/customers?source=billing').send({ name: 'Asha', phone: '9123456780' }),
      { status: 201, action: 'CUSTOMER_CREATED', module: 'Customers', endpoint: '/api/customers', method: 'POST' }
    );
    const id = res.body.customer._id;

    await expectOneEntry(() => api().put(`/api/customers/${id}`).send({ city: 'Chennai' }), {
      status: 200, action: 'CUSTOMER_UPDATED', module: 'Customers', endpoint: `/api/customers/${id}`, method: 'PUT',
    });
    await expectOneEntry(() => api().delete(`/api/customers/${id}`), {
      status: 200, action: 'CUSTOMER_DELETED', module: 'Customers', endpoint: `/api/customers/${id}`, method: 'DELETE',
    });
  });
});

describe('suppliers and purchase orders', () => {
  test('both create routes are SUPPLIER_CREATED, and an edit is SUPPLIER_UPDATED', async () => {
    const supplierBody = (name) => ({
      supplier_name: name,
      contact_info: { phone: '9000000001', email: `${name.replace(/\s/g, '').toLowerCase()}@test.local`, address: '2 Side St' },
    });

    const { res } = await expectOneEntry(() => api().post('/api/suppliers/suppliers').send(supplierBody('First Co')), {
      status: 201, action: 'SUPPLIER_CREATED', module: 'Suppliers', endpoint: '/api/suppliers/suppliers', method: 'POST',
    });
    await expectOneEntry(() => api().post('/api/suppliers').send(supplierBody('Second Co')), {
      status: 201, action: 'SUPPLIER_CREATED', module: 'Suppliers', endpoint: '/api/suppliers', method: 'POST',
    });

    const id = res.body.supplier._id;
    await expectOneEntry(() => api().put(`/api/suppliers/suppliers/${id}`).send({ notes: 'net 30' }), {
      status: 200, action: 'SUPPLIER_UPDATED', module: 'Suppliers', endpoint: `/api/suppliers/suppliers/${id}`, method: 'PUT',
    });
  });

  test('generating reorders, placing a PO and updating it are REORDER_GENERATED / ORDER_CREATED / ORDER_STATUS_UPDATE', async () => {
    await addSupplier();
    await addMedicine({ quantity: 3, batches: [{ batchNumber: 'LOW', expiryDate: daysFromNow(200), quantity: 3, rackNumber: 'R1' }] });

    const { res } = await expectOneEntry(() => api().post('/api/suppliers/reorder/generate'), {
      status: 200, action: 'REORDER_GENERATED', module: 'Orders', endpoint: '/api/suppliers/reorder/generate', method: 'POST',
    });
    const draftId = res.body.suggestions[0]._id;

    await expectOneEntry(() => api().post('/api/suppliers/purchase-orders').send({ suggestion_id: draftId }), {
      status: 201, action: 'ORDER_CREATED', module: 'Orders', endpoint: '/api/suppliers/purchase-orders', method: 'POST',
    });
    await expectOneEntry(() => api().put(`/api/suppliers/purchase-orders/${draftId}`).send({ order_status: 'Ordered' }), {
      status: 200, action: 'ORDER_STATUS_UPDATE', module: 'Orders', endpoint: `/api/suppliers/purchase-orders/${draftId}`, method: 'PUT',
    });
  });
});

describe('categories', () => {
  test('creating a category is recorded as CATEGORY_CREATED (it used to fail validation and be dropped)', async () => {
    await expectOneEntry(() => api().post('/api/categories').send({ name: 'Antiviral' }), {
      status: 201, action: 'CATEGORY_CREATED', module: 'Categories', endpoint: '/api/categories', method: 'POST',
    });
    expect(log).not.toHaveBeenCalledWith('ERROR', expect.anything(), expect.anything());
  });

  test('approving one is CATEGORY_APPROVED', async () => {
    await expectOneEntry(() => api().patch('/api/categories/Antiviral/approve'), {
      status: 200, action: 'CATEGORY_APPROVED', module: 'Categories', endpoint: '/api/categories/Antiviral/approve', method: 'PATCH',
    });
  });
});

describe('forecasting', () => {
  test('recommendations: create, edit, approve and delete', async () => {
    await addSupplier();
    const med = await addMedicine();

    const { res } = await expectOneEntry(
      () => api().post('/api/forecast/recommendations').send({ medicineId: med._id.toString(), optimalReorderQty: 30, priority: 'high' }),
      { status: 201, action: 'RECOMMENDATION_CREATED', module: 'Forecasting', endpoint: '/api/forecast/recommendations', method: 'POST' }
    );
    const id = res.body.recommendation._id;
    const endpoint = `/api/forecast/recommendations/${id}`;

    await expectOneEntry(() => api().put(endpoint).send({ status: 'adjusted', optimalReorderQty: 40 }), {
      status: 200, action: 'RECOMMENDATION_UPDATED', module: 'Forecasting', endpoint, method: 'PUT',
    });
    await expectOneEntry(() => api().put(endpoint).send({ status: 'approved', approvedQty: 40 }), {
      status: 200, action: 'REORDER_APPROVED', module: 'Forecasting', endpoint, method: 'PUT',
    });
    expect((await PurchaseOrder.findById(id).lean()).order_status).toBe('Pending');

    // Only drafts can be deleted, so delete a second, still-unreviewed one (the approved PO is now Pending)
    const second = await api().post('/api/forecast/recommendations').send({ medicineId: med._id.toString(), optimalReorderQty: 5 });
    const draftEndpoint = `/api/forecast/recommendations/${second.body.recommendation._id}`;
    await expectOneEntry(() => api().delete(draftEndpoint), {
      status: 200, action: 'RECOMMENDATION_DELETED', module: 'Forecasting', endpoint: draftEndpoint, method: 'DELETE',
    });
  });

  test('saving the forecast parameters is FORECAST_SETTINGS_UPDATED', async () => {
    await expectOneEntry(() => api().post('/api/forecast/parameters').send({ leadTimeDays: 5 }), {
      status: 200, action: 'FORECAST_SETTINGS_UPDATED', module: 'Forecasting', endpoint: '/api/forecast/parameters', method: 'POST',
    });
  });

  test('a forecast run and a retrain each leave exactly one entry, their explicit one', async () => {
    await expectOneEntry(() => api().post('/api/forecast/run'), {
      status: 200, action: 'FORECAST_RUN', module: 'Forecasting', endpoint: '/api/forecast/run', method: 'POST',
    });
    await expectOneEntry(() => api().post('/api/forecast/retrain'), {
      status: 200, action: 'MODEL_RETRAINED', module: 'Forecasting', endpoint: '/api/forecast/retrain', method: 'POST',
    });
  }, 30000);
});

describe('routes logged by their own code', () => {
  test('an Excel upload leaves exactly one EXCEL_UPLOAD entry, with the full endpoint', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      name: 'Cetirizine 10mg', category: 'Antihistamine', batchNumber: 'CT-1', expiryDate: '2031-01-01',
      quantity: 50, purchasePrice: 1, sellingPrice: 3, rackNumber: 'R3', reorderLevel: 10,
    }]), 'Data');
    const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const { entry } = await expectOneEntry(
      () => api().post('/api/uploads/excel').attach('file', file, {
        filename: 'stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      { status: 200, action: 'EXCEL_UPLOAD', module: 'DataImport', endpoint: '/api/uploads/excel', method: 'POST' }
    );
    expect(entry.details).toMatchObject({ fileName: 'stock.xlsx', recordsSuccessful: 1 });
  });

  test('resolving an alert leaves exactly one ALERT_RESOLVED entry', async () => {
    const med = await addMedicine({ batches: [{ batchNumber: 'OLD', expiryDate: daysFromNow(-3), quantity: 20, rackNumber: 'R1' }] });
    await alertService.generate();
    const alert = await Alert.findOne({ medicineId: med._id, alertType: 'expired' }).lean();

    await expectOneEntry(() => api().put(`/api/alerts/${alert._id}/resolve`), {
      status: 200, action: 'ALERT_RESOLVED', module: 'Alerts', endpoint: `/api/alerts/${alert._id}/resolve`, method: 'PUT',
    });
  });
});

describe('writes that are not logged', () => {
  test('a chatbot query (a read) leaves no entry', async () => {
    await expectNoEntry(() => api().post('/api/chatbot/query').send({ message: 'stock of paracetamol' }), 200);
  });

  test('regenerating alerts (housekeeping) leaves no entry', async () => {
    await expectNoEntry(() => api().post('/api/alerts/generate'), 200);
  });

  test('failed requests leave no entry', async () => {
    await expectNoEntry(() => api().post('/api/customers').send({ name: 'No Phone' }), 400);
    await expectNoEntry(() => api().put(`/api/inventory/${new mongoose.Types.ObjectId()}`).send({ sellingPrice: 1 }), 404);
    await expectNoEntry(() => request(app).post('/api/customers').send({ name: 'x', phone: '1' }), 401);
    await expectNoEntry(() => api().post('/api/no-such-route'), 404);
  });
});

describe('fallback', () => {
  test('a successful write with no row in the table is recorded as OTHER / System with its full endpoint', async () => {
    await AuditLog.deleteMany({});
    const res = await request(app).post('/api/unmapped/things/42?x=1').send({ password: 'secret!' });
    expect(res.status).toBe(201);
    const logged = await entries();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      action: 'OTHER', module: 'System', endpoint: '/api/unmapped/things/42', httpMethod: 'POST', username: 'anonymous',
    });
    expect(logged[0].details.body.password).toBe('[REDACTED]');
    expect(log).toHaveBeenCalledWith('WARN', expect.stringContaining('AUDIT_ROUTES'), {
      route: 'POST /api/unmapped/things/:id', endpoint: '/api/unmapped/things/42',
    });
  });

  test('a failed audit write is logged with the full endpoint', async () => {
    const spy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('db down'));
    try {
      const res = await api().post('/api/categories').send({ name: 'Antiviral' });
      expect(res.status).toBe(201);
      await settle();
      expect(log).toHaveBeenCalledWith('ERROR', 'Audit log write failed', {
        error: 'db down', method: 'POST', endpoint: '/api/categories', action: 'CATEGORY_CREATED',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

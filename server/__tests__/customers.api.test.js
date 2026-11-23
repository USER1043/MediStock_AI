/**
 * @file Tests for customer API hardening: update whitelist, duplicate phone on edit,
 * regex-safe search, and blocking deletion of customers who have bills.
 * Uses a real MongoDB started by mongodb-memory-server.
 */
import { jest } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

jest.setTimeout(60000);
jest.unstable_mockModule('../utils/logger.js', () => ({ default: () => {} }));

const { createCustomer, updateCustomer, deleteCustomer, searchCustomers } = await import(
  '../controllers/customerController.js'
);
const { Customer } = await import('../models/customerModel.js');
const { Bill } = await import('../models/billModel.js');

const invoke = async (handler, req) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };
  await handler({ params: {}, query: {}, body: {}, ...req }, res);
  return result;
};

let server;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Customer.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Customer.deleteMany({});
  await Bill.deleteMany({});
});

const makeCustomer = (overrides = {}) =>
  Customer.create({ name: 'Asha Rao', phone: '9000000001', ...overrides });

describe('PUT /customers/:id field whitelist', () => {
  it('ignores computed fields sent in the body', async () => {
    const c = await makeCustomer({ totalPurchases: 3, totalSpent: 450 });
    const res = await invoke(updateCustomer, {
      params: { id: c._id.toString() },
      body: { name: 'Asha R', totalPurchases: 9999, totalSpent: 1e9, createdAt: new Date(0), _id: new mongoose.Types.ObjectId() },
    });
    expect(res.status).toBe(200);
    const stored = await Customer.findById(c._id).lean();
    expect(stored.name).toBe('Asha R');
    expect(stored.totalPurchases).toBe(3);
    expect(stored.totalSpent).toBe(450);
    expect(stored.createdAt.getTime()).toBe(c.createdAt.getTime());
  });

  it('updates every editable field', async () => {
    const c = await makeCustomer();
    const body = { name: 'New', phone: '9000000002', email: 'N@X.COM', customerType: 'regular', address: 'A', city: 'C' };
    const res = await invoke(updateCustomer, { params: { id: c._id.toString() }, body });
    expect(res.status).toBe(200);
    const stored = await Customer.findById(c._id).lean();
    expect(stored).toMatchObject({ ...body, email: 'n@x.com' });
  });

  it('runs validators (bad enum value, empty name)', async () => {
    const c = await makeCustomer();
    const bad = await invoke(updateCustomer, { params: { id: c._id.toString() }, body: { customerType: 'vip' } });
    expect(bad.status).toBe(400);
    const empty = await invoke(updateCustomer, { params: { id: c._id.toString() }, body: { name: '' } });
    expect(empty.status).toBe(400);
    expect((await Customer.findById(c._id).lean()).customerType).toBe('walking');
  });

  it('returns 404 for an unknown customer', async () => {
    const res = await invoke(updateCustomer, {
      params: { id: new mongoose.Types.ObjectId().toString() },
      body: { name: 'x' },
    });
    expect(res.status).toBe(404);
  });
});

describe('duplicate phone', () => {
  it('create and edit both return 400 with the same message', async () => {
    await makeCustomer({ phone: '9000000001' });
    const other = await makeCustomer({ name: 'Other', phone: '9000000002' });

    const created = await invoke(createCustomer, { body: { name: 'Dup', phone: '9000000001' } });
    const edited = await invoke(updateCustomer, { params: { id: other._id.toString() }, body: { phone: '9000000001' } });

    expect(created.status).toBe(400);
    expect(edited.status).toBe(400);
    expect(edited.body.message).toBe(created.body.message);
    expect((await Customer.findById(other._id).lean()).phone).toBe('9000000002');
  });

  it('allows re-saving a customer with their own phone', async () => {
    const c = await makeCustomer();
    const res = await invoke(updateCustomer, { params: { id: c._id.toString() }, body: { name: 'Same', phone: c.phone } });
    expect(res.status).toBe(200);
  });
});

describe('GET /customers/search', () => {
  it.each(['(', '*', '[', '\\', '+', '?', 'a(b'])('does not error on regex metacharacters: %s', async (query) => {
    await makeCustomer();
    const res = await invoke(searchCustomers, { query: { query } });
    expect(res.status).toBe(200);
    expect(res.body.customers).toEqual([]);
  });

  it('matches special characters literally, not as a pattern', async () => {
    await makeCustomer({ name: 'A.B', phone: '9000000001' });
    await makeCustomer({ name: 'AxB', phone: '9000000002' });
    const res = await invoke(searchCustomers, { query: { query: 'A.B' } });
    expect(res.body.customers.map((c) => c.name)).toEqual(['A.B']);
  });

  it('still searches case-insensitively by name, phone and email', async () => {
    await makeCustomer({ name: 'Asha Rao', email: 'asha@example.com' });
    for (const query of ['asha', 'RAO', '9000000001', 'example.com']) {
      const res = await invoke(searchCustomers, { query: { query } });
      expect(res.body.count).toBe(1);
    }
  });

  it('rejects a non-string query with 400', async () => {
    const res = await invoke(searchCustomers, { query: { query: { $ne: 'x' } } });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /customers/:id', () => {
  const makeBill = (customerId) =>
    Bill.create({
      billNumber: `B-${new mongoose.Types.ObjectId()}`,
      customerId,
      customerName: 'Asha Rao',
      items: [],
      subtotal: 10,
      tax: 1.2,
      grandTotal: 11.2,
      paymentMethod: 'cash',
    });

  it('blocks deleting a customer who has bills (409) and keeps them', async () => {
    const c = await makeCustomer();
    await makeBill(c._id);
    const res = await invoke(deleteCustomer, { params: { id: c._id.toString() } });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/bill/i);
    expect(await Customer.findById(c._id)).not.toBeNull();
    expect(await Bill.countDocuments({ customerId: c._id })).toBe(1);
  });

  it('deletes a customer without bills, even when other customers have bills', async () => {
    const c = await makeCustomer();
    const other = await makeCustomer({ name: 'Other', phone: '9000000002' });
    await makeBill(other._id);
    const res = await invoke(deleteCustomer, { params: { id: c._id.toString() } });
    expect(res.status).toBe(200);
    expect(await Customer.findById(c._id)).toBeNull();
  });

  it('returns 404 for an unknown customer', async () => {
    const res = await invoke(deleteCustomer, { params: { id: new mongoose.Types.ObjectId().toString() } });
    expect(res.status).toBe(404);
  });
});

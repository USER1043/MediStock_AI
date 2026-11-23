/**
 * POST /api/uploads/excel end to end: the real API routers behind the audit middleware, on an
 * in-memory MongoDB (mongodb-memory-server). Never connects to MONGODB_URI.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import XLSX from 'xlsx';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

process.env.JWT_SECRET = 'upload-integration-test-secret';

const { auditLogger } = await import('../middleware/auditLogger.js');
const { mountApiRouters } = await import('../routes/index.js');
const { Medicine } = await import('../models/medicineModel.js');
const { AuditLog } = await import('../models/auditLogModel.js');
const { User } = await import('../models/userModel.js');

let server;
let app;
let token;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const workbook = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const upload = (rows, auth = true) => {
  const req = request(app).post('/api/uploads/excel');
  if (auth) req.set('Authorization', `Bearer ${token}`);
  return req.attach('file', workbook(rows), { filename: 'stock.xlsx', contentType: XLSX_TYPE });
};

const validRow = {
  name: 'Amoxicillin 250mg', category: 'Antibiotics', batchNumber: 'QA-BATCH-001', expiryDate: '2028-12-31',
  quantity: 500, purchasePrice: 10, sellingPrice: 15, rackNumber: 'A-12', reorderLevel: 50,
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  app = express();
  app.use(express.json());
  app.use(auditLogger);
  mountApiRouters(app);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await Promise.all([Medicine, AuditLog, User].map((M) => M.deleteMany({})));
  const owner = await User.create({ username: 'qa_owner', email: 'qa@medistock.test', password: 'QaEngineer#1', role: 'owner' });
  token = jwt.sign({ id: owner._id.toString(), username: owner.username, role: owner.role }, process.env.JWT_SECRET);
});

test('401 without a token, and nothing is imported', async () => {
  const res = await upload([validRow], false);
  expect(res.status).toBe(401);
  expect(res.body.success).toBe(false);
  expect(await Medicine.countDocuments()).toBe(0);
});

test('a valid file imports the medicine exactly as in the sheet and records one EXCEL_UPLOAD entry', async () => {
  const res = await upload([validRow]);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);

  const saved = await Medicine.findOne({ name: 'Amoxicillin 250mg' }).lean();
  expect(saved).toMatchObject({ category: 'Antibiotics', quantity: 500, sellingPrice: 15, purchasePrice: 10, reorderLevel: 50 });
  expect(saved.batches).toHaveLength(1);
  expect(saved.batches[0]).toMatchObject({ batchNumber: 'QA-BATCH-001', quantity: 500, rackNumber: 'A-12' });
  expect(saved.batches[0].expiryDate.toISOString()).toBe('2028-12-31T00:00:00.000Z');

  const entry = await AuditLog.findById(res.body.uploadLog._id).lean();
  expect(entry).toMatchObject({ action: 'EXCEL_UPLOAD' });
  expect(entry.details.recordsSuccessful).toBe(1);
});

test('a negative quantity and a past expiry date are reported as anomalies with their Excel rows', async () => {
  const res = await upload([
    validRow,
    { ...validRow, name: 'Expired Aspirin', batchNumber: 'QA-BATCH-002', expiryDate: '2020-01-01', quantity: -100 },
  ]);
  expect(res.status).toBe(200);
  const anomalies = res.body.uploadLog.anomalies;
  expect(anomalies).toEqual(expect.arrayContaining([
    expect.objectContaining({ row: 3, field: 'quantity' }),
    expect.objectContaining({ row: 3, field: 'expiryDate' }),
  ]));
  expect(anomalies.filter((a) => a.row === 2)).toEqual([]);
});

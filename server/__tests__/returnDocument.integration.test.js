/**
 * Update endpoints must respond with the document *after* the update.
 *
 * These handlers use findOneAndUpdate/findByIdAndUpdate. Without
 * `returnDocument: 'after'` (formerly the `new: true` option, deprecated in
 * Mongoose 9) Mongoose returns the document as it was before the update, so
 * each test checks that the response carries the new values. A last check
 * makes sure the Mongoose `new` deprecation warning is no longer emitted.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: jest.fn(),
}));
jest.unstable_mockModule('../middleware/auditLogger.js', () => ({
  createAuditEntry: jest.fn(async () => {}),
  auditLogger: (req, res, next) => next(),
}));

const { resolveAlert } = await import('../controllers/alertController.js');
const { updateCustomer } = await import('../controllers/customerController.js');
const { updateSupplier } = await import('../controllers/supplierController.js');
const { saveDemandParameters } = await import('../controllers/forecastController.js');
const { updateUser } = await import('../controllers/authController.js');
const { Alert } = await import('../models/alertModel.js');
const { Customer } = await import('../models/customerModel.js');
const { Supplier } = await import('../models/supplierModels.js');
const { ForecastParameters } = await import('../models/forecastModel.js');
const { User } = await import('../models/userModel.js');

const ownerId = new mongoose.Types.ObjectId().toString();
const mockReq = ({ body = {}, params = {} } = {}) => ({
  body,
  params,
  user: { id: ownerId, role: 'owner', username: 'owner' },
  headers: {},
});
const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const isNewOptionDeprecation = (warning) =>
  String(warning?.message ?? warning).includes('the `new` option');

describe('update endpoints return the updated document', () => {
  let server;
  let emitWarningSpy;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all([Alert.init(), Customer.init(), Supplier.init(), ForecastParameters.init(), User.init()]);
    // Mongoose emits its deprecations through process.emitWarning (utils.warn)
    emitWarningSpy = jest.spyOn(process, 'emitWarning');
  }, 120000);

  afterAll(async () => {
    emitWarningSpy.mockRestore();
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Alert.deleteMany({}),
      Customer.deleteMany({}),
      Supplier.deleteMany({}),
      ForecastParameters.deleteMany({}),
      User.deleteMany({}),
    ]);
  });

  test('resolveAlert responds with isResolved: true', async () => {
    const alert = await Alert.create({
      medicineId: new mongoose.Types.ObjectId(),
      medicineName: 'Paracetamol 500mg',
      alertType: 'low_stock',
      message: 'Low stock',
    });

    const res = mockRes();
    await resolveAlert(mockReq({ params: { id: alert._id.toString() } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.alert.isResolved).toBe(true);
  });

  test('updateCustomer responds with the new values', async () => {
    const customer = await Customer.create({ name: 'Old Name', phone: '9000000001', city: 'Chennai' });

    const res = mockRes();
    await updateCustomer(
      mockReq({ params: { id: customer._id.toString() }, body: { name: 'New Name', city: 'Madurai' } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.customer).toMatchObject({ name: 'New Name', city: 'Madurai', phone: '9000000001' });
  });

  test('updateSupplier responds with the new values', async () => {
    const supplier = await Supplier.create({
      supplier_name: 'Acme Pharma',
      contact_info: { phone: '9000000002', email: 'acme@test.local', address: '1 Main St' },
      delivery_performance_score: 5,
    });

    const res = mockRes();
    await updateSupplier(
      mockReq({
        params: { id: supplier._id.toString() },
        body: { delivery_performance_score: 8.5, notes: 'Reliable' },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.supplier.delivery_performance_score).toBe(8.5);
    expect(res.body.supplier.notes).toBe('Reliable');
    expect(res.body.supplier.supplier_name).toBe('Acme Pharma');
  });

  test('updateUser responds with the new values', async () => {
    const [user] = await User.insertMany([
      {
        username: 'staff',
        email: 'staff@test.local',
        password: bcryptjs.hashSync('staff123', 10),
        role: 'staff',
      },
    ]);

    const res = mockRes();
    await updateUser(
      mockReq({ params: { id: user._id.toString() }, body: { email: 'staff-new@test.local' } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.user.email).toBe('staff-new@test.local');
  });

  describe('saveDemandParameters (upsert, lean)', () => {
    test('insert path: with no stored parameters, responds with the created document and defaults', async () => {
      const res = mockRes();
      await saveDemandParameters(mockReq({ body: { leadTimeDays: 10 } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.parameters).not.toBeNull();
      expect(res.body.parameters.leadTimeDays).toBe(10);
      // setDefaultsOnInsert fills the rest
      expect(res.body.parameters.forecastHorizon).toBe(4);
      expect(res.body.parameters.safetyStockPercent).toBe(20);
      expect(await ForecastParameters.countDocuments()).toBe(1);
    });

    test('update path: responds with the updated document and keeps a single record', async () => {
      const existing = await ForecastParameters.create({ leadTimeDays: 7, forecastHorizon: 6 });

      const res = mockRes();
      await saveDemandParameters(mockReq({ body: { leadTimeDays: 14 } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.body.parameters._id.toString()).toBe(existing._id.toString());
      expect(res.body.parameters.leadTimeDays).toBe(14);
      expect(res.body.parameters.forecastHorizon).toBe(6);
      // lean: a plain object, not a Mongoose document
      expect(res.body.parameters instanceof mongoose.Document).toBe(false);
      expect(await ForecastParameters.countDocuments()).toBe(1);
    });
  });

  // Runs last in this file, after every handler above has issued its update
  test('no Mongoose `new` option deprecation warning was emitted', () => {
    const newOptionWarnings = emitWarningSpy.mock.calls.filter(([warning]) => isNewOptionDeprecation(warning));
    expect(newOptionWarnings).toEqual([]);
  });
});

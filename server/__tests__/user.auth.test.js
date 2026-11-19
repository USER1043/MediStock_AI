/**
 * User model & auth controller tests against a real in-memory MongoDB.
 * Guards the User pre-save password hook (Mongoose 9 no longer passes `next`
 * to middleware) and the auth flows that depend on it: register, login and 2FA.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import speakeasy from 'speakeasy';
import bcryptjs from 'bcryptjs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';

// Keep log files and audit writes out of the tests
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: jest.fn(),
}));
const createAuditEntry = jest.fn(async () => {});
jest.unstable_mockModule('../middleware/auditLogger.js', () => ({
  createAuditEntry,
  auditLogger: (req, res, next) => next(),
}));

const { User } = await import('../models/userModel.js');
const { register, login, setup2FA, verify2FASetup, verify2FALogin } = await import(
  '../controllers/authController.js'
);

// Minimal Express req/res doubles
const mockReq = ({ body = {}, params = {}, user } = {}) => ({
  body,
  params,
  user,
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
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

const BCRYPT_HASH = /^\$2[aby]\$10\$.{53}$/;

const createOwner = () =>
  User.create({ username: 'owner', email: 'owner@test.local', password: 'owner123', role: 'owner' });

// Inserts the owner with a pre-hashed password, bypassing the save hook, so the
// controller tests exercise the hook only through the controller under test.
const insertOwner = async () => {
  const [owner] = await User.insertMany([
    {
      username: 'owner',
      email: 'owner@test.local',
      password: bcryptjs.hashSync('owner123', 10),
      role: 'owner',
    },
  ]);
  return owner;
};

const ownerReqUser = (owner) => ({
  id: owner._id.toString(),
  role: 'owner',
  username: owner.username,
  email: owner.email,
});

describe('User model and auth controller', () => {
  let server;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await User.init();
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    createAuditEntry.mockClear();
  });

  describe('password pre-save hook', () => {
    test('User.create stores a bcrypt hash, not the plain password', async () => {
      const user = await createOwner();

      expect(user.password).not.toBe('owner123');
      expect(user.password).toMatch(BCRYPT_HASH);

      const stored = await User.findById(user._id).lean();
      expect(stored.password).toBe(user.password);
      expect(stored.password).toMatch(BCRYPT_HASH);
    });

    test('matchPassword accepts the right password and rejects a wrong one', async () => {
      await createOwner();
      const user = await User.findOne({ username: 'owner' });

      await expect(user.matchPassword('owner123')).resolves.toBe(true);
      await expect(user.matchPassword('wrong-password')).resolves.toBe(false);
    });

    test('saving a non-password change keeps the same hash (no double hashing)', async () => {
      const created = await createOwner();
      const originalHash = created.password;

      const user = await User.findById(created._id);
      user.isActive = false;
      await user.save();

      const reloaded = await User.findById(created._id);
      expect(reloaded.isActive).toBe(false);
      expect(reloaded.password).toBe(originalHash);
      await expect(reloaded.matchPassword('owner123')).resolves.toBe(true);
    });

    test('changing the password re-hashes it', async () => {
      const created = await createOwner();
      const originalHash = created.password;

      const user = await User.findById(created._id);
      user.password = 'new-secret-456';
      await user.save();

      const reloaded = await User.findById(created._id);
      expect(reloaded.password).not.toBe(originalHash);
      expect(reloaded.password).not.toBe('new-secret-456');
      expect(reloaded.password).toMatch(BCRYPT_HASH);
      await expect(reloaded.matchPassword('new-secret-456')).resolves.toBe(true);
      await expect(reloaded.matchPassword('owner123')).resolves.toBe(false);
    });

    test('validation errors still reject the save', async () => {
      await expect(
        User.create({ username: 'shortpw', email: 'shortpw@test.local', password: '123' })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  describe('register and login controllers', () => {
    test('register creates a staff user who can then log in', async () => {
      const owner = await insertOwner();

      const regRes = mockRes();
      await register(
        mockReq({
          body: { username: 'staff1', email: 'Staff1@Test.local', password: 'staff123' },
          user: ownerReqUser(owner),
        }),
        regRes
      );

      expect(regRes.statusCode).toBe(201);
      expect(regRes.body.success).toBe(true);
      expect(regRes.body.user).toMatchObject({ username: 'staff1', email: 'staff1@test.local', role: 'staff' });

      const stored = await User.findOne({ username: 'staff1' }).lean();
      expect(stored.password).toMatch(BCRYPT_HASH);

      const loginRes = mockRes();
      await login(mockReq({ body: { username: 'staff1', password: 'staff123' } }), loginRes);

      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(typeof loginRes.body.token).toBe('string');
      expect(loginRes.body.user.role).toBe('staff');
      expect(createAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_LOGIN', username: 'staff1' })
      );

      const badRes = mockRes();
      await login(mockReq({ body: { username: 'staff1', password: 'nope' } }), badRes);
      expect(badRes.statusCode).toBe(401);
    });

    test('register rejects a non-owner caller', async () => {
      const res = mockRes();
      await register(
        mockReq({
          body: { username: 'staff2', email: 'staff2@test.local', password: 'staff123' },
          user: { id: new mongoose.Types.ObjectId().toString(), role: 'staff' },
        }),
        res
      );

      expect(res.statusCode).toBe(403);
      expect(await User.countDocuments({ username: 'staff2' })).toBe(0);
    });
  });

  describe('2FA', () => {
    test('setup2FA then verify2FASetup enables 2FA, and login then requires a TOTP code', async () => {
      const owner = await insertOwner();
      const reqUser = ownerReqUser(owner);

      const setupRes = mockRes();
      await setup2FA(mockReq({ user: reqUser }), setupRes);
      expect(setupRes.statusCode).toBe(200);
      const { secret } = setupRes.body;
      expect(typeof secret).toBe('string');

      const token = speakeasy.totp({ secret, encoding: 'base32' });
      const verifyRes = mockRes();
      await verify2FASetup(mockReq({ body: { token, secret }, user: reqUser }), verifyRes);

      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body.success).toBe(true);

      const stored = await User.findById(owner._id).lean();
      expect(stored.isTwoFactorEnabled).toBe(true);
      expect(stored.twoFactorSecret).toBe(secret);
      // Enabling 2FA must not touch the password hash
      expect(stored.password).toBe(owner.password);

      const loginRes = mockRes();
      await login(mockReq({ body: { username: 'owner', password: 'owner123' } }), loginRes);
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body.requires2FA).toBe(true);
      expect(loginRes.body.token).toBeUndefined();

      const twoFaRes = mockRes();
      await verify2FALogin(
        mockReq({ body: { username: 'owner', token: speakeasy.totp({ secret, encoding: 'base32' }) } }),
        twoFaRes
      );
      expect(twoFaRes.statusCode).toBe(200);
      expect(typeof twoFaRes.body.token).toBe('string');
    });

    test('verify2FASetup with a wrong code leaves 2FA disabled', async () => {
      const owner = await insertOwner();
      const reqUser = ownerReqUser(owner);

      const setupRes = mockRes();
      await setup2FA(mockReq({ user: reqUser }), setupRes);
      const { secret } = setupRes.body;
      const valid = speakeasy.totp({ secret, encoding: 'base32' });
      const wrong = String((Number(valid) + 500000) % 1000000).padStart(6, '0');

      const res = mockRes();
      await verify2FASetup(mockReq({ body: { token: wrong, secret }, user: reqUser }), res);

      expect(res.statusCode).toBe(400);
      const stored = await User.findById(owner._id).lean();
      expect(stored.isTwoFactorEnabled).toBe(false);
    });
  });
});

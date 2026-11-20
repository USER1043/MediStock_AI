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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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
const { register, login, updateUser, setup2FA, verify2FASetup, verify2FALogin } = await import(
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

// Runs updateUser in a plain Node child process (see helpers/runUpdateUser.mjs for why)
const runUpdateUserInNode = async (uri, req) => {
  const script = fileURLToPath(new URL('./helpers/runUpdateUser.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [script, uri, JSON.stringify(req)], {
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  return JSON.parse(stdout);
};

// password and twoFactorSecret are select: false; tests that inspect them ask for them
const SECRETS = '+password +twoFactorSecret';

const BCRYPT_HASH = /^\$2[aby]\$10\$.{53}$/;

// Meets the password policy (utils/passwordPolicy.js)
const OWNER_PASSWORD = 'Owner#2024';

const createOwner = () =>
  User.create({ username: 'owner', email: 'owner@test.local', password: OWNER_PASSWORD, role: 'owner' });

// Inserts the owner with a pre-hashed password, bypassing the save hook, so the
// controller tests exercise the hook only through the controller under test.
// 'owner123' predates the password policy: such accounts must still log in.
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

      expect(user.password).not.toBe(OWNER_PASSWORD);
      expect(user.password).toMatch(BCRYPT_HASH);

      const stored = await User.findById(user._id).select(SECRETS).lean();
      expect(stored.password).toBe(user.password);
      expect(stored.password).toMatch(BCRYPT_HASH);
    });

    test('matchPassword accepts the right password and rejects a wrong one', async () => {
      await createOwner();
      const user = await User.findOne({ username: 'owner' }).select(SECRETS);

      await expect(user.matchPassword(OWNER_PASSWORD)).resolves.toBe(true);
      await expect(user.matchPassword('wrong-password')).resolves.toBe(false);
    });

    test('saving a non-password change keeps the same hash (no double hashing)', async () => {
      const created = await createOwner();
      const originalHash = created.password;

      const user = await User.findById(created._id);
      user.isActive = false;
      await user.save();

      const reloaded = await User.findById(created._id).select(SECRETS);
      expect(reloaded.isActive).toBe(false);
      expect(reloaded.password).toBe(originalHash);
      await expect(reloaded.matchPassword(OWNER_PASSWORD)).resolves.toBe(true);
    });

    test('changing the password re-hashes it', async () => {
      const created = await createOwner();
      const originalHash = created.password;

      const user = await User.findById(created._id).select(SECRETS);
      user.password = 'New-Secret-456';
      await user.save();

      const reloaded = await User.findById(created._id).select(SECRETS);
      expect(reloaded.password).not.toBe(originalHash);
      expect(reloaded.password).not.toBe('New-Secret-456');
      expect(reloaded.password).toMatch(BCRYPT_HASH);
      await expect(reloaded.matchPassword('New-Secret-456')).resolves.toBe(true);
      await expect(reloaded.matchPassword(OWNER_PASSWORD)).resolves.toBe(false);
    });

    test('a weak new password is rejected by the model, with no plain text in the error', async () => {
      const error = await User.create({
        username: 'weak',
        email: 'weak@test.local',
        password: 'owner123',
      }).catch((e) => e);

      expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
      expect(error.errors.password.kind).toBe('passwordPolicy');
      expect(error.errors.password.message).toBe('Password must include an uppercase letter and a symbol.');
      expect(error.message).not.toContain('owner123');
      expect(await User.countDocuments({ username: 'weak' })).toBe(0);

      // Changing an existing user's password to a weak one is rejected too
      const created = await createOwner();
      const user = await User.findById(created._id).select(SECRETS);
      user.password = 'weakpass';
      await expect(user.save()).rejects.toThrow(mongoose.Error.ValidationError);
      expect((await User.findById(created._id).select(SECRETS).lean()).password).toBe(created.password);
    });

    test('the model minlength (8) error does not echo the password', async () => {
      const error = await User.create({ username: 'shortpw', email: 'shortpw@test.local', password: 'Ab1!x' }).catch(
        (e) => e
      );
      expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
      expect(error.errors.password.kind).toBe('minlength');
      expect(error.message).not.toContain('Ab1!x');
    });

  });

  describe('register and login controllers', () => {
    test('register creates a staff user who can then log in', async () => {
      const owner = await insertOwner();

      const regRes = mockRes();
      await register(
        mockReq({
          body: { username: 'staff1', email: 'Staff1@Test.local', password: 'Staff#123' },
          user: ownerReqUser(owner),
        }),
        regRes
      );

      expect(regRes.statusCode).toBe(201);
      expect(regRes.body.success).toBe(true);
      expect(regRes.body.user).toMatchObject({ username: 'staff1', email: 'staff1@test.local', role: 'staff' });

      const stored = await User.findOne({ username: 'staff1' }).select(SECRETS).lean();
      expect(stored.password).toMatch(BCRYPT_HASH);

      const loginRes = mockRes();
      await login(mockReq({ body: { username: 'staff1', password: 'Staff#123' } }), loginRes);

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
          body: { username: 'staff2', email: 'staff2@test.local', password: 'Staff#123' },
          user: { id: new mongoose.Types.ObjectId().toString(), role: 'staff' },
        }),
        res
      );

      expect(res.statusCode).toBe(403);
      expect(await User.countDocuments({ username: 'staff2' })).toBe(0);
    });

    test('register rejects a weak password with 400, names what is missing, and creates no user', async () => {
      const owner = await insertOwner();

      const res = mockRes();
      await register(
        mockReq({
          body: { username: 'staff3', email: 'staff3@test.local', password: 'staff123' },
          user: ownerReqUser(owner),
        }),
        res
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        errorCode: 'WEAK_PASSWORD',
        failedRules: ['uppercase', 'symbol'],
        message: 'Password must include an uppercase letter and a symbol.',
      });
      expect(await User.countDocuments({ username: 'staff3' })).toBe(0);

      const short = mockRes();
      await register(
        mockReq({
          body: { username: 'staff3', email: 'staff3@test.local', password: 'Ab1!' },
          user: ownerReqUser(owner),
        }),
        short
      );
      expect(short.statusCode).toBe(400);
      expect(short.body.failedRules).toEqual(['minLength']);
      expect(short.body.message).toBe('Password must be at least 8 characters.');
      expect(await User.countDocuments({ username: 'staff3' })).toBe(0);
    });

    test('login does not apply the policy: a user whose password predates it can still log in', async () => {
      await insertOwner(); // stored hash of 'owner123', which the policy would now reject

      const res = mockRes();
      await login(mockReq({ body: { username: 'owner', password: 'owner123' } }), res);

      expect(res.statusCode).toBe(200);
      expect(typeof res.body.token).toBe('string');
    });
  });

  describe('updateUser controller', () => {
    const insertStaff = async () => {
      const [staff] = await User.insertMany([
        {
          username: 'staff',
          email: 'staff@test.local',
          password: bcryptjs.hashSync('staff123', 10),
          role: 'staff',
        },
      ]);
      return staff;
    };

    test('owner changes a user password: stored as a bcrypt hash, login uses the new one', async () => {
      const owner = await insertOwner();
      const staff = await insertStaff();

      // Plain Node, so a CommonJS-interop bug in how bcryptjs is imported shows up
      const res = await runUpdateUserInNode(server.getUri(), {
        params: { id: staff._id.toString() },
        body: { password: 'New-Staff-456' },
        user: ownerReqUser(owner),
      });

      expect(res.body.error).toBeUndefined();
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.password).toBeUndefined();

      const stored = await User.findById(staff._id).select(SECRETS).lean();
      expect(stored.password).toMatch(BCRYPT_HASH);
      expect(stored.password).not.toBe(staff.password);
      await expect(bcryptjs.compare('New-Staff-456', stored.password)).resolves.toBe(true);

      const newLogin = mockRes();
      await login(mockReq({ body: { username: 'staff', password: 'New-Staff-456' } }), newLogin);
      expect(newLogin.statusCode).toBe(200);
      expect(typeof newLogin.body.token).toBe('string');

      const oldLogin = mockRes();
      await login(mockReq({ body: { username: 'staff', password: 'staff123' } }), oldLogin);
      expect(oldLogin.statusCode).toBe(401);
    }, 30000);

    test('a weak new password is rejected with 400 and the stored hash is unchanged', async () => {
      const owner = await insertOwner();
      const staff = await insertStaff();

      const res = await runUpdateUserInNode(server.getUri(), {
        params: { id: staff._id.toString() },
        body: { password: 'newstaff456', email: 'changed@test.local' },
        user: ownerReqUser(owner),
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        errorCode: 'WEAK_PASSWORD',
        failedRules: ['uppercase', 'symbol'],
        message: 'Password must include an uppercase letter and a symbol.',
      });

      // Nothing in the request was applied
      const stored = await User.findById(staff._id).select(SECRETS).lean();
      expect(stored.password).toBe(staff.password);
      expect(stored.email).toBe('staff@test.local');

      const oldLogin = mockRes();
      await login(mockReq({ body: { username: 'staff', password: 'staff123' } }), oldLogin);
      expect(oldLogin.statusCode).toBe(200);
    }, 30000);

    test('updating only email and role leaves the password hash unchanged', async () => {
      const owner = await insertOwner();
      const staff = await insertStaff();

      const res = mockRes();
      await updateUser(
        mockReq({
          params: { id: staff._id.toString() },
          body: { email: 'staff-new@test.local', role: 'owner' },
          user: ownerReqUser(owner),
        }),
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.user).toMatchObject({ email: 'staff-new@test.local', role: 'owner' });

      const stored = await User.findById(staff._id).select(SECRETS).lean();
      expect(stored.email).toBe('staff-new@test.local');
      expect(stored.role).toBe('owner');
      expect(stored.password).toBe(staff.password);
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

      const stored = await User.findById(owner._id).select(SECRETS).lean();
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
      const stored = await User.findById(owner._id).select(SECRETS).lean();
      expect(stored.isTwoFactorEnabled).toBe(false);
    });
  });
});

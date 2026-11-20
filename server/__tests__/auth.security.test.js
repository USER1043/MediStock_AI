/**
 * Auth hardening, through the real /api/auth router (supertest) on an in-memory MongoDB:
 * - bcrypt only uses the first 72 bytes of a password, so new passwords over 72 UTF-8
 *   bytes are rejected on every path that sets one (register, password change, and the
 *   model hook for scripts). Login never applies the policy.
 * - password and twoFactorSecret never leave the server: they are `select: false` in the
 *   schema and stripped by toJSON, and the 2FA flow still works with them hidden.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import speakeasy from 'speakeasy';
import bcryptjs from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'auth-security-test-secret';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('../middleware/auditLogger.js', () => ({
  createAuditEntry: jest.fn(async () => {}),
  auditLogger: (req, res, next) => next(),
}));

const { User } = await import('../models/userModel.js');
const { default: authRoutes } = await import('../routes/authRoutes.js');
const { getPasswordPolicyFailures, describePasswordPolicyFailures, PASSWORD_MAX_BYTES } = await import(
  '../utils/passwordPolicy.js'
);

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const bytes = (s) => Buffer.byteLength(s, 'utf8');

// All meet every other rule of the policy (lower, upper, digit, symbol, 8+ characters)
const ASCII_72 = 'Aa1!' + 'a'.repeat(68);
const ASCII_73 = ASCII_72 + 'a';
const ACCENT_54 = 'Aa1!' + 'é'.repeat(25); // 'é' is 2 bytes: 4 + 50
const ACCENT_72 = 'Aa1!' + 'é'.repeat(34); // 4 + 68
const ACCENT_73 = ACCENT_72 + 'a';
const ACCENT_78 = 'Aa1!' + 'é'.repeat(37); // 4 + 74 bytes, but only 41 characters

const TOO_LONG_MESSAGE = 'Password must be at most 72 bytes.';
const OWNER_PASSWORD = 'Owner#2024';

let server;
let ownerToken;
let owner;

const loginAs = async (username, password) => request(app).post('/api/auth/login').send({ username, password });
const asOwner = (req) => req.set('Authorization', `Bearer ${ownerToken}`);
const registerStaff = (username, password) =>
  asOwner(request(app).post('/api/auth/register')).send({ username, email: `${username}@test.local`, password });
const changePassword = (id, password) => asOwner(request(app).put(`/api/auth/users/${id}`)).send({ password });

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
  owner = await User.create({ username: 'owner', email: 'owner@test.local', password: OWNER_PASSWORD, role: 'owner' });
  const res = await loginAs('owner', OWNER_PASSWORD);
  ownerToken = res.body.token;
});

describe('password maximum of 72 bytes', () => {
  test('the fixtures have the byte lengths the tests rely on', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect([ASCII_72, ASCII_73, ACCENT_54, ACCENT_72, ACCENT_73, ACCENT_78].map(bytes)).toEqual([72, 73, 54, 72, 73, 78]);
    expect('é'.repeat(37).length).toBe(37);
    expect(bytes('é'.repeat(37))).toBe(74);
  });

  test('why: bcrypt ignores everything after byte 72, so two such passwords match one hash', async () => {
    const hash = await bcryptjs.hash(ASCII_72 + 'X', 4);
    await expect(bcryptjs.compare(ASCII_72 + 'Y', hash)).resolves.toBe(true);
  });

  test('the shared policy counts UTF-8 bytes, not characters', () => {
    expect(getPasswordPolicyFailures(ASCII_72)).toEqual([]);
    expect(getPasswordPolicyFailures(ASCII_73)).toEqual(['maxBytes']);
    expect(getPasswordPolicyFailures(ACCENT_54)).toEqual([]);
    expect(getPasswordPolicyFailures(ACCENT_72)).toEqual([]);
    expect(getPasswordPolicyFailures(ACCENT_73)).toEqual(['maxBytes']);
    expect(getPasswordPolicyFailures(ACCENT_78)).toEqual(['maxBytes']);
    expect(getPasswordPolicyFailures('é'.repeat(25))).not.toContain('maxBytes'); // 50 bytes
    expect(getPasswordPolicyFailures('é'.repeat(37))).toContain('maxBytes'); // 74 bytes, length 37
    expect(getPasswordPolicyFailures('Aa1!' + '😀'.repeat(17))).toEqual([]); // 4 + 68
    expect(getPasswordPolicyFailures('Aa1!' + '😀'.repeat(18))).toEqual(['maxBytes']); // 4 + 72
    expect(describePasswordPolicyFailures(['maxBytes'])).toBe(TOO_LONG_MESSAGE);
    expect(describePasswordPolicyFailures(['maxBytes', 'symbol'])).toBe(
      'Password must be at most 72 bytes and include a symbol.'
    );
  });

  test.each([
    ['ASCII, 72 bytes', ASCII_72],
    ['é, 54 bytes', ACCENT_54],
    ['é, 72 bytes', ACCENT_72],
  ])('register accepts %s, and the user can log in with it', async (name, password) => {
    const res = await registerStaff('staff', password);
    expect(res.status).toBe(201);

    const login = await loginAs('staff', password);
    expect(login.status).toBe(200);
    expect(typeof login.body.token).toBe('string');
  });

  test.each([
    ['ASCII, 73 bytes', ASCII_73],
    ['é, 73 bytes', ACCENT_73],
    ['é, 78 bytes in 41 characters', ACCENT_78],
  ])('register rejects %s with 400 and creates no user', async (name, password) => {
    const res = await registerStaff('staff', password);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, failedRules: ['maxBytes'], message: TOO_LONG_MESSAGE });
    expect(await User.countDocuments({ username: 'staff' })).toBe(0);
  });

  test('the model rejects a password over 72 bytes too (e.g. User.create from a script)', async () => {
    const error = await User.create({ username: 'script', email: 'script@test.local', password: ACCENT_78 }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(error.errors.password.message).toBe(TOO_LONG_MESSAGE);
    expect(error.message).not.toContain(ACCENT_78);
    expect(await User.countDocuments({ username: 'script' })).toBe(0);

    await expect(User.create({ username: 'script', email: 'script@test.local', password: ASCII_72 })).resolves.toBeTruthy();
  });

  test.each([
    ['ASCII, 72 bytes', ASCII_72],
    ['é, 72 bytes', ACCENT_72],
  ])('a password change to %s is accepted and the new password logs in', async (name, password) => {
    const staff = await registerStaff('staff', 'Staff#123');
    const res = await changePassword(staff.body.user.id, password);
    expect(res.status).toBe(200);

    expect((await loginAs('staff', password)).status).toBe(200);
    expect((await loginAs('staff', 'Staff#123')).status).toBe(401);
  });

  test.each([
    ['ASCII, 73 bytes', ASCII_73],
    ['é, 73 bytes', ACCENT_73],
    ['é, 78 bytes in 41 characters', ACCENT_78],
  ])('a password change to %s is rejected with 400 and the old password still works', async (name, password) => {
    const staff = await registerStaff('staff', 'Staff#123');
    const res = await changePassword(staff.body.user.id, password);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, failedRules: ['maxBytes'], message: TOO_LONG_MESSAGE });

    expect((await loginAs('staff', 'Staff#123')).status).toBe(200);
    expect((await loginAs('staff', password)).status).toBe(401);
  });

  test('changing a password on the document (save hook) over 72 bytes is rejected', async () => {
    const user = await User.findById(owner._id);
    user.password = ASCII_73;
    await expect(user.save()).rejects.toThrow(TOO_LONG_MESSAGE);
    expect((await loginAs('owner', OWNER_PASSWORD)).status).toBe(200);
  });

  test('login does not apply the policy: an existing user logs in, even with a stored >72-byte password', async () => {
    expect((await loginAs('owner', OWNER_PASSWORD)).status).toBe(200);
    expect((await loginAs('owner', 'Wrong#2024')).status).toBe(401);

    // A hash made before the limit existed, bypassing the save hook
    await User.insertMany([
      { username: 'legacy', email: 'legacy@test.local', password: bcryptjs.hashSync(ACCENT_78, 4), role: 'staff' },
    ]);
    const res = await loginAs('legacy', ACCENT_78);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });
});

describe('secrets never leave the server', () => {
  const SECRET = 'JBSWY3DPEHPK3PXP';
  const SECRET_KEYS = ['password', 'twoFactorSecret', 'secret', 'resetPasswordToken', 'backupCodes'];

  // Fails if any key in the body (at any depth) is a secret, or any value is the hash or TOTP secret
  const expectNoSecrets = async (body) => {
    const stored = await User.findById(owner._id).select('+password +twoFactorSecret').lean();
    const json = JSON.stringify(body);
    for (const key of SECRET_KEYS) expect(json).not.toContain(`"${key}"`);
    expect(json).not.toContain(stored.password);
    expect(json).not.toContain(stored.twoFactorSecret);
  };

  beforeEach(async () => {
    await User.updateOne({ _id: owner._id }, { twoFactorSecret: SECRET, isTwoFactorEnabled: true });
  });

  test('GET /api/auth/me has no password or twoFactorSecret, but keeps isTwoFactorEnabled', async () => {
    const res = await asOwner(request(app).get('/api/auth/me'));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'owner', isTwoFactorEnabled: true });
    await expectNoSecrets(res.body);
  });

  test('GET /api/auth/users has no password or twoFactorSecret, but keeps isTwoFactorEnabled', async () => {
    await registerStaff('staff', 'Staff#123');
    const res = await asOwner(request(app).get('/api/auth/users'));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users.find((u) => u.username === 'owner').isTwoFactorEnabled).toBe(true);
    await expectNoSecrets(res.body);
  });

  test('PUT /api/auth/users/:id and POST /api/auth/register responses have no secrets', async () => {
    const reg = await registerStaff('staff', 'Staff#123');
    expect(reg.status).toBe(201);
    await expectNoSecrets(reg.body);
    const put = await asOwner(request(app).put(`/api/auth/users/${owner._id}`)).send({ email: 'boss@test.local' });
    expect(put.status).toBe(200);
    await expectNoSecrets(put.body);
  });

  test('structural: queries leave out password and twoFactorSecret unless asked for', async () => {
    const plain = await User.findById(owner._id).lean();
    expect(plain).not.toHaveProperty('password');
    expect(plain).not.toHaveProperty('twoFactorSecret');
    expect(plain.isTwoFactorEnabled).toBe(true);

    const [listed] = await User.find({ _id: owner._id }).lean();
    expect(listed).not.toHaveProperty('password');
    expect(listed).not.toHaveProperty('twoFactorSecret');

    const asked = await User.findById(owner._id).select('+password +twoFactorSecret').lean();
    expect(asked.twoFactorSecret).toBe(SECRET);
    expect(asked.password).toMatch(/^\$2[aby]\$/);
  });

  test('structural: toJSON strips them even from a document loaded with them', async () => {
    const doc = await User.findById(owner._id).select('+password +twoFactorSecret');
    expect(doc.twoFactorSecret).toBe(SECRET);
    const json = JSON.parse(JSON.stringify(doc));
    expect(json).not.toHaveProperty('password');
    expect(json).not.toHaveProperty('twoFactorSecret');
    expect(json).toMatchObject({ username: 'owner', isTwoFactorEnabled: true });
  });
});

describe('2FA end to end with the secret hidden', () => {
  test('setup -> verify-setup -> login asks for TOTP -> verify-2fa issues a token; /me shows it enabled', async () => {
    const setup = await asOwner(request(app).post('/api/auth/2fa/setup'));
    expect(setup.status).toBe(200);
    const { secret } = setup.body;
    expect(typeof secret).toBe('string');

    const verify = await asOwner(request(app).post('/api/auth/2fa/verify-setup')).send({
      secret,
      token: speakeasy.totp({ secret, encoding: 'base32' }),
    });
    expect(verify.status).toBe(200);
    expect((await User.findById(owner._id).select('+twoFactorSecret').lean()).twoFactorSecret).toBe(secret);

    const login = await loginAs('owner', OWNER_PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.requires2FA).toBe(true);
    expect(login.body.token).toBeUndefined();

    const wrongCode = String((Number(speakeasy.totp({ secret, encoding: 'base32' })) + 500000) % 1000000).padStart(6, '0');
    const bad = await request(app).post('/api/auth/login/verify-2fa').send({ username: 'owner', token: wrongCode });
    expect(bad.status).toBe(401);

    const twoFa = await request(app)
      .post('/api/auth/login/verify-2fa')
      .send({ username: 'owner', token: speakeasy.totp({ secret, encoding: 'base32' }) });
    expect(twoFa.status).toBe(200);
    expect(typeof twoFa.body.token).toBe('string');
    expect(twoFa.body.user.isTwoFactorEnabled).toBe(true);
    expect(JSON.stringify(twoFa.body)).not.toContain(secret);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${twoFa.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.isTwoFactorEnabled).toBe(true);
    expect(JSON.stringify(me.body)).not.toContain(secret);
  });
});

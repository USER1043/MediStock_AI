/**
 * Secrets never reach the activity log: redactSecrets replaces sensitive keys at any depth, by
 * name pattern (password, newPassword, accessToken, twoFactorSecret, apiKey, Authorization, ...),
 * and keeps harmless lookalikes (keyword, author, pincode, tokenCount, ...).
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const { redactSecrets, isSensitiveKey, REDACTED, REDACT_MAX_DEPTH, REDACT_MAX_ITEMS } = await import(
  '../middleware/auditLogger.js'
);

const SENSITIVE = [
  'password', 'Password', 'PASSWORD', 'newPassword', 'currentPassword', 'confirmPassword', 'oldPassword',
  'new_password', 'confirm-password', 'passwd', 'pwd', 'pass',
  'token', 'accessToken', 'refreshToken', 'refresh_token', 'idToken', 'x-auth-token', 'csrfToken', 'tokens',
  'secret', 'twoFactorSecret', 'clientSecret', 'client_secret', 'secrets',
  'apiKey', 'api_key', 'API_KEY', 'privateKey', 'secretKey', 'accessKey', 'key',
  'authorization', 'Authorization', 'auth', 'cookie', 'otp', 'pin', 'cvv',
];

const HARMLESS = [
  'keyword', 'keywords', 'keys', 'monkey', 'primaryKey', 'sortKey', 'author', 'authorName', 'authored',
  'tokenCount', 'tokenized', 'secretary', 'pincode', 'pinned', 'spinner', 'bypass', 'compass', 'passport',
  'passwordPolicy', 'passwordChangedAt', 'isTwoFactorEnabled', 'username', 'email', 'role', 'name',
  'medicineName', 'batchNumber', 'quantity', 'notes', 'contact_info', 'otpSentAt',
];

describe('isSensitiveKey', () => {
  test.each(SENSITIVE)('%s is sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  test.each(HARMLESS)('%s is not', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redactSecrets', () => {
  test('redacts the top-level camelCase variants and keeps everything else', () => {
    const body = {
      username: 'nurse', password: 'P@ss1', newPassword: 'N3w!', currentPassword: 'Cur!', confirmPassword: 'N3w!',
      token: '123456', secret: 'BASE32', twoFactorSecret: 'BASE32', apiKey: 'k', authorization: 'Bearer x',
      keyword: 'paracetamol', author: 'owner', role: 'staff',
    };
    expect(redactSecrets(body)).toEqual({
      username: 'nurse', password: REDACTED, newPassword: REDACTED, currentPassword: REDACTED,
      confirmPassword: REDACTED, token: REDACTED, secret: REDACTED, twoFactorSecret: REDACTED,
      apiKey: REDACTED, authorization: REDACTED, keyword: 'paracetamol', author: 'owner', role: 'staff',
    });
  });

  test('redacts nested objects and objects inside arrays', () => {
    const body = {
      profile: { name: 'Asha', credentials: { password: 'x', accessToken: 'y', refreshToken: 'z' } },
      integrations: [{ name: 'gemini', apiKey: 'AIza' }, { name: 'twilio', authToken: 't', pincode: '600040' }],
      matrix: [[{ secret: 's' }]],
    };
    expect(redactSecrets(body)).toEqual({
      profile: { name: 'Asha', credentials: { password: REDACTED, accessToken: REDACTED, refreshToken: REDACTED } },
      integrations: [{ name: 'gemini', apiKey: REDACTED }, { name: 'twilio', authToken: REDACTED, pincode: '600040' }],
      matrix: [[{ secret: REDACTED }]],
    });
  });

  test('redacts a sensitive key whatever its value is, even an object or an array', () => {
    expect(redactSecrets({ tokens: ['a', 'b'], credentials: { secret: { nested: 1 } } })).toEqual({
      tokens: REDACTED,
      credentials: { secret: REDACTED },
    });
  });

  test('does not change the input, and keeps dates, ids and primitives as they are', () => {
    const id = new mongoose.Types.ObjectId();
    const when = new Date('2030-01-01');
    const body = { id, when, n: 3, ok: true, none: null, nested: { password: 'x' } };
    const out = redactSecrets(body);
    expect(out.id).toBe(id);
    expect(out.when).toBe(when);
    expect(out).toMatchObject({ n: 3, ok: true, none: null, nested: { password: REDACTED } });
    expect(body.nested.password).toBe('x');
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets('text')).toBe('text');
  });

  test('stops at a depth limit and caps long arrays', () => {
    let deep = { password: 'bottom' };
    for (let i = 0; i < REDACT_MAX_DEPTH + 2; i++) deep = { level: deep };
    expect(JSON.stringify(redactSecrets(deep))).not.toContain('bottom');
    expect(JSON.stringify(redactSecrets(deep))).toContain('[Truncated]');

    const long = Array.from({ length: REDACT_MAX_ITEMS + 5 }, (_, i) => ({ i, token: `t${i}` }));
    const out = redactSecrets({ long }).long;
    expect(out).toHaveLength(REDACT_MAX_ITEMS + 1);
    expect(out[0]).toEqual({ i: 0, token: REDACTED });
    expect(out[REDACT_MAX_ITEMS]).toBe('[+5 more]');
  });

  test('a self-referencing object does not loop forever', () => {
    const body = { name: 'loop' };
    body.self = body;
    expect(() => redactSecrets(body)).not.toThrow();
  });
});

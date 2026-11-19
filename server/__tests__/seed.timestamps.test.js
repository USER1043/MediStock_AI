/**
 * Seeded activity is never later than the moment the seed runs. Seeded audit entries, bills and
 * sales history used to get random times up to 21:59 "today", so they sorted above real activity in
 * the Activity Log for the rest of the day.
 */
import { jest } from '@jest/globals';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.unstable_mockModule('../utils/logger.js', () => ({ default: jest.fn() }));

const { createSeedClock } = await import('../seedFiles/seedClock.js');
const { User } = await import('../models/userModel.js');
const { AuditLog } = await import('../models/auditLogModel.js');
const { Bill } = await import('../models/billModel.js');
const { InventoryHistory } = await import('../models/inventoryHistoryModel.js');

const run = promisify(execFile);
const serverDir = fileURLToPath(new URL('..', import.meta.url));

const sameDay = (a, b) => a.toDateString() === b.toDateString();

describe('createSeedClock', () => {
  // 08:30 local time: every random seed hour (08–21) is later than this on the same day
  const morning = new Date();
  morning.setHours(8, 30, 0, 0);
  const { daysAgoDate, daysFutureDate } = createSeedClock(morning);

  test('times today never fall after now, and stay on the same day', () => {
    for (let i = 0; i < 500; i++) {
      const d = i % 2 ? daysAgoDate(0) : daysAgoDate(0, 21);
      expect(d.getTime()).toBeLessThanOrEqual(morning.getTime());
      expect(sameDay(d, morning)).toBe(true);
    }
  });

  test('earlier days keep the requested hour', () => {
    const d = daysAgoDate(3, 21);
    const threeDaysAgo = new Date(morning);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(d.getHours()).toBe(21);
    expect(sameDay(d, threeDaysAgo)).toBe(true);
  });

  test('future dates are still in the future', () => {
    expect(daysFutureDate(5).getTime()).toBeGreaterThan(morning.getTime());
  });
});

describe('seed scripts against a real database', () => {
  let server;
  let uri;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    uri = server.getUri('seedtest');
    await mongoose.connect(uri);
    await User.create({ username: 'owner', email: 'owner@test.local', password: 'Owner#2024', role: 'owner' });
    await User.create({ username: 'staff', email: 'staff@test.local', password: 'Staff#2024', role: 'staff' });
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  const seed = (script) =>
    run(process.execPath, [`seedFiles/${script}`], {
      cwd: serverDir,
      env: { ...process.env, MONGODB_URI: uri },
      timeout: 120000,
    });

  const latest = async (Model, field) => {
    const [doc] = await Model.find().sort({ [field]: -1 }).limit(1).lean();
    return doc[field];
  };

  test.each(['seedAll.js', 'seedTemporal.js'])(
    '%s writes no audit entry, bill or sales record after the moment it ran',
    async (script) => {
      const before = new Date();
      await seed(script);

      expect(await AuditLog.countDocuments()).toBeGreaterThan(30);
      expect(await Bill.countDocuments()).toBeGreaterThan(30);
      const after = new Date(); // the seed's "now" was taken between `before` and this
      const notInFuture = {};
      for (const [Model, field] of [[AuditLog, 'timestamp'], [Bill, 'createdAt'], [InventoryHistory, 'createdAt']]) {
        notInFuture[Model.modelName] = (await latest(Model, field)).getTime() <= after.getTime();
      }
      expect(notInFuture).toEqual({ AuditLog: true, Bill: true, InventoryHistory: true });
      // And today's activity is still there, earlier in the day
      const todays = await AuditLog.countDocuments({ timestamp: { $gte: new Date(new Date(before).setHours(0, 0, 0, 0)) } });
      expect(todays).toBeGreaterThan(0);
    },
    180000
  );
});

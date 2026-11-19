/**
 * @file Tests for batch-level expiry detection and expiry alert generation.
 */
import { jest } from '@jest/globals';

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

// In-memory stand-ins for the Alert and Medicine models
let medicines = [];
let createdAlerts = [];
let existingAlerts = [];

jest.unstable_mockModule('../models/alertModel.js', () => ({
  Alert: {
    deleteMany: jest.fn(async () => ({})),
    // Matches every field in the query, like MongoDB would (including isResolved)
    findOne: jest.fn(async (query) =>
      existingAlerts.find((a) => Object.entries(query).every(([k, v]) => a[k] === v)) || null
    ),
    create: jest.fn(async (doc) => {
      createdAlerts.push(doc);
      return doc;
    }),
  },
}));

jest.unstable_mockModule('../models/medicineModel.js', () => ({
  Medicine: { find: jest.fn(async () => medicines) },
}));

jest.unstable_mockModule('../utils/logger.js', () => ({ default: () => {} }));

const { getExpiringBatches, describeBatches } = await import('../utils/helpers.js');
const { generateAlerts } = await import('../controllers/alertController.js');

const runGenerateAlerts = async () => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  await generateAlerts({}, res);
  return res;
};

const medicine = (overrides) => ({
  _id: 'med-1',
  name: 'Paracetamol 500mg',
  quantity: 100,
  reorderLevel: 50,
  batches: [],
  ...overrides,
});

describe('getExpiringBatches', () => {
  it('flags in-stock batches expiring within the window as near expiry', () => {
    const batches = [
      { batchNumber: 'B1', expiryDate: daysFromNow(3), quantity: 10 },
      { batchNumber: 'B2', expiryDate: daysFromNow(30), quantity: 10 },
    ];
    const { nearExpiry, expired } = getExpiringBatches(batches, 7);
    expect(nearExpiry.map((b) => b.batchNumber)).toEqual(['B1']);
    expect(expired).toEqual([]);
  });

  it('flags in-stock batches past their expiry date as expired', () => {
    const batches = [{ batchNumber: 'B1', expiryDate: daysFromNow(-2), quantity: 5 }];
    const { nearExpiry, expired } = getExpiringBatches(batches, 7);
    expect(expired.map((b) => b.batchNumber)).toEqual(['B1']);
    expect(nearExpiry).toEqual([]);
  });

  it('ignores batches with no stock left', () => {
    const batches = [
      { batchNumber: 'B1', expiryDate: daysFromNow(-2), quantity: 0 },
      { batchNumber: 'B2', expiryDate: daysFromNow(2), quantity: 0 },
    ];
    expect(getExpiringBatches(batches, 7)).toEqual({ nearExpiry: [], expired: [] });
  });

  it('handles a medicine with no batches', () => {
    expect(getExpiringBatches(undefined, 7)).toEqual({ nearExpiry: [], expired: [] });
    expect(getExpiringBatches(null, 7)).toEqual({ nearExpiry: [], expired: [] });
    expect(getExpiringBatches([], 7)).toEqual({ nearExpiry: [], expired: [] });
  });

  it('describes batches with number, rack and quantity', () => {
    const text = describeBatches([{ batchNumber: 'B9', expiryDate: daysFromNow(1), rackNumber: 'A3', quantity: 12 }]);
    expect(text).toContain('B9');
    expect(text).toContain('rack A3');
    expect(text).toContain('qty 12');
  });
});

describe('generateAlerts expiry alerts', () => {
  beforeEach(() => {
    medicines = [];
    createdAlerts = [];
    existingAlerts = [];
  });

  it('creates a near_expiry alert naming the batch that expires soon', async () => {
    medicines = [
      medicine({
        batches: [
          { batchNumber: 'SOON-1', expiryDate: daysFromNow(4), quantity: 20, rackNumber: 'R1' },
          { batchNumber: 'LATER-1', expiryDate: daysFromNow(200), quantity: 80, rackNumber: 'R2' },
        ],
      }),
    ];

    const res = await runGenerateAlerts();

    expect(res.status).toHaveBeenCalledWith(200);
    const nearExpiry = createdAlerts.filter((a) => a.alertType === 'near_expiry');
    expect(nearExpiry).toHaveLength(1);
    expect(nearExpiry[0].severity).toBe('warning');
    expect(nearExpiry[0].message).toContain('SOON-1');
    expect(nearExpiry[0].message).not.toContain('LATER-1');
    expect(createdAlerts.some((a) => a.alertType === 'expired')).toBe(false);
  });

  it('creates a critical expired alert for expired batches still in stock', async () => {
    medicines = [
      medicine({
        batches: [{ batchNumber: 'OLD-1', expiryDate: daysFromNow(-10), quantity: 15, rackNumber: 'R4' }],
      }),
    ];

    await runGenerateAlerts();

    const expired = createdAlerts.filter((a) => a.alertType === 'expired');
    expect(expired).toHaveLength(1);
    expect(expired[0].severity).toBe('critical');
    expect(expired[0].message).toContain('OLD-1');
  });

  it('does not alert on expired batches that have been fully used up', async () => {
    medicines = [
      medicine({
        batches: [
          { batchNumber: 'GONE-1', expiryDate: daysFromNow(-10), quantity: 0, rackNumber: 'R4' },
          { batchNumber: 'OK-1', expiryDate: daysFromNow(100), quantity: 100, rackNumber: 'R5' },
        ],
      }),
    ];

    await runGenerateAlerts();

    expect(createdAlerts.some((a) => a.alertType === 'expired' || a.alertType === 'near_expiry')).toBe(false);
  });

  it('does not duplicate an unresolved expiry alert', async () => {
    medicines = [
      medicine({
        batches: [{ batchNumber: 'SOON-1', expiryDate: daysFromNow(2), quantity: 20, rackNumber: 'R1' }],
      }),
    ];
    existingAlerts = [{ medicineId: 'med-1', alertType: 'near_expiry', isResolved: false }];

    await runGenerateAlerts();

    expect(createdAlerts.some((a) => a.alertType === 'near_expiry')).toBe(false);
  });

  it('creates a new expiry alert when the earlier one was resolved', async () => {
    medicines = [
      medicine({
        batches: [{ batchNumber: 'SOON-1', expiryDate: daysFromNow(2), quantity: 20, rackNumber: 'R1' }],
      }),
    ];
    existingAlerts = [{ medicineId: 'med-1', alertType: 'near_expiry', isResolved: true }];

    await runGenerateAlerts();

    expect(createdAlerts.filter((a) => a.alertType === 'near_expiry')).toHaveLength(1);
  });
});

// Pins the day-counting rule. Expiry dates from the inventory form are stored as UTC midnight of that day,
// and days left = ceil((expiry - now) / 1 day), so a batch counts as expired from 00:00 UTC on its expiry date.
describe('expiry day boundaries', () => {
  const NOW = new Date('2026-11-19T10:00:00Z');
  const onDay = (isoDate) => [{ batchNumber: isoDate, expiryDate: new Date(`${isoDate}T00:00:00Z`), quantity: 5 }];

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
  });
  afterEach(() => jest.useRealTimers());

  it.each([
    ['2026-11-18', 'expired'], // yesterday
    ['2026-11-19', 'expired'], // today: already past 00:00 UTC
    ['2026-11-20', 'nearExpiry'], // tomorrow: 1 day left
    ['2026-11-26', 'nearExpiry'], // 7 days left: still inside the 7-day window
    ['2026-11-27', 'none'], // 8 days left
  ])('a batch expiring on %s is %s', (isoDate, expected) => {
    const { nearExpiry, expired } = getExpiringBatches(onDay(isoDate), 7);
    const actual = expired.length ? 'expired' : nearExpiry.length ? 'nearExpiry' : 'none';
    expect(actual).toBe(expected);
  });
});

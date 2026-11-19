/**
 * @file Tests for batch-level expiry detection and expiry alert generation.
 */
import { jest } from '@jest/globals';

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

// The alert service imports the models; nothing here touches the database
jest.unstable_mockModule('../models/alertModel.js', () => ({ Alert: {} }));
jest.unstable_mockModule('../models/medicineModel.js', () => ({ Medicine: {} }));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: () => {} }));

const { getExpiringBatches, describeBatches } = await import('../utils/helpers.js');
const { evaluateMedicine, acknowledgementCovers } = await import('../services/alertService.js');

const conditionsOf = (med, alertType) => evaluateMedicine(med).filter((c) => c.alertType === alertType);

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

// Which conditions hold for a medicine. Creating, updating and acknowledging the Alert documents
// is covered against a real database in alerts.integration.test.js and alerts.lifecycle.test.js.
describe('evaluateMedicine expiry conditions', () => {
  it('raises near_expiry naming only the batch that expires soon', () => {
    const med = medicine({
      batches: [
        { batchNumber: 'SOON-1', expiryDate: daysFromNow(4), quantity: 20, rackNumber: 'R1' },
        { batchNumber: 'LATER-1', expiryDate: daysFromNow(200), quantity: 80, rackNumber: 'R2' },
      ],
    });

    const nearExpiry = conditionsOf(med, 'near_expiry');
    expect(nearExpiry).toHaveLength(1);
    expect(nearExpiry[0].severity).toBe('warning');
    expect(nearExpiry[0].message).toContain('SOON-1');
    expect(nearExpiry[0].message).not.toContain('LATER-1');
    expect(nearExpiry[0].batches).toEqual([
      expect.objectContaining({ batchNumber: 'SOON-1', rackNumber: 'R1', quantity: 20 }),
    ]);
    expect(conditionsOf(med, 'expired')).toEqual([]);
  });

  it('raises a critical expired condition for expired batches still in stock', () => {
    const med = medicine({
      batches: [{ batchNumber: 'OLD-1', expiryDate: daysFromNow(-10), quantity: 15, rackNumber: 'R4' }],
    });

    const expired = conditionsOf(med, 'expired');
    expect(expired).toHaveLength(1);
    expect(expired[0].severity).toBe('critical');
    expect(expired[0].message).toContain('OLD-1');
  });

  it('ignores expired batches that have been fully used up', () => {
    const med = medicine({
      batches: [
        { batchNumber: 'GONE-1', expiryDate: daysFromNow(-10), quantity: 0, rackNumber: 'R4' },
        { batchNumber: 'OK-1', expiryDate: daysFromNow(100), quantity: 100, rackNumber: 'R5' },
      ],
    });

    expect(conditionsOf(med, 'expired')).toEqual([]);
    expect(conditionsOf(med, 'near_expiry')).toEqual([]);
  });

  it('fingerprints expiry conditions by batch number and expiry day, not quantity', () => {
    const at = (qty) =>
      conditionsOf(
        medicine({
          batches: [
            { batchNumber: 'B2', expiryDate: daysFromNow(3), quantity: qty, rackNumber: 'R1' },
            { batchNumber: 'B1', expiryDate: daysFromNow(5), quantity: 4, rackNumber: 'R1' },
          ],
        }),
        'near_expiry'
      )[0].fingerprint;

    expect(at(10)).toEqual(at(3));
    expect(at(10)).toHaveLength(2);
    expect(at(10)[0]).toMatch(/^B1@\d{4}-\d{2}-\d{2}$/);
  });
});

describe('evaluateMedicine stock conditions', () => {
  it('tells "low" from "out of stock" in the low_stock fingerprint', () => {
    expect(conditionsOf(medicine({ quantity: 20, reorderLevel: 50 }), 'low_stock')[0].fingerprint).toEqual(['low']);
    expect(conditionsOf(medicine({ quantity: 0, reorderLevel: 50 }), 'low_stock')[0].fingerprint).toEqual(['out_of_stock']);
    expect(conditionsOf(medicine({ quantity: 26, reorderLevel: 50 }), 'low_stock')).toEqual([]);
  });

  it('raises overstock above three times the reorder level', () => {
    expect(conditionsOf(medicine({ quantity: 151, reorderLevel: 50 }), 'overstock')[0].fingerprint).toEqual(['overstock']);
    expect(conditionsOf(medicine({ quantity: 150, reorderLevel: 50 }), 'overstock')).toEqual([]);
  });
});

describe('acknowledgementCovers', () => {
  it.each([
    ['near_expiry', ['A@2026-11-20'], ['A@2026-11-20'], true],
    ['near_expiry', ['A@2026-11-20', 'B@2026-11-22'], ['A@2026-11-20'], true], // a batch sold out: nothing new
    ['near_expiry', ['A@2026-11-20'], ['A@2026-11-20', 'B@2026-11-22'], false], // a second batch started expiring
    ['expired', ['A@2026-11-20'], ['B@2026-11-20'], false],
    ['low_stock', ['low'], ['low'], true],
    ['low_stock', ['low'], ['out_of_stock'], false], // got worse
    ['low_stock', ['out_of_stock'], ['low'], true], // partly restocked, still low
    ['overstock', ['overstock'], ['overstock'], true],
  ])('%s acknowledged %j, now %j -> covered: %s', (type, acknowledged, current, expected) => {
    expect(acknowledgementCovers(type, acknowledged, current)).toBe(expected);
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

describe('getExpiringBatches with an explicit clock', () => {
  it('uses the given time instead of the system clock', () => {
    const batches = [{ batchNumber: 'B1', expiryDate: new Date('2026-11-25T00:00:00Z'), quantity: 5 }];
    expect(getExpiringBatches(batches, 7, new Date('2026-11-01T10:00:00Z')).nearExpiry).toHaveLength(0); // 24 days left
    expect(getExpiringBatches(batches, 7, new Date('2026-11-20T10:00:00Z')).nearExpiry).toHaveLength(1);
    expect(getExpiringBatches(batches, 7, new Date('2026-11-26T10:00:00Z')).expired).toHaveLength(1);
  });
});

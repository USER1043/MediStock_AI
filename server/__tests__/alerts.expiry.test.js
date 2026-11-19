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
describe('evaluateMedicine expiry conditions (one per batch)', () => {
  it('raises near_expiry for the batch that expires soon, identified by its _id', () => {
    const med = medicine({
      batches: [
        { _id: 'b-soon', batchNumber: 'SOON-1', expiryDate: new Date('2026-11-23T00:00:00Z'), quantity: 20, rackNumber: 'E3' },
        { _id: 'b-later', batchNumber: 'LATER-1', expiryDate: new Date('2027-06-01T00:00:00Z'), quantity: 80, rackNumber: 'R2' },
      ],
    });

    const nearExpiry = evaluateMedicine(med, new Date('2026-11-19T10:00:00Z')).filter((c) => c.alertType === 'near_expiry');
    expect(nearExpiry).toHaveLength(1);
    expect(nearExpiry[0]).toMatchObject({
      severity: 'warning',
      batchId: 'b-soon',
      batch: { batchNumber: 'SOON-1', rackNumber: 'E3', quantity: 20 },
      fingerprint: ['2026-11-23'],
      message: 'Batch SOON-1 expires on 23 Nov 2026 (rack E3, qty 20)',
    });
  });

  it('raises a critical expired condition per expired batch still in stock', () => {
    const med = medicine({
      batches: [
        { _id: 'b-old', batchNumber: 'PAR-001', expiryDate: new Date('2026-11-04T00:00:00Z'), quantity: 200, rackNumber: 'A2' },
        { _id: 'b-older', batchNumber: 'PAR-000', expiryDate: new Date('2026-10-01T00:00:00Z'), quantity: 3, rackNumber: 'A1' },
      ],
    });

    const expired = evaluateMedicine(med, new Date('2026-11-19T10:00:00Z')).filter((c) => c.alertType === 'expired');
    expect(expired.map((c) => c.batchId).sort()).toEqual(['b-old', 'b-older']);
    expect(expired.every((c) => c.severity === 'critical')).toBe(true);
    expect(expired.find((c) => c.batchId === 'b-old').message).toBe(
      'Batch PAR-001 expired on 04 Nov 2026 and is still in stock (rack A2, qty 200)'
    );
  });

  it('gives two expiring batches two conditions', () => {
    const med = medicine({
      batches: [
        { _id: 'b1', batchNumber: 'B1', expiryDate: daysFromNow(2), quantity: 5, rackNumber: 'R1' },
        { _id: 'b2', batchNumber: 'B2', expiryDate: daysFromNow(5), quantity: 6, rackNumber: 'R2' },
      ],
    });

    expect(conditionsOf(med, 'near_expiry').map((c) => c.batchId)).toEqual(['b1', 'b2']);
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

  it('fingerprints a batch condition by its expiry day, not its quantity or rack', () => {
    const at = (quantity, rackNumber) =>
      evaluateMedicine(
        medicine({ batches: [{ _id: 'b1', batchNumber: 'B1', expiryDate: new Date('2026-11-23T00:00:00Z'), quantity, rackNumber }] }),
        new Date('2026-11-19T10:00:00Z')
      )[0];

    expect(at(10, 'R1').fingerprint).toEqual(['2026-11-23']);
    expect(at(10, 'R1').fingerprint).toEqual(at(3, 'R9').fingerprint);
    expect(at(10, 'R1').message).not.toBe(at(3, 'R9').message);
  });

  it('stock alerts carry no batch', () => {
    const [low] = conditionsOf(medicine({ quantity: 0, reorderLevel: 50 }), 'low_stock');
    expect(low).toMatchObject({ batchId: null, batch: null });
  });
});

describe('evaluateMedicine stock conditions', () => {
  it('puts the stock level (out / critical / low) in the low_stock fingerprint', () => {
    expect(conditionsOf(medicine({ quantity: 26, reorderLevel: 50 }), 'low_stock')[0].fingerprint).toEqual(['low']);
    expect(conditionsOf(medicine({ quantity: 20, reorderLevel: 50 }), 'low_stock')[0].fingerprint).toEqual(['critical']);
    expect(conditionsOf(medicine({ quantity: 0, reorderLevel: 50 }), 'low_stock')[0].fingerprint).toEqual(['out']);
    expect(conditionsOf(medicine({ quantity: 51, reorderLevel: 50 }), 'low_stock')).toEqual([]);
  });

  it('raises overstock above three times the reorder level', () => {
    expect(conditionsOf(medicine({ quantity: 151, reorderLevel: 50 }), 'overstock')[0].fingerprint).toEqual(['overstock']);
    expect(conditionsOf(medicine({ quantity: 150, reorderLevel: 50 }), 'overstock')).toEqual([]);
  });
});

describe('acknowledgementCovers', () => {
  it.each([
    // a batch alert stays acknowledged while its condition and expiry day hold; clearing closes it instead
    ['near_expiry', ['2026-11-20'], ['2026-11-20'], true],
    ['near_expiry', ['2026-11-20'], ['2026-11-22'], false], // expiry edited, still near expiry: new situation
    ['expired', ['2026-11-04'], ['2026-11-01'], false], // expiry corrected to another past date
    ['expired', ['2026-11-04'], ['2026-11-04'], true],
    ['low_stock', ['low'], ['low'], true],
    ['low_stock', ['low'], ['critical'], false], // got worse
    ['low_stock', ['low'], ['out'], false], // got worse
    ['low_stock', ['critical'], ['out'], false], // got worse
    ['low_stock', ['critical'], ['critical'], true],
    ['low_stock', ['critical'], ['low'], true], // partly restocked, still low
    ['low_stock', ['out'], ['critical'], true], // partly restocked, still critical
    ['low_stock', ['out'], ['low'], true],
    ['low_stock', ['out_of_stock'], ['low'], false], // unknown (pre-change) fingerprint: re-raise
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

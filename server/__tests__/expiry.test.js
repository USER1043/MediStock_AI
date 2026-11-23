/**
 * Expiry is counted from 00:00 IST (18:30 UTC the day before) on the expiry day, the same on the
 * server (utils/expiry.js) and in the frontend (src/utils/expiry.js, an identical copy).
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const { daysUntilExpiry, isExpired, isNearExpiry } = await import('../utils/expiry.js');
const helpers = await import('../utils/helpers.js');
const frontend = await import('../../src/utils/expiry.js');

// Expiry day 25 Nov 2026, stored the way the UI and Excel import store it: 00:00 UTC of that day
const EXPIRY = new Date('2026-11-25T00:00:00Z');
const at = (iso) => new Date(iso);

describe('the expiry day starts at 00:00 IST', () => {
  test.each([
    // [now (UTC), IST wall clock, days left, expired]
    ['2026-11-23T18:30:00Z', '24 Nov 00:00', 1, false],
    ['2026-11-24T12:00:00Z', '24 Nov 17:30', 1, false],
    ['2026-11-24T18:29:59Z', '24 Nov 23:59:59', 1, false],
    ['2026-11-24T18:30:00Z', '25 Nov 00:00', 0, true],
    ['2026-11-24T23:59:59Z', '25 Nov 05:29:59', 0, true], // was "not expired" when counted from 00:00 UTC
    ['2026-11-25T06:00:00Z', '25 Nov 11:30', 0, true],
    ['2026-11-25T18:30:00Z', '26 Nov 00:00', -1, true],
  ])('at %s (IST %s): %i day(s) left, expired %s', (now, _ist, days, expired) => {
    expect(daysUntilExpiry(EXPIRY, at(now))).toBe(days);
    expect(isExpired(EXPIRY, at(now))).toBe(expired);
    // The helpers callers use are the same functions
    expect(helpers.getDaysUntilExpiry(EXPIRY, at(now))).toBe(days);
    expect(helpers.isExpired(EXPIRY, at(now))).toBe(expired);
  });

  test('the time stored with an expiry date does not matter, only its (UTC) calendar day', () => {
    const now = at('2026-11-24T18:30:00Z'); // 25 Nov 00:00 IST
    for (const stored of ['2026-11-25T00:00:00Z', '2026-11-25T06:30:00Z', '2026-11-25T23:59:59Z']) {
      expect(daysUntilExpiry(stored, now)).toBe(0);
    }
    expect(daysUntilExpiry('2026-11-25', now)).toBe(0); // a bare date string parses as 00:00 UTC
  });

  test('near expiry: not expired and within the window', () => {
    const now = at('2026-11-24T18:30:00Z'); // 25 Nov IST
    expect(isNearExpiry('2026-11-25', 7, now)).toBe(false); // expired today
    expect(isNearExpiry('2026-11-26', 7, now)).toBe(true);
    expect(isNearExpiry('2026-12-02', 7, now)).toBe(true); // 7 days
    expect(isNearExpiry('2026-12-03', 7, now)).toBe(false); // 8 days
  });

  test('an invalid date is neither expired nor near expiry', () => {
    expect(Number.isNaN(daysUntilExpiry('not a date', at('2026-11-24T00:00:00Z')))).toBe(true);
    expect(isExpired('not a date')).toBe(false);
    expect(isNearExpiry('not a date')).toBe(false);
  });
});

describe('callers', () => {
  const batches = [
    { batchNumber: 'TODAY', expiryDate: new Date('2026-11-25T00:00:00Z'), quantity: 5 },
    { batchNumber: 'TOMORROW', expiryDate: new Date('2026-11-26T00:00:00Z'), quantity: 5 },
    { batchNumber: 'EMPTY', expiryDate: new Date('2026-11-25T00:00:00Z'), quantity: 0 },
  ];

  test('getExpiringBatches (alerts, reports) at 02:00 IST on the expiry day', () => {
    const { nearExpiry, expired } = helpers.getExpiringBatches(batches, 7, at('2026-11-24T20:30:00Z'));
    expect(expired.map((b) => b.batchNumber)).toEqual(['TODAY']);
    expect(nearExpiry.map((b) => b.batchNumber)).toEqual(['TOMORROW']);
  });

  test('Excel import flags a batch that expires today (IST) as already expired', () => {
    jest.useFakeTimers({ now: at('2026-11-24T20:30:00Z') }); // 25 Nov 02:00 IST
    try {
      const anomalies = helpers.detectAnomalies([
        { expiryDate: '2026-11-25', quantity: 1, purchasePrice: 1, sellingPrice: 2 },
        { expiryDate: '2026-11-26', quantity: 1, purchasePrice: 1, sellingPrice: 2 },
      ]);
      expect(anomalies.filter((a) => a.field === 'expiryDate').map((a) => a.row)).toEqual([2]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('frontend mirror (src/utils/expiry.js)', () => {
  test('is an identical copy of the server file', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(read('../../src/utils/expiry.js')).toBe(read('../utils/expiry.js'));
  });

  test('agrees with the server around the boundary', () => {
    for (const now of ['2026-11-24T18:29:59Z', '2026-11-24T18:30:00Z', '2026-11-25T20:00:00Z']) {
      expect(frontend.daysUntilExpiry(EXPIRY, at(now))).toBe(daysUntilExpiry(EXPIRY, at(now)));
    }
  });
});

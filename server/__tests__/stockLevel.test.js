/**
 * The shared stock-level definition (utils/stockLevel.js) and its frontend mirror.
 * out: q <= 0 · critical: 0 < q <= r/2 · low: r/2 < q <= r · ok: q > r
 */
import {
  getStockLevel,
  isLowStock,
  countStockLevels,
  sortByUrgency,
  STOCK_LEVELS,
} from '../utils/stockLevel.js';
import { getStockStatus } from '../utils/helpers.js';
import * as frontend from '../../src/utils/stockLevel.js';

describe('getStockLevel boundaries', () => {
  it.each([
    // reorder level 50 (half = 25)
    [-5, 50, 'out'],
    [0, 50, 'out'],
    [1, 50, 'critical'],
    [24, 50, 'critical'],
    [25, 50, 'critical'], // exactly half
    [25.5, 50, 'low'],
    [26, 50, 'low'],
    [49, 50, 'low'],
    [50, 50, 'low'], // exactly the reorder level
    [51, 50, 'ok'],
    // odd reorder level 7 (half = 3.5)
    [3, 7, 'critical'],
    [3.5, 7, 'critical'],
    [4, 7, 'low'],
    [7, 7, 'low'],
    [8, 7, 'ok'],
    // reorder level 1 (half = 0.5)
    [1, 1, 'low'],
    [2, 1, 'ok'],
  ])('quantity %p, reorder level %p -> %s', (quantity, reorderLevel, level) => {
    expect(getStockLevel(quantity, reorderLevel)).toBe(level);
  });

  it.each([0, undefined, null, -10, NaN, 'abc'])('reorder level %p: only quantity <= 0 is flagged', (reorderLevel) => {
    expect(getStockLevel(0, reorderLevel)).toBe('out');
    expect(getStockLevel(-1, reorderLevel)).toBe('out');
    expect(getStockLevel(1, reorderLevel)).toBe('ok');
    expect(isLowStock(1, reorderLevel)).toBe(false);
  });

  it.each([NaN, undefined, null, 'abc'])('a missing or non-numeric quantity (%p) counts as out of stock', (quantity) => {
    expect(getStockLevel(quantity, 50)).toBe('out');
  });

  it('accepts numeric strings', () => {
    expect(getStockLevel('20', '50')).toBe('critical');
  });

  it('isLowStock is quantity <= reorder level', () => {
    expect([0, 25, 50, 51].map((q) => isLowStock(q, 50))).toEqual([true, true, true, false]);
  });

  it('helpers.getStockStatus (stored stockStatus) is the same function and stays in the model enum', () => {
    expect(getStockStatus(25, 50)).toBe('critical');
    for (const q of [-1, 0, 1, 25, 26, 50, 51]) expect(STOCK_LEVELS).toContain(getStockStatus(q, 50));
  });
});

describe('countStockLevels / sortByUrgency', () => {
  const meds = [
    { name: 'ok', quantity: 60, reorderLevel: 50 },
    { name: 'low', quantity: 40, reorderLevel: 50 },
    { name: 'critical', quantity: 10, reorderLevel: 50 },
    { name: 'out', quantity: 0, reorderLevel: 50 },
    { name: 'no reorder level, in stock', quantity: 5 },
    { name: 'no reorder level, empty', quantity: 0, reorderLevel: 0 },
  ];

  it('counts each level, lowStock = out + critical + low', () => {
    expect(countStockLevels(meds)).toEqual({ out: 2, critical: 1, low: 1, ok: 2, lowStock: 4 });
  });

  it('sorts most urgent first', () => {
    expect(sortByUrgency(meds).map((m) => m.name).slice(0, 4)).toEqual([
      'no reorder level, empty',
      'out',
      'critical',
      'low',
    ]);
  });
});

describe('frontend mirror (src/utils/stockLevel.js)', () => {
  it('agrees with the server on a grid of quantities and reorder levels', () => {
    const quantities = [-1, 0, 0.5, 1, 2, 3, 3.5, 4, 5, 6, 7, 8, 10, 24, 25, 26, 49, 50, 51, NaN, undefined, null];
    const reorderLevels = [0, 1, 7, 10, 50, -5, undefined, null, NaN];
    for (const q of quantities) {
      for (const r of reorderLevels) {
        expect([q, r, frontend.getStockLevel(q, r)]).toEqual([q, r, getStockLevel(q, r)]);
        expect(frontend.isLowStock(q, r)).toBe(isLowStock(q, r));
      }
    }
  });

  it('has display metadata for every level', () => {
    for (const level of STOCK_LEVELS) expect(frontend.STOCK_LEVEL_META[level]).toBeDefined();
  });
});

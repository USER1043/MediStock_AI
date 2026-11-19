/**
 * Unit tests for the shared password policy (utils/passwordPolicy.js), plus a check
 * that the web app's copy (src/utils/passwordPolicy.js) is identical.
 */

import { readFileSync } from 'node:fs';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  getPasswordPolicyFailures,
  describePasswordPolicyFailures,
} from '../utils/passwordPolicy.js';

const failures = getPasswordPolicyFailures;

describe('password policy', () => {
  test('rules are minLength, lowercase, uppercase, number, symbol (in that order), min length 8', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_RULES.map((rule) => rule.id)).toEqual(['minLength', 'lowercase', 'uppercase', 'number', 'symbol']);
  });

  test('a password meeting every rule passes', () => {
    expect(failures('Owner#2024')).toEqual([]);
    expect(failures('Aa1!aaaa')).toEqual([]); // exactly 8
    expect(describePasswordPolicyFailures(failures('Owner#2024'))).toBe('');
  });

  test.each([
    ['minLength', 'Aa1!aaa'], // 7 characters
    ['lowercase', 'AAAA111!'],
    ['uppercase', 'aaaa111!'],
    ['number', 'Aaaaaaa!'],
    ['symbol', 'Aaaaaaa1'],
  ])('only %s fails for %j', (rule, password) => {
    expect(failures(password)).toEqual([rule]);
  });

  test('multiple failures are all reported, in rule order, and named in one sentence', () => {
    expect(failures('owner123')).toEqual(['uppercase', 'symbol']);
    expect(failures('abc')).toEqual(['minLength', 'uppercase', 'number', 'symbol']);
    expect(failures('')).toEqual(['minLength', 'lowercase', 'uppercase', 'number', 'symbol']);

    expect(describePasswordPolicyFailures(['minLength', 'uppercase', 'symbol'])).toBe(
      'Password must be at least 8 characters and include an uppercase letter and a symbol.'
    );
    expect(describePasswordPolicyFailures(['uppercase', 'symbol'])).toBe(
      'Password must include an uppercase letter and a symbol.'
    );
    expect(describePasswordPolicyFailures(['minLength'])).toBe('Password must be at least 8 characters.');
    expect(describePasswordPolicyFailures(['lowercase', 'uppercase', 'number', 'symbol'])).toBe(
      'Password must include a lowercase letter, an uppercase letter, a number and a symbol.'
    );
  });

  test('a non-string fails every rule', () => {
    const all = PASSWORD_RULES.map((rule) => rule.id);
    expect(failures(undefined)).toEqual(all);
    expect(failures(null)).toEqual(all);
    expect(failures(12345678)).toEqual(all);
    expect(failures({ length: 20 })).toEqual(all);
  });

  describe('symbols vs whitespace', () => {
    test.each(['!', '@', '#', '$', '%', '.', '-', '_', '~', '"', '€', '+', '😀', '½'])(
      '%j counts as a symbol',
      (symbol) => {
        expect(failures(`Aaaaaaa1${symbol}`)).toEqual([]);
      }
    );

    test.each([
      ['space', ' '],
      ['tab', '\t'],
      ['newline', '\n'],
      ['no-break space', ' '],
      ['ideographic space', '　'],
    ])('%s is allowed but is not a symbol', (name, whitespace) => {
      expect(failures(`Aaaa${whitespace}aaa1`)).toEqual(['symbol']);
      expect(failures(`Aaa${whitespace}aaa1!`)).toEqual([]);
    });

    test('invisible format characters and combining accents do not count as symbols', () => {
      expect(failures('Aaaaaaa1​')).toEqual(['symbol']); // zero-width space (Cf)
      expect(failures('Aaaaaaa1́')).toEqual(['symbol']); // combining acute accent (Mn)
    });
  });

  describe('unicode letters and digits', () => {
    test('non-ASCII cased letters count as lowercase / uppercase letters, not symbols', () => {
      expect(failures('Éclair1!')).toEqual([]);
      expect(failures('éclair1!x')).toEqual(['uppercase']);
      expect(failures('ÉCLAIR1!X')).toEqual(['lowercase']);
      expect(failures('Жжжжжжж1')).toEqual(['symbol']); // Cyrillic: upper + lower, no symbol
      expect(failures('Straße12')).toEqual(['symbol']); // ß is lowercase
    });

    test('letters without case are letters (not symbols) but satisfy neither case rule', () => {
      expect(failures('密码密码密码12')).toEqual(['lowercase', 'uppercase', 'symbol']);
      expect(failures('密码密码Aa1!')).toEqual([]);
    });

    test('non-ASCII decimal digits count as numbers', () => {
      expect(failures('Aaaaaaa٣!')).toEqual([]); // Arabic-Indic three
    });

    test('length counts code points, so an emoji is one character', () => {
      expect(failures('Aa1😀😀😀😀')).toEqual(['minLength']); // 7 code points, 11 UTF-16 units
      expect(failures('Aa1😀😀😀😀😀')).toEqual([]);
    });
  });

  test('the web app copy (src/utils/passwordPolicy.js) is identical to this one', () => {
    const server = readFileSync(new URL('../utils/passwordPolicy.js', import.meta.url), 'utf8');
    const web = readFileSync(new URL('../../src/utils/passwordPolicy.js', import.meta.url), 'utf8');
    expect(web).toBe(server);
  });
});

/**
 * @file Password policy shared by the API and the web app.
 *
 * KEEP IN SYNC: this file exists twice, byte for byte, at
 * `server/utils/passwordPolicy.js` and `src/utils/passwordPolicy.js` (the server
 * and the Vite app are separate packages, so neither can import the other).
 * `server/__tests__/passwordPolicy.test.js` fails if the two copies differ.
 * Edit one and copy it over the other.
 *
 * A password must contain:
 * - at least 8 characters, counted as Unicode code points (an emoji counts as 1);
 * - a lowercase letter: any Unicode lowercase letter (a-z, but also é, ß, ж ...);
 * - an uppercase letter: any Unicode uppercase letter (A-Z, but also É, Ж ...);
 * - a number: any Unicode decimal digit (0-9, but also ٣ ...);
 * - a symbol: any character that is not a letter, a digit or whitespace, such as
 *   ! @ # $ % . - _ ~, currency and math signs, or emoji. Combining accents count as
 *   part of their letter and invisible control/format characters are ignored, so
 *   neither can stand in for a symbol.
 * Letters without case (e.g. Chinese or Arabic script) are letters, so they are
 * not symbols, but they satisfy neither the lowercase nor the uppercase rule.
 * Whitespace is allowed anywhere but never counts as a symbol.
 *
 * Only new passwords are checked (creating a user, changing a password). Login
 * never checks the policy, so accounts with older passwords can still sign in.
 */

export const PASSWORD_MIN_LENGTH = 8;

const LOWERCASE = /\p{Ll}/u;
const UPPERCASE = /\p{Lu}/u;
const DIGIT = /\p{Nd}/u;
// Not a letter (L), combining mark (M), decimal digit (Nd), whitespace or control/format/unassigned (C)
const SYMBOL = /[^\p{L}\p{M}\p{Nd}\p{White_Space}\p{C}]/u;

/** The rules in display order. `label` is for checklists, `requirement` for error messages. */
export const PASSWORD_RULES = [
  {
    id: 'minLength',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    requirement: `be at least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => Array.from(password).length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'A lowercase letter',
    requirement: 'a lowercase letter',
    test: (password) => LOWERCASE.test(password),
  },
  {
    id: 'uppercase',
    label: 'An uppercase letter',
    requirement: 'an uppercase letter',
    test: (password) => UPPERCASE.test(password),
  },
  {
    id: 'number',
    label: 'A number',
    requirement: 'a number',
    test: (password) => DIGIT.test(password),
  },
  {
    id: 'symbol',
    label: 'A symbol (e.g. ! @ # $ %)',
    requirement: 'a symbol',
    test: (password) => SYMBOL.test(password),
  },
];

/**
 * Returns the ids of the rules the password does not meet, in display order.
 * An empty array means the password is acceptable. A non-string fails every rule.
 * @param {unknown} password
 * @returns {string[]}
 */
export function getPasswordPolicyFailures(password) {
  if (typeof password !== 'string') return PASSWORD_RULES.map((rule) => rule.id);
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.id);
}

const joinWithAnd = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * Builds a sentence naming what is missing, e.g.
 * "Password must be at least 8 characters and include an uppercase letter and a symbol."
 * Returns an empty string when nothing failed.
 * @param {string[]} failures rule ids from getPasswordPolicyFailures
 * @returns {string}
 */
export function describePasswordPolicyFailures(failures) {
  if (!failures || failures.length === 0) return '';
  const failed = PASSWORD_RULES.filter((rule) => failures.includes(rule.id));
  const parts = [];
  const length = failed.find((rule) => rule.id === 'minLength');
  if (length) parts.push(length.requirement);
  const missing = failed.filter((rule) => rule.id !== 'minLength').map((rule) => rule.requirement);
  if (missing.length > 0) parts.push(`include ${joinWithAnd(missing)}`);
  return `Password must ${parts.join(' and ')}.`;
}

/**
 * @file The one definition of expiry. Server checks (alerts, inventory filters, reports, chatbot,
 * Excel import) and the frontend (src/utils/expiry.js, an identical copy) all count days here.
 * @module utils/expiry
 *
 * An expiry date is a calendar day: the UTC date of the stored value (a date picked in the UI or read
 * from Excel is stored as 00:00 UTC of that day). "Today" is the shop's calendar day in India Standard
 * Time (UTC+05:30, no daylight saving). A batch expires at 00:00 IST on its expiry day:
 *
 * - daysUntilExpiry = expiry day - today (IST), in whole days
 * - expired      : daysUntilExpiry <= 0 (from 00:00 IST on the expiry day)
 * - near expiry  : 0 < daysUntilExpiry <= window
 */

/** The shop's offset from UTC, in minutes (IST = UTC+05:30). */
export const SHOP_UTC_OFFSET_MINUTES = 330;

const DAY_MS = 24 * 60 * 60 * 1000;

// Midnight UTC of the date's UTC calendar day, in ms (NaN for an invalid date)
const utcDayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Whole days from today (IST) to the expiry day; 0 on the expiry day, negative after it. NaN if invalid. */
export const daysUntilExpiry = (expiryDate, now = new Date()) => {
  const expiryDay = utcDayStart(new Date(expiryDate).getTime());
  const today = utcDayStart(new Date(now).getTime() + SHOP_UTC_OFFSET_MINUTES * 60 * 1000);
  return Math.round((expiryDay - today) / DAY_MS);
};

/** Expired from 00:00 IST on the expiry day. */
export const isExpired = (expiryDate, now = new Date()) => daysUntilExpiry(expiryDate, now) <= 0;

/** Not yet expired, and expiring within `days` days. */
export const isNearExpiry = (expiryDate, days = 7, now = new Date()) => {
  const left = daysUntilExpiry(expiryDate, now);
  return left > 0 && left <= days;
};

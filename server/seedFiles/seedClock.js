/**
 * @file Date helpers for the seed scripts, relative to one fixed "now" (the moment the seed runs).
 * @module seedFiles/seedClock
 */

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Date helpers anchored at `now`. Seeded activity (bills, sales history, audit entries) must never be
 * later than the moment the seed runs, or it sorts above real activity in the Activity Log.
 * @param {Date} [now]
 */
export const createSeedClock = (now = new Date()) => {
  const nowMs = now.getTime();

  // A time `daysAgo` days before now, at `hour` (or a random hour between 08 and 21) and a random
  // minute. A time that would fall after now (today, later in the day) is moved to a random moment
  // between midnight and now, so it stays on the same day.
  const daysAgoDate = (daysAgo, hour) => {
    const d = new Date(nowMs);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour ?? rand(8, 21), rand(0, 59), rand(0, 59), 0);
    if (d.getTime() <= nowMs) return d;

    const midnight = new Date(nowMs);
    midnight.setHours(0, 0, 0, 0);
    return new Date(midnight.getTime() + Math.floor(Math.random() * (nowMs - midnight.getTime() + 1)));
  };

  // Noon, `daysAhead` days from now (expiry and delivery dates may be in the future)
  const daysFutureDate = (daysAhead) => {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  return { now: new Date(nowMs), daysAgoDate, daysFutureDate };
};

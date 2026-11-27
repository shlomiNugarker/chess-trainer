// Checks when a mastered line comes back to be refreshed (src/mastery.ts).
// node --experimental-strip-types scripts/check-mastery.ts
import assert from 'node:assert/strict';
import { needsRefresh, REFRESH_DAYS } from '../src/mastery.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = 1_000 * DAY;
const rec = (streak: number | undefined, daysAgo: number, last = 0, clean = 1) => ({ tries: 3, clean, last, at: now - daysAgo * DAY, streak });

assert.equal(needsRefresh(undefined, now), false); // never tested
assert.equal(needsRefresh(rec(0, 100, 2), now), false); // the latest run had mistakes: still to learn, not to refresh
assert.equal(needsRefresh(rec(1, 2), now), false);
assert.equal(needsRefresh(rec(1, 3), now), true); // 1 clean run: 3 days
assert.equal(needsRefresh(rec(2, 6), now), false);
assert.equal(needsRefresh(rec(2, 7), now), true); // 2 in a row: 7 days
assert.equal(needsRefresh(rec(9, 59), now), false); // many: at most 60 days
assert.equal(needsRefresh(rec(9, 60), now), true);
assert.equal(needsRefresh(rec(undefined, 3), now), true); // a record from before streaks: counts as 1
assert.equal(REFRESH_DAYS[0], 3);
console.log('check-mastery: all good');

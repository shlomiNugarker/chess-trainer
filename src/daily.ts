// A small daily habit: a goal of a few puzzles a day, and a streak of days in a row the goal was met.

import { readStored } from './storage';
import { msg, tr } from './i18n';

export const DAILY_GOAL = 5;
const KEY = 'chess-trainer:daily';
const KEEP_DAYS = 400;

type Days = Record<string, number>; // local date "YYYY-MM-DD" -> puzzles played that day

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function load(): Days {
  return readStored<Days>('daily', {});
}

/** Counts one puzzle for today. Returns today's count after it. */
export function recordPuzzleDay(now = new Date()): number {
  const days = load();
  const k = dayKey(now);
  days[k] = (days[k] ?? 0) + 1;
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep.map((d) => [d, days[d]]))));
  } catch {
    /* storage unavailable — ignore */
  }
  return days[k];
}

/** Puzzles solved today. */
export function todayCount(now = new Date()): number {
  return load()[dayKey(now)] ?? 0;
}

/** On how many days puzzles were solved. */
export const daysPlayed = () => Object.keys(load()).length;

/** Days in a row the goal was met, up to today (today counts once met; until then the streak is still alive from yesterday). */
export function dayStreak(now = new Date()): number {
  const days = load();
  const d = new Date(now);
  if ((days[dayKey(d)] ?? 0) < DAILY_GOAL) d.setDate(d.getDate() - 1);
  let n = 0;
  while ((days[dayKey(d)] ?? 0) >= DAILY_GOAL) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** "1 day", "3 days". */
export const daysLabel = (n: number) => (n === 1 ? tr('1 day') : tr(msg`${n} days`));

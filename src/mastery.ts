// How well each repertoire line is known, from "test me" runs on the Learn page.
// A line counts as mastered when the latest run had no mistakes. A mastered line comes back to be refreshed after
// a few days, and then less and less often, as long as each refresh is clean (spaced repetition, like My mistakes).

import type { Repertoire } from './repertoire';

/**
 * last = mistakes in the latest run; streak = clean runs in a row (missing in records from before it existed:
 * then 1 if the latest run was clean).
 */
export type LineRecord = { tries: number; clean: number; last: number; at: number; streak?: number };

/** Days until a mastered line is tested again, by its clean runs in a row: 1 → 3 days, 2 → 7, … */
export const REFRESH_DAYS = [3, 7, 14, 30, 60];
const DAY = 24 * 60 * 60 * 1000;

const KEY = 'chess-trainer:mastery';

type Store = Record<string, Record<string, LineRecord>>; // repertoireId -> line id -> record

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function loadMastery(repertoireId: string): Record<string, LineRecord> {
  return read()[repertoireId] ?? {};
}

export function hasAnyMastery(): boolean {
  return Object.values(read()).some((lines) => Object.keys(lines).length > 0);
}

export function recordRun(repertoireId: string, lineId: string, mistakes: number) {
  const s = read();
  const lines = (s[repertoireId] ??= {});
  const r = lines[lineId] ?? { tries: 0, clean: 0, last: 0, at: 0 };
  const streak = mistakes ? 0 : streakOf(r) + 1;
  lines[lineId] = { tries: r.tries + 1, clean: r.clean + (mistakes ? 0 : 1), last: mistakes, at: Date.now(), streak };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Has the user passed a test of any line without a mistake? */
export const hasMastered = () => Object.values(read()).some((lines) => Object.values(lines).some((r) => r.clean > 0));

export const isMastered = (r?: LineRecord) => !!r && r.last === 0;

const streakOf = (r?: LineRecord) => (!r || r.tries === 0 ? 0 : (r.streak ?? (r.last === 0 && r.clean > 0 ? 1 : 0)));

/** A mastered line whose time to be tested again has come. */
export function needsRefresh(r: LineRecord | undefined, now = Date.now()): boolean {
  if (!isMastered(r) || !r!.clean) return false;
  const days = REFRESH_DAYS[Math.min(Math.max(streakOf(r), 1), REFRESH_DAYS.length) - 1];
  return now - r!.at >= days * DAY;
}

/** The lines to refresh in these repertoires: the given one first, then the others; in each, the oldest test first. */
export function linesToRefresh(reps: Repertoire[], first?: string, now = Date.now()): { repId: string; lineIdx: number }[] {
  const s = read();
  const order = [...reps].sort((a, b) => Number(b.id === first) - Number(a.id === first));
  return order.flatMap((rep) =>
    rep.lines
      .map((l, lineIdx) => ({ repId: rep.id, lineIdx, r: s[rep.id]?.[l.id] }))
      .filter((x) => needsRefresh(x.r, now))
      .sort((a, b) => a.r!.at - b.r!.at)
      .map(({ repId, lineIdx }) => ({ repId, lineIdx })),
  );
}

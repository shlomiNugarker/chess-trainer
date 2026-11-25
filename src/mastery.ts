// How well each repertoire line is known, from "test me" runs on the Learn page.
// A line counts as mastered when the latest run had no mistakes.

export type LineRecord = { tries: number; clean: number; last: number; at: number }; // last = mistakes in latest run

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
  lines[lineId] = { tries: r.tries + 1, clean: r.clean + (mistakes ? 0 : 1), last: mistakes, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — ignore */
  }
}

export const isMastered = (r?: LineRecord) => !!r && r.last === 0;

// Mistakes are saved locally and drilled later with spaced repetition (Leitner boxes).

import { useEffect, useState } from 'react';
import { HIDDEN_CHANGED, hiddenIds } from './hiddenReps';

export type Mistake = {
  fen: string; // position before the mistake (user to move)
  played: string; // SAN
  correct: string; // SAN
  source: 'book' | 'engine' | 'puzzle';
  repertoire: string; // repertoire id, 'chesscom' for mistakes found in the user's own games, 'puzzle' for puzzles
  puzzleId?: string; // Lichess puzzle id (source 'puzzle')
  drop?: number; // win% lost (engine mistakes)
  gameUrl?: string; // chess.com game the mistake came from
  at: number; // timestamp
  box: number; // Leitner box, 0 = new / failed
  due: number; // next review time
  reviewed?: number; // last review time (lets sync between devices keep the newest state)
  misses?: number; // how many times this position was played wrong (training, tests, games)
  deleted?: true; // removed by the user: kept as a mark, so that sync removes it on the other devices too
};

const KEY = 'chess-trainer:mistakes';
const DAY = 24 * 60 * 60 * 1000;
/** Days until the next review after a correct answer, by the box the mistake moves into. */
const INTERVALS = [1, 3, 7, 14, 30];
export const MAX_BOX = INTERVALS.length;

/** Fired on window whenever the store changes, so counters elsewhere can refresh. */
export const MISTAKES_CHANGED = 'chess-trainer:mistakes-changed';

/** Everything stored, the removed positions too. */
function loadAll(): Mistake[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** The saved positions (not the removed ones). */
export function loadMistakes(): Mistake[] {
  return loadAll().filter((m) => !m.deleted);
}

function store(all: Mistake[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(MISTAKES_CHANGED));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function saveMistake(m: Omit<Mistake, 'at' | 'box' | 'due'>) {
  const all = loadAll();
  const now = Date.now();
  const existing = all.find((x) => x.fen === m.fen && x.repertoire === m.repertoire);
  if (existing?.deleted) Object.assign(existing, m, { at: now, box: 0, due: now, misses: 1, deleted: undefined }); // a new mistake there
  else if (existing) Object.assign(existing, m, { at: now, box: 0, due: now, misses: (existing.misses ?? 1) + 1 });
  else all.push({ ...m, at: now, box: 0, due: now, misses: 1 });
  store(all);
}

/** The mistakes to practice: all but those of hidden openings (they stay saved, and come back with the opening). */
export function practiceMistakes(): Mistake[] {
  const hidden = hiddenIds();
  return loadMistakes().filter((m) => !hidden.includes(m.repertoire));
}

/** Mistakes due for review now, oldest due first. */
export function dueMistakes(now = Date.now()): Mistake[] {
  return practiceMistakes()
    .filter((m) => m.due <= now)
    .sort((a, b) => a.due - b.due);
}

/** Leitner step: correct -> next box and a longer wait; wrong -> back to box 0, due again now. */
export function recordReview(m: Pick<Mistake, 'fen' | 'repertoire'>, correct: boolean, now = Date.now()) {
  const all = loadAll();
  const x = all.find((y) => y.fen === m.fen && y.repertoire === m.repertoire);
  if (!x || x.deleted) return;
  if (correct) {
    x.box = Math.min(x.box + 1, MAX_BOX);
    x.due = now + INTERVALS[x.box - 1] * DAY;
  } else {
    x.box = 0;
    x.due = now;
  }
  x.reviewed = now;
  store(all);
}

/**
 * Removes a position from practice, on every device: what is left is a mark, newer than the position, which sync
 * keeps over it (the newest state of a position wins). Its `due` is far away, so an older version of the app does not
 * show it either.
 */
export function deleteMistake(m: Pick<Mistake, 'fen' | 'repertoire'>, now = Date.now()) {
  const all = loadAll();
  const i = all.findIndex((y) => y.fen === m.fen && y.repertoire === m.repertoire);
  if (i < 0) return;
  const x = all[i];
  all[i] = { fen: x.fen, repertoire: x.repertoire, played: x.played, correct: x.correct, source: x.source, at: x.at, box: x.box, due: now + 100 * 365 * DAY, reviewed: now, deleted: true };
  store(all);
}

/** Undoes deleteMistake: the position as it was, newer than the mark. */
export function restoreMistake(m: Mistake, now = Date.now()) {
  const all = loadAll();
  const i = all.findIndex((y) => y.fen === m.fen && y.repertoire === m.repertoire);
  const back = { ...m, reviewed: now, deleted: undefined };
  if (i < 0) all.push(back);
  else all[i] = back;
  store(all);
}

/** A count of mistakes that follows every change: new ones, reviews, hidden openings, cards becoming due. */
export function useMistakeCount(count: () => number): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    const refresh = () => setN(count());
    window.addEventListener(MISTAKES_CHANGED, refresh);
    window.addEventListener(HIDDEN_CHANGED, refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener(MISTAKES_CHANGED, refresh);
      window.removeEventListener(HIDDEN_CHANGED, refresh);
      clearInterval(timer);
    };
  }, [count]);
  return n;
}

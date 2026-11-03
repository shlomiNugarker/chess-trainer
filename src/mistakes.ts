// Mistakes are saved locally and drilled later with spaced repetition (Leitner boxes).

export type Mistake = {
  fen: string; // position before the mistake (user to move)
  played: string; // SAN
  correct: string; // SAN
  source: 'book' | 'engine';
  repertoire: string; // repertoire id, or 'chesscom' for mistakes found in the user's own games
  drop?: number; // win% lost (engine mistakes)
  gameUrl?: string; // chess.com game the mistake came from
  at: number; // timestamp
  box: number; // Leitner box, 0 = new / failed
  due: number; // next review time
};

const KEY = 'chess-trainer:mistakes';
const DAY = 24 * 60 * 60 * 1000;
/** Days until the next review after a correct answer, by the box the mistake moves into. */
const INTERVALS = [1, 3, 7, 14, 30];
export const MAX_BOX = INTERVALS.length;

/** Fired on window whenever the store changes, so counters elsewhere can refresh. */
export const MISTAKES_CHANGED = 'chess-trainer:mistakes-changed';

export function loadMistakes(): Mistake[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
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
  const all = loadMistakes();
  const now = Date.now();
  const existing = all.find((x) => x.fen === m.fen && x.repertoire === m.repertoire);
  if (existing) Object.assign(existing, m, { at: now, box: 0, due: now });
  else all.push({ ...m, at: now, box: 0, due: now });
  store(all);
}

/** Mistakes due for review now, oldest due first. */
export function dueMistakes(now = Date.now()): Mistake[] {
  return loadMistakes()
    .filter((m) => m.due <= now)
    .sort((a, b) => a.due - b.due);
}

/** Leitner step: correct -> next box and a longer wait; wrong -> back to box 0, due again now. */
export function recordReview(m: Pick<Mistake, 'fen' | 'repertoire'>, correct: boolean, now = Date.now()) {
  const all = loadMistakes();
  const x = all.find((y) => y.fen === m.fen && y.repertoire === m.repertoire);
  if (!x) return;
  if (correct) {
    x.box = Math.min(x.box + 1, MAX_BOX);
    x.due = now + INTERVALS[x.box - 1] * DAY;
  } else {
    x.box = 0;
    x.due = now;
  }
  store(all);
}

// Puzzles from the Lichess puzzle database (CC0), bundled as public/puzzles-v3.json by scripts/build-puzzles.py.
// Lichess format: `fen` is the position BEFORE the opponent's move; moves[0] is that move, then the solver and
// the opponent alternate. The solver plays the side to move after moves[0].

import { Chess } from 'chess.js';
import { readStored } from './storage';
import { tr } from './i18n';

export type Puzzle = {
  id: string;
  fen: string;
  moves: string[]; // UCI
  rating: number;
  themes: string[];
  opening: string; // repertoire id ('london', 'caro', ...) or ''
};

export type PuzzleMode = 'level' | 'openings' | 'mates';

export const PUZZLES_URL = `${import.meta.env.BASE_URL}puzzles-v3.json`;

let cache: Promise<Puzzle[]> | null = null;

/** Loads the puzzle set once (the service worker keeps it for offline use). */
export function loadPuzzles(): Promise<Puzzle[]> {
  cache ??= fetch(PUZZLES_URL)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<[string, string, string, number, string, string][]>;
    })
    .then((rows) => rows.map(([id, fen, moves, rating, themes, opening]) => ({ id, fen, moves: moves.split(' '), rating, themes: themes ? themes.split(' ') : [], opening })))
    .catch((e) => {
      cache = null; // let a later visit try again
      throw e;
    });
  return cache;
}

// ---- the solver's progress (localStorage) ----

export type PuzzleStats = { rating: number; played: number; solved: number; streak: number; best: number; seen: string[] };

const KEY = 'chess-trainer:puzzles';
export const START_RATING = 1200;
const MAX_SEEN = 2000;

export function loadStats(): PuzzleStats {
  return { rating: START_RATING, played: 0, solved: 0, streak: 0, best: 0, seen: [], ...readStored<Partial<PuzzleStats>>('puzzles', {}) };
}

function saveStats(s: PuzzleStats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Elo update against the puzzle's rating. Returns the new stats and the rating change. */
/** score: 1 solved, 0.5 solved with a hint (like a draw), 0 failed. */
export function recordResult(p: Puzzle, score: number): { stats: PuzzleStats; delta: number } {
  const s = loadStats();
  const solved = score === 1;
  const k = s.played < 30 ? 32 : 16; // move fast while the level is still unknown
  const expected = 1 / (1 + 10 ** ((p.rating - s.rating) / 400));
  const delta = Math.round(k * (score - expected));
  const streak = solved ? s.streak + 1 : 0;
  const stats: PuzzleStats = {
    rating: Math.max(400, s.rating + delta),
    played: s.played + 1,
    solved: s.solved + (solved ? 1 : 0),
    streak,
    best: Math.max(s.best, streak),
    seen: [...s.seen.filter((id) => id !== p.id), p.id].slice(-MAX_SEEN),
  };
  saveStats(stats);
  return { stats, delta };
}

/** Marks a puzzle as seen without rating it (e.g. skipped before trying). */
export function markSeen(id: string) {
  const s = loadStats();
  if (!s.seen.includes(id)) saveStats({ ...s, seen: [...s.seen, id].slice(-MAX_SEEN) });
}

const isMate = (p: Puzzle) => p.themes.some((t) => t.startsWith('mate') || t.endsWith('Mate'));

/** The next puzzle for this mode: unseen, as close to the solver's rating as possible, with some variety. */
export function pickNext(all: Puzzle[], mode: PuzzleMode, rating: number, seen: string[], exclude?: string): Puzzle | undefined {
  const done = new Set(seen);
  if (exclude) done.add(exclude);
  let pool = all.filter((p) => !done.has(p.id));
  if (mode === 'openings') pool = pool.filter((p) => p.opening);
  if (mode === 'mates') pool = pool.filter(isMate);
  if (!pool.length) {
    // everything here was seen: start the round again (but not the same puzzle twice in a row)
    pool = all.filter((p) => p.id !== exclude && (mode === 'level' || (mode === 'openings' ? p.opening : isMate(p))));
  }
  for (const width of [100, 200, 350]) {
    const near = pool.filter((p) => Math.abs(p.rating - rating) <= width);
    if (near.length >= 3 || (width === 350 && near.length)) return near[Math.floor(Math.random() * near.length)];
  }
  return [...pool].sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating))[0];
}

// ---- solving ----

/**
 * Is the solver's move right at this ply? The solution's move, or any move that gives mate (as on Lichess).
 * `uci` is from+to only: the board always promotes to a queen, so a promotion counts by its squares
 * (the solution's own piece is then played).
 */
export function isCorrect(p: Puzzle, ply: number, fenBefore: string, uci: string): boolean {
  if (uci.slice(0, 4) === p.moves[ply].slice(0, 4)) return true;
  try {
    const g = new Chess(fenBefore);
    g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
    return g.isCheckmate();
  } catch {
    return false;
  }
}

/** Plays a UCI move on a FEN; returns the new FEN and the SAN. */
export function applyUci(fen: string, uci: string) {
  const g = new Chess(fen);
  const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { fen: g.fen(), san: m.san };
}

// ---- theme names ----

const THEME_NAMES: Record<string, [string, string]> = {
  fork: ['מזלג', 'Fork'],
  pin: ['ריתוק', 'Pin'],
  skewer: ['שיפוד', 'Skewer'],
  discoveredAttack: ['התקפה נחשפת', 'Discovered attack'],
  doubleCheck: ['שח כפול', 'Double check'],
  hangingPiece: ['כלי לא מוגן', 'Hanging piece'],
  sacrifice: ['הקרבה', 'Sacrifice'],
  deflection: ['הסטה', 'Deflection'],
  attraction: ['משיכה', 'Attraction'],
  backRankMate: ['מט בשורה האחורית', 'Back-rank mate'],
  smotheredMate: ['מט חנוק', 'Smothered mate'],
  mateIn1: ['מט במסע אחד', 'Mate in 1'],
  mateIn2: ['מט בשני מסעים', 'Mate in 2'],
  mateIn3: ['מט בשלושה מסעים', 'Mate in 3'],
  promotion: ['הכתרה', 'Promotion'],
  advancedPawn: ['רגלי מתקדם', 'Advanced pawn'],
  trappedPiece: ['כלי לכוד', 'Trapped piece'],
  kingsideAttack: ['התקפה על המלך', 'Kingside attack'],
  exposedKing: ['מלך חשוף', 'Exposed king'],
  capturingDefender: ['לקיחת המגן', 'Capturing the defender'],
  clearance: ['פינוי', 'Clearance'],
  interference: ['חסימה', 'Interference'],
  intermezzo: ['מהלך ביניים', 'Intermezzo'],
  xRayAttack: ['התקפת רנטגן', 'X-ray attack'],
  quietMove: ['מהלך שקט', 'Quiet move'],
  defensiveMove: ['מהלך הגנה', 'Defensive move'],
  zugzwang: ['כפאי', 'Zugzwang'],
  endgame: ['סיום', 'Endgame'],
};

/** Named themes of a puzzle, most specific first ("Mate in 2" rather than "Mate"). */
export function themeNames(p: Puzzle): string[] {
  // THEME_NAMES lists the specific tactics first and the broad labels (endgame...) last
  return Object.keys(THEME_NAMES)
    .filter((t) => p.themes.includes(t))
    .slice(0, 3)
    .map((t) => tr(...THEME_NAMES[t]));
}

// Reviewing one game move by move: engine evaluation of every position, a label for every move (book, best,
// good, inaccuracy, mistake, blunder), accuracy for both players, and where the game left the repertoire.
// The engine runs in the browser, so there is no daily limit. Pure logic (tested by scripts/check-review.ts),
// plus a small device-only cache so a reviewed game opens at once the next time.

import { Chess, type Move } from 'chess.js';
import { winPercent, type Analysis } from './engine.ts';
import { buildBook, posKey, type Repertoire } from './repertoire.ts';

export type Eval = Pick<Analysis, 'cp' | 'mate' | 'bestMove' | 'pv'>; // side-to-move perspective
export type MoveClass = 'book' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export const MISTAKE_CLASSES: MoveClass[] = ['inaccuracy', 'mistake', 'blunder'];

export type ParsedGame = {
  moves: Move[]; // verbose, in order
  fens: string[]; // fens[i] = the position before move i; fens[moves.length] = the final position
};

export function parseGame(pgn: string): ParsedGame | null {
  const c = new Chess();
  try {
    c.loadPgn(pgn);
  } catch {
    return null; // unusual PGN (custom start position, variant) — not reviewable
  }
  const moves = c.history({ verbose: true });
  if (!moves.length) return null;
  return { moves, fens: [moves[0].before, ...moves.map((m) => m.after)] };
}

/** Win% the mover lost with move i (0 if it held or improved), from the evals before and after it. */
export function dropOf(before: Pick<Eval, 'cp' | 'mate'>, after: Pick<Eval, 'cp' | 'mate'>): number {
  return Math.max(0, winPercent(before) - (100 - winPercent(after)));
}

/** Same thresholds as the rest of the app: 10% inaccuracy, 20% mistake, 30% blunder. */
export function classify(drop: number, playedUci: string, bestUci: string, inBook: boolean): MoveClass {
  if (inBook) return 'book';
  if (playedUci === bestUci || drop < 2) return 'best';
  if (drop < 10) return 'good';
  return drop >= 30 ? 'blunder' : drop >= 20 ? 'mistake' : 'inaccuracy';
}

/** Lichess's per-move accuracy from the win% lost (100 for a perfect move). */
export function moveAccuracy(drop: number): number {
  const a = 103.1668100711649 * Math.exp(-0.04354415386753951 * drop) - 3.166924740191411 + 1; // +1: engine noise
  return Math.max(0, Math.min(100, a));
}

/**
 * A player's accuracy for the game: the mean of the arithmetic and the harmonic mean of the per-move accuracies,
 * so one blunder weighs more than in a plain average (close to Lichess, which also weights by volatility).
 */
export function gameAccuracy(accs: number[]): number | null {
  if (!accs.length) return null;
  const mean = accs.reduce((s, a) => s + a, 0) / accs.length;
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return (mean + harmonic) / 2;
}

export type BookInfo = {
  repId: string;
  plies: number; // the first `plies` moves of the game are repertoire moves
  left: { ply: number; mine: boolean; expected: string[] } | null; // where the game left the lines (null: a line ended)
  lineMoves: string; // the repertoire line that follows the game longest (to open in Learn)
};

/** How far the game followed the user's repertoire for that color (the one it followed longest). */
export function bookInfo(sans: string[], color: 'w' | 'b', reps: Repertoire[]): BookInfo | null {
  let best: BookInfo | null = null;
  for (const rep of reps.filter((r) => r.userColor === color)) {
    const book = buildBook(rep);
    const c = new Chess();
    let plies = 0;
    let left: BookInfo['left'] = null;
    for (; plies < sans.length; plies++) {
      const moves = book.get(posKey(c.fen()));
      if (!moves?.length) break;
      if (!moves.includes(sans[plies])) {
        left = { ply: plies, mine: c.turn() === color, expected: moves };
        break;
      }
      c.move(sans[plies]);
    }
    if (plies && (!best || plies > best.plies)) {
      // the line that shares the longest start with the game
      let lineMoves = rep.lines[0]?.moves ?? '';
      let shared = -1;
      for (const l of rep.lines) {
        const ls = l.moves.split(/\s+/);
        let k = 0;
        while (k < ls.length && k < sans.length && ls[k] === sans[k]) k++;
        if (k > shared) [shared, lineMoves] = [k, l.moves];
      }
      best = { repId: rep.id, plies, left, lineMoves };
    }
  }
  return best;
}

export type ReviewedMove = {
  ply: number;
  san: string;
  uci: string;
  color: 'w' | 'b';
  cls: MoveClass;
  drop: number;
  best: string; // SAN of the engine's move in the position before (may equal san)
  bestUci: string;
  pv: string[]; // engine line from the position before, UCI
};

export type SideSummary = { accuracy: number | null; counts: Record<MoveClass, number> };

export type GameReviewResult = {
  moves: ReviewedMove[];
  white: number[]; // White's win% at every position (fens order), for the graph and the eval bar
  sides: Record<'w' | 'b', SideSummary>;
};

const emptyCounts = (): Record<MoveClass, number> => ({ book: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });

const sanOf = (fen: string, uci: string) => {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' }).san;
  } catch {
    return uci;
  }
};

/** Labels and summary from the evals (one per position; missing ones — still being analyzed — are skipped). */
export function buildReview(game: ParsedGame, evals: (Eval | undefined)[], bookPlies: number): GameReviewResult {
  const white = game.fens.map((fen, i) => {
    const e = evals[i];
    if (!e) return NaN;
    const w = winPercent(e);
    return fen.split(' ')[1] === 'w' ? w : 100 - w;
  });
  const moves: ReviewedMove[] = [];
  const accs: Record<'w' | 'b', number[]> = { w: [], b: [] };
  const sides: GameReviewResult['sides'] = {
    w: { accuracy: null, counts: emptyCounts() },
    b: { accuracy: null, counts: emptyCounts() },
  };
  game.moves.forEach((m, i) => {
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) return;
    const uci = m.from + m.to + (m.promotion ?? '');
    const drop = dropOf(before, after);
    const cls = classify(drop, uci, before.bestMove, i < bookPlies);
    moves.push({ ply: i, san: m.san, uci, color: m.color, cls, drop, best: sanOf(m.before, before.bestMove), bestUci: before.bestMove, pv: before.pv });
    sides[m.color].counts[cls]++;
    accs[m.color].push(cls === 'book' ? 100 : moveAccuracy(drop));
  });
  sides.w.accuracy = gameAccuracy(accs.w);
  sides.b.accuracy = gameAccuracy(accs.b);
  return { moves, white, sides };
}

/**
 * Evaluates every position: a pass over the whole game first (so the review fills in fast), then a deeper look
 * at both sides of every move that seems to lose 10% or more. Searches are by depth, not by time: a fresh
 * single-threaded engine given the same positions in the same order then always returns the same evals, so the
 * same game always gets the same review (by time, results moved with how busy the device was). In the browser
 * depth 14 takes ~0.1s a position and depth 16 ~0.4s on a desktop.
 * `onUpdate` gets the evals so far after every position.
 */
export async function analyzePositions(
  engine: { analyze: (fen: string, go: string) => Promise<Analysis> },
  game: ParsedGame,
  opts: { depth?: number; refineDepth?: number; start?: (Eval | undefined)[]; onUpdate?: (evals: (Eval | undefined)[], done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<(Eval | undefined)[] | null> {
  const depth = opts.depth ?? 14;
  const refineDepth = opts.refineDepth ?? 16;
  const evals: (Eval | undefined)[] = opts.start ? [...opts.start] : new Array(game.fens.length).fill(undefined);
  const trim = (a: Analysis): Eval => ({ cp: a.cp, mate: a.mate, bestMove: a.bestMove, pv: a.pv.slice(0, 8) });
  const total = game.fens.length;
  let done = evals.filter(Boolean).length;
  for (let i = 0; i < total; i++) {
    if (evals[i]) continue;
    if (opts.cancelled?.()) return null;
    evals[i] = trim(await engine.analyze(game.fens[i], `depth ${depth}`));
    opts.onUpdate?.([...evals], ++done, total);
  }
  const suspects = game.moves.map((_, i) => i).filter((i) => dropOf(evals[i]!, evals[i + 1]!) >= 10);
  for (const i of suspects) {
    for (const k of [i, i + 1]) {
      if (opts.cancelled?.()) return null;
      evals[k] = trim(await engine.analyze(game.fens[k], `depth ${refineDepth}`));
    }
    opts.onUpdate?.([...evals], total, total);
  }
  return evals;
}

// ---- device-only cache (listed as local in syncMerge.ts: it can be large and is cheap to rebuild) ----

const KEY = 'chess-trainer:game-reviews';
const VERSION = 2; // bump when the analysis changes; 2: searches by depth (stable), not by time
const MAX = 40;
type Store = { v: number; games: Record<string, { evals: Eval[]; at: number }> };

function readStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null;
    return s?.v === VERSION ? s : { v: VERSION, games: {} };
  } catch {
    return { v: VERSION, games: {} };
  }
}

export function loadReview(url: string): Eval[] | undefined {
  return readStore().games[url]?.evals;
}

export function saveReview(url: string, evals: Eval[]) {
  const s = readStore();
  s.games[url] = { evals, at: Date.now() };
  const urls = Object.keys(s.games);
  if (urls.length > MAX) for (const u of urls.sort((a, b) => s.games[a].at - s.games[b].at).slice(0, urls.length - MAX)) delete s.games[u];
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or unavailable — the review still works, it just is not kept */
  }
}

export const isReviewed = (url: string) => !!readStore().games[url];

/** Games with a stored review (for the accuracy-over-time chart). */
export const reviewedUrls = () => Object.keys(readStore().games);

/** The user's accuracy in a stored review, or null if there is none (or it does not fit the game). */
export function storedAccuracy(game: { url: string; pgn: string; color: 'w' | 'b' }, reps: Repertoire[]): number | null {
  const evals = loadReview(game.url);
  const g = evals && parseGame(game.pgn);
  if (!evals || !g || evals.length !== g.fens.length) return null;
  const book = bookInfo(g.moves.map((m) => m.san), game.color, reps);
  return buildReview(g, evals, book?.plies ?? 0).sides[game.color].accuracy;
}

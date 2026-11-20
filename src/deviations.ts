// Where the user's real games leave the repertoire: the opponent plays a move the lines don't answer, or the
// user plays something else than the line. Pure (tested by scripts/check-review.ts).

import { Chess } from 'chess.js';
import { buildBook, moveLabel, posKey, type Repertoire } from './repertoire.ts';
import type { GameSummary } from './chesscom.ts';

export type OpponentDeviation = {
  repId: string;
  prefix: string[]; // SAN from the start, ending with the opponent's new move
  label: string; // that move, e.g. "2.Bc4"
  count: number;
  lastUrl: string;
};

export type UserDeviation = {
  repId: string;
  fen: string; // position where the user had to play the line's move
  prefix: string[]; // SAN before the user's move
  played: string;
  expected: string[]; // the line's move(s)
  label: string; // the line's move label, e.g. "3.e3"
  count: number;
  lastUrl: string;
};

const MAX_GAMES = 400; // the most recent; enough for a picture and fast to parse
const MAX_PLIES = 30;

/** Walks one game through one repertoire's book. */
function walk(sans: string[], rep: Repertoire, book: ReturnType<typeof buildBook>) {
  const c = new Chess();
  for (let i = 0; i < sans.length && i < MAX_PLIES; i++) {
    const fen = c.fen();
    const moves = book.get(posKey(fen));
    if (!moves?.length) return { depth: i, dev: null }; // the line ended here: nothing to report
    if (!moves.includes(sans[i])) {
      return { depth: i, dev: { ply: i, fen, mine: c.turn() === rep.userColor, expected: moves } };
    }
    c.move(sans[i]);
  }
  return { depth: sans.length, dev: null };
}

export function findDeviations(games: GameSummary[], reps: Repertoire[]) {
  const books = new Map(reps.map((r) => [r.id, buildBook(r)]));
  const opp = new Map<string, OpponentDeviation>();
  const mine = new Map<string, UserDeviation>();

  for (const g of games.slice(-MAX_GAMES)) {
    const own = reps.filter((r) => r.userColor === g.color);
    if (!own.length) continue;
    let sans: string[];
    try {
      const c = new Chess();
      c.loadPgn(g.pgn);
      sans = c.history();
    } catch {
      continue;
    }
    // the repertoire this game followed longest is the one it belongs to
    let best: { rep: Repertoire; res: ReturnType<typeof walk> } | null = null;
    for (const rep of own) {
      const res = walk(sans, rep, books.get(rep.id)!);
      if (!best || res.depth > best.res.depth) best = { rep, res };
    }
    const dev = best?.res.dev;
    // a different first move (1.c4 against a 1.d4 repertoire) is another opening, not a branch
    if (!best || !dev || dev.ply === 0) continue;
    const { rep } = best;
    const prefix = sans.slice(0, dev.ply);
    const played = sans[dev.ply];
    if (dev.mine) {
      const key = `${rep.id}|${posKey(dev.fen)}|${played}`;
      const x = mine.get(key);
      if (x) {
        x.count++;
        x.lastUrl = g.url;
      } else {
        mine.set(key, { repId: rep.id, fen: dev.fen, prefix, played, expected: dev.expected, label: moveLabel(dev.ply, dev.expected[0]), count: 1, lastUrl: g.url });
      }
    } else {
      const key = `${rep.id}|${posKey(dev.fen)}|${played}`;
      const x = opp.get(key);
      if (x) {
        x.count++;
        x.lastUrl = g.url;
      } else {
        opp.set(key, { repId: rep.id, prefix: [...prefix, played], label: moveLabel(dev.ply, played), count: 1, lastUrl: g.url });
      }
    }
  }
  const byCount = <T extends { count: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.count - a.count);
  return { opp: byCount(opp), mine: byCount(mine) };
}

/** "1.e4 c6 2.Bc4" for a SAN list from the start. */
export function movesText(sans: string[]): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(' ');
}

// How well each line of a repertoire is known: "test me" results (mastery.ts) and the move of the line
// you got wrong most often (from the saved mistakes, which count misses per position).

import type { LineRecord } from './mastery';
import type { Mistake } from './mistakes';
import { lineId, lineMoves, moveLabel, posKey, type Repertoire } from './repertoire';

export type LineStat = {
  tries: number; // "test me" runs
  clean: number; // runs with no mistake
  rate: number | null; // clean / tries, 0..100
  lastClean: boolean | null;
  hardest?: { ply: number; label: string; misses: number }; // ply = index of the move in the line
};

export function lineStats(rep: Repertoire, mastery: Record<string, LineRecord>, mistakes: Mistake[]): LineStat[] {
  // misses per position, for this repertoire's book mistakes
  const missesAt = new Map<string, number>();
  for (const m of mistakes) {
    if (m.repertoire !== rep.id || m.source !== 'book') continue;
    const k = posKey(m.fen);
    missesAt.set(k, (missesAt.get(k) ?? 0) + (m.misses ?? 1));
  }
  return rep.lines.map((l) => {
    const r = mastery[lineId(l)];
    let hardest: LineStat['hardest'];
    lineMoves(l.moves).forEach((mv, ply) => {
      if (mv.color !== rep.userColor) return;
      const n = missesAt.get(posKey(mv.before)) ?? 0;
      if (n > (hardest?.misses ?? 0)) hardest = { ply, label: moveLabel(ply, mv.san), misses: n };
    });
    return {
      tries: r?.tries ?? 0,
      clean: r?.clean ?? 0,
      rate: r?.tries ? Math.round((r.clean / r.tries) * 100) : null,
      lastClean: r ? r.last === 0 : null,
      hardest,
    };
  });
}

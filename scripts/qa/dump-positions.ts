// For engine_lines.py: every line of every repertoire as the positions where the user is to move (FEN, the user's
// move in UCI and in SAN with its number) and the FEN at the end. Prints JSON.
//   node --experimental-strip-types scripts/qa/dump-positions.ts
import { Chess } from 'chess.js';
import { REPERTOIRES } from '../../src/repertoire.ts';

const out = REPERTOIRES.flatMap((r) =>
  r.lines.map((l) => {
    const c = new Chess();
    const moves: { fen: string; uci: string; san: string }[] = [];
    for (const san of l.moves.split(/\s+/)) {
      const mine = c.turn() === r.userColor;
      const fen = c.fen();
      const no = `${c.moveNumber()}${c.turn() === 'w' ? '.' : '...'}`;
      const m = c.move(san);
      if (mine) moves.push({ fen, uci: m.from + m.to + (m.promotion ?? ''), san: no + m.san });
    }
    return { rep: r.id, line: l.id, user: r.userColor, moves, end: c.fen() };
  }),
);
console.log(JSON.stringify(out));

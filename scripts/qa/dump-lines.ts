// For the QA scripts: every repertoire line as UCI moves, plus a "book" of board placement -> the user's move,
// so a script can play the user's side by clicking squares. Prints JSON.
//   node --experimental-strip-types scripts/qa/dump-lines.ts > scripts/qa/out/lines.json
import { Chess } from 'chess.js';
import { REPERTOIRES } from '../../src/repertoire.ts';

const out = REPERTOIRES.map((r) => {
  const book: Record<string, string> = {};
  const lines = r.lines.map((l, i) => {
    const c = new Chess();
    const uci = l.moves.split(/\s+/).map((san) => {
      const user = c.turn() === r.userColor;
      const place = c.fen().split(' ')[0];
      const m = c.move(san);
      const u = m.from + m.to + (m.promotion ?? '');
      if (user) book[place] = u;
      return u;
    });
    return { i, name: l.name, uci };
  });
  return { id: r.id, color: r.userColor, lines, book };
});
console.log(JSON.stringify(out));

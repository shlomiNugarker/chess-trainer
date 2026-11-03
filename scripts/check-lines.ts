import { Chess } from 'chess.js';
import { REPERTOIRES, buildBook } from '../src/repertoire.ts';
let ok = true;
for (const r of REPERTOIRES) {
  for (const l of r.lines) {
    const c = new Chess();
    for (const san of l.moves.split(/\s+/)) {
      try { c.move(san); } catch { console.error(`ILLEGAL in ${r.id}/${l.name}: ${san} at ${c.fen()}`); ok = false; break; }
    }
    console.log(r.id, l.name, '->', c.fen());
  }
  // user-side conflicts: positions where repertoire gives the user >1 move
  const b = buildBook(r);
  for (const [k, v] of b) if (k.split(' ')[1] === r.userColor && v.length > 1) console.log('  multiple user moves at', k, v);
}
process.exit(ok ? 0 : 1);

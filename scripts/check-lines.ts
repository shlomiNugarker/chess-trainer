import { Chess } from 'chess.js';
import { REPERTOIRES, buildBook, moveLabel } from '../src/repertoire.ts';
let ok = true;
for (const r of REPERTOIRES) {
  for (const l of r.lines) {
    const c = new Chess();
    const labels = new Set<string>();
    for (const [ply, san] of l.moves.split(/\s+/).entries()) {
      try { labels.add(moveLabel(ply, c.move(san).san)); } catch { console.error(`ILLEGAL in ${r.id}/${l.name}: ${san} at ${c.fen()}`); ok = false; break; }
    }
    // every note must point at a move that is really in the line ("2.Bf4", "4...Qb6")
    for (const key of Object.keys(l.notes ?? {})) {
      if (!labels.has(key)) { console.error(`NOTE KEY not in ${r.id}/${l.name}: ${key}`); ok = false; }
    }
    console.log(r.id, l.name, '->', c.fen());
  }
  // user-side conflicts: positions where repertoire gives the user >1 move
  const b = buildBook(r);
  for (const [k, v] of b) if (k.split(' ')[1] === r.userColor && v.length > 1) console.log('  multiple user moves at', k, v);
}
process.exit(ok ? 0 : 1);

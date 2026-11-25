import { Chess } from 'chess.js';
import { REPERTOIRES, buildBook, lineId, moveLabel } from '../src/repertoire.ts';
import { EN } from '../src/repertoire.en.ts';
let ok = true;
for (const r of REPERTOIRES) {
  const ids = r.lines.map(lineId);
  for (const id of ids) if (ids.filter((x) => x === id).length > 1) { console.error(`TWO LINES with the id ${r.id}/${id}`); ok = false; }
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
    // the English text must exist for every line, with the same moves explained
    const en = EN[r.id]?.lines[lineId(l)];
    if (!en) { console.error(`NO ENGLISH for ${r.id}/${l.name}`); ok = false; continue; }
    for (const key of Object.keys(en.notes)) {
      if (!labels.has(key)) { console.error(`EN NOTE KEY not in ${r.id}/${l.name}: ${key}`); ok = false; }
    }
    for (const key of Object.keys(l.notes ?? {})) {
      if (!(key in en.notes)) { console.error(`EN NOTE MISSING ${r.id}/${l.name}: ${key}`); ok = false; }
    }
    console.log(r.id, l.name, '->', c.fen());
  }
  // user-side conflicts: positions where repertoire gives the user >1 move
  const b = buildBook(r);
  for (const [k, v] of b) if (k.split(' ')[1] === r.userColor && v.length > 1) console.log('  multiple user moves at', k, v);
}
// the other way round: English text for a repertoire or line that no longer exists (e.g. a renamed line,
// which would quietly show its Hebrew text in English)
for (const [id, rep] of Object.entries(EN)) {
  const r = REPERTOIRES.find((x) => x.id === id);
  if (!r) { console.error(`EN repertoire with no Hebrew one: ${id}`); ok = false; continue; }
  for (const name of Object.keys(rep.lines)) {
    if (!r.lines.some((l) => lineId(l) === name)) { console.error(`EN line with no Hebrew one: ${id}/${name}`); ok = false; }
  }
}
process.exit(ok ? 0 : 1);

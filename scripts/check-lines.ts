// Every repertoire line is legal, its notes point at its own moves, and every translation of the lines is complete:
// node --experimental-strip-types scripts/check-lines.ts
import { readdirSync } from 'node:fs';
import { Chess } from 'chess.js';
import { REPERTOIRES, buildBook, moveLabel } from '../src/repertoire.ts';
import type { RepertoireText } from '../src/i18n.ts';

let ok = true;
const fail = (text: string) => {
  console.error(text);
  ok = false;
};
for (const r of REPERTOIRES) {
  const ids = r.lines.map((l) => l.id);
  for (const id of ids) if (ids.filter((x) => x === id).length > 1) fail(`TWO LINES with the id ${r.id}/${id}`);
  for (const l of r.lines) {
    const c = new Chess();
    const labels = new Set<string>();
    for (const [ply, san] of l.moves.split(/\s+/).entries()) {
      try {
        labels.add(moveLabel(ply, c.move(san).san));
      } catch {
        fail(`ILLEGAL in ${r.id}/${l.id}: ${san} at ${c.fen()}`);
        break;
      }
    }
    if (!l.name || !l.idea) fail(`NO NAME OR IDEA in ${r.id}/${l.id}`);
    // every note must point at a move that is really in the line ("2.Bf4", "4...Qb6")
    for (const [key, text] of Object.entries(l.notes ?? {})) if (!labels.has(key) || !text) fail(`NOTE KEY not in ${r.id}/${l.id}: ${key}`);
    console.log(r.id, l.id, '->', c.fen());
  }
  // user-side conflicts: positions where repertoire gives the user >1 move
  const b = buildBook(r);
  for (const [k, v] of b) if (k.split(' ')[1] === r.userColor && v.length > 1) console.log('  multiple user moves at', k, v);
}

// the translations: the same repertoires, lines and notes, all of them and no others
for (const f of readdirSync('src/lang').filter((x) => x.startsWith('repertoire.'))) {
  const texts = (await import(`../src/lang/${f}`)).default as Record<string, RepertoireText>;
  for (const id of Object.keys(texts)) if (!REPERTOIRES.some((r) => r.id === id)) fail(`${f}: no such repertoire: ${id}`);
  for (const r of REPERTOIRES) {
    const t = texts[r.id];
    if (!t?.name) {
      fail(`${f}: ${r.id} is not translated`);
      continue;
    }
    for (const id of Object.keys(t.lines)) if (!r.lines.some((l) => l.id === id)) fail(`${f}: no such line: ${r.id}/${id}`);
    for (const l of r.lines) {
      const x = t.lines[l.id];
      if (!x?.name || !x.idea) {
        fail(`${f}: ${r.id}/${l.id} is not translated`);
        continue;
      }
      for (const key of Object.keys(l.notes ?? {})) if (!x.notes[key]) fail(`${f}: no note ${r.id}/${l.id} ${key}`);
      for (const key of Object.keys(x.notes)) if (!l.notes?.[key]) fail(`${f}: a note that is not in the line: ${r.id}/${l.id} ${key}`);
    }
  }
}
process.exit(ok ? 0 : 1);

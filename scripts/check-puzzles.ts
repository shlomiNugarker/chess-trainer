// Checks public/puzzles-v4.json: every puzzle's moves are legal from its FEN, plus a few counts.
// node --experimental-strip-types scripts/check-puzzles.ts
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { REPERTOIRES } from '../src/repertoire.ts';

const rows: [string, string, string, number, string, string][] = JSON.parse(readFileSync('public/puzzles-v4.json', 'utf8'));
let ok = true;
const themes = new Map<string, number>();
const openings = new Map<string, number>();
let mates = 0;
for (const [id, fen, moves, rating, th, opening] of rows) {
  const g = new Chess(fen);
  for (const m of moves.split(' ')) {
    try {
      g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    } catch {
      console.error(`ILLEGAL ${id}: ${m} at ${g.fen()}`);
      ok = false;
      break;
    }
  }
  if (typeof rating !== 'number') { console.error(`BAD RATING ${id}`); ok = false; }
  if (g.isCheckmate()) mates++;
  for (const t of th ? th.split(' ') : []) themes.set(t, (themes.get(t) ?? 0) + 1);
  for (const o of opening ? opening.split(' ') : []) openings.set(o, (openings.get(o) ?? 0) + 1);
}
console.log(`${rows.length} puzzles, ${mates} end in mate`);
console.log('openings:', Object.fromEntries(openings));
// "from my openings" needs puzzles for every repertoire, and only for repertoires that exist
for (const r of REPERTOIRES) if ((openings.get(r.id) ?? 0) < 50) { console.error(`FEW PUZZLES for ${r.id}: ${openings.get(r.id) ?? 0}`); ok = false; }
for (const o of openings.keys()) if (!REPERTOIRES.some((r) => r.id === o)) { console.error(`NO SUCH REPERTOIRE: ${o}`); ok = false; }
console.log('themes:', Object.fromEntries([...themes].sort((a, b) => b[1] - a[1])));
process.exit(ok ? 0 : 1);

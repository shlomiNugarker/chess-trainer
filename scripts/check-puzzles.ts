// Checks public/puzzles-v3.json: every puzzle's moves are legal from its FEN, plus a few counts.
// node --experimental-strip-types scripts/check-puzzles.ts
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const rows: [string, string, string, number, string, string][] = JSON.parse(readFileSync('public/puzzles-v3.json', 'utf8'));
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
  if (opening) openings.set(opening, (openings.get(opening) ?? 0) + 1);
}
console.log(`${rows.length} puzzles, ${mates} end in mate`);
console.log('openings:', Object.fromEntries(openings));
console.log('themes:', Object.fromEntries([...themes].sort((a, b) => b[1] - a[1])));
process.exit(ok ? 0 : 1);

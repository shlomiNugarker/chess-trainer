// For the QA scripts: every puzzle keyed by the board the solver sees (after the opponent's first move),
// with the rest of the solution, so a script can recognize the puzzle on screen and solve it. Prints JSON.
//   node --experimental-strip-types scripts/qa/dump-puzzles.ts public/puzzles-v4.json
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const file = process.argv[2];
if (!file) throw new Error('usage: dump-puzzles.ts <public/puzzles-vN.json>');
const rows = JSON.parse(readFileSync(file, 'utf8')) as [string, string, string, number, string, string][];

const out: Record<string, { id: string; rating: number; moves: string[]; openings: string[] }> = {};
for (const [id, fen, moves, rating, , opening] of rows) {
  const c = new Chess(fen);
  const [first, ...rest] = moves.split(' ');
  c.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });
  out[c.fen().split(' ')[0]] = { id, rating, moves: rest, openings: opening ? opening.split(' ') : [] };
}
console.log(JSON.stringify(out));

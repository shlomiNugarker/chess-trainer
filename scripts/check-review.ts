// Sanity checks for the review logic: node --experimental-strip-types scripts/check-review.ts
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { countMoves, openingFromEco, summarize, type GameSummary } from '../src/chesscom.ts';
import { findDeviations, movesText } from '../src/deviations.ts';
import { REPERTOIRES } from '../src/repertoire.ts';
import { accuracyByMonth, accuracyTrend, buildOverview, buildTips, matchRepertoire, phaseOf, strongestOpenings, summarizeDeep, weakestOpenings, type GameAnalysis, type OpeningRow } from '../src/reviewStats.ts';

const O = 'https://www.chess.com/openings/';
assert.deepEqual(openingFromEco(O + 'Italian-Game-Two-Knights-Defense'), { full: 'Italian Game Two Knights Defense', family: 'Italian Game' });
assert.equal(openingFromEco(O + 'Sicilian-Defense-Najdorf-Variation-6.Be3').family, 'Sicilian Defense');
assert.equal(openingFromEco(O + 'Caro-Kann-Defense-Advance-Variation-3...Bf5').family, 'Caro Kann Defense');
assert.equal(openingFromEco(O + 'Queens-Pawn-Opening-Accelerated-London-System').family, 'London System');
assert.equal(openingFromEco(O + 'Kings-Indian-Defense-Fianchetto-8.d5-Nb8').family, 'Kings Indian Defense');
assert.equal(openingFromEco(undefined).family, 'לא ידוע');
assert.equal(openingFromEco(O + 'Magnus-Queens-Gambit...5.Bf4').family, 'Magnus Queens Gambit'); // "..." glued to a word
assert.equal(openingFromEco(O + 'Scandinavian-Defense...3.Nc3').full, 'Scandinavian Defense');

const pgn = '[Event "Live Chess"]\n\n1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58]} 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1';
assert.equal(countMoves(pgn), 7);
const c = new Chess();
c.loadPgn(pgn); // clock comments must not break chess.js
assert.ok(c.isCheckmate());

const api = (white: string, wr: string, black: string, br: string) => ({
  url: 'u', pgn, end_time: 1, rated: true, time_class: 'blitz', rules: 'chess', eco: O + 'Italian-Game',
  white: { username: white, rating: 1000, result: wr }, black: { username: black, rating: 1100, result: br },
});
const s = summarize(api('Me', 'checkmated', 'Opp', 'win'), 'me')!;
assert.equal(s.color, 'w');
assert.equal(s.result, 'loss');
assert.equal(s.reason, 'checkmated');
assert.equal(summarize(api('Opp', 'timeout', 'ME', 'win'), 'me')!.reason, 'timeout'); // win: reason = how the opponent lost
assert.equal(summarize(api('Opp', 'agreed', 'me', 'agreed'), 'me')!.result, 'draw');
assert.equal(summarize({ ...api('me', 'win', 'x', 'resigned'), rules: 'chess960' }, 'me'), null);

assert.equal(matchRepertoire('Italian Game Two Knights Defense', 'w'), 'italian');
assert.equal(matchRepertoire('Italian Game', 'b'), undefined);
assert.equal(matchRepertoire('Caro Kann Defense', 'b'), 'caro');
assert.equal(matchRepertoire('Sicilian Defense Alapin Variation', 'b'), 'sicilian');
assert.equal(matchRepertoire('Sicilian Defense Alapin Variation', 'w'), 'italian');
assert.equal(matchRepertoire('Queens Gambit Accepted Old Variation', 'b'), 'qga');
assert.equal(matchRepertoire('Caro Kann Defense Two Knights Attack', 'w'), undefined); // not the Italian
assert.equal(matchRepertoire('English Opening Caro Kann Defensive System', 'b'), undefined); // not the Caro-Kann
assert.equal(matchRepertoire('Indian Game London System', 'w'), 'london');
assert.equal(matchRepertoire('Owens Defense', 'w'), 'italian');
assert.equal(matchRepertoire('Pirc Defense', 'b'), undefined);

assert.equal(phaseOf(new Chess().fen(), 5), 'opening');
assert.equal(phaseOf(new Chess().fen(), 20), 'middlegame');
assert.equal(phaseOf('4k3/8/8/8/8/8/4PPPP/R3K2R w - - 0 40', 40), 'endgame');

// A fake history: weak Italian as white, lots of timeouts, many short losses
const games: GameSummary[] = [];
for (let i = 0; i < 40; i++) {
  const color = i % 2 ? 'w' : 'b';
  const lose = i % 3 !== 0;
  games.push({
    url: `g${i}`, endTime: i, timeClass: 'blitz', rated: true, color, pgn,
    result: lose ? 'loss' : 'win', reason: lose ? (i % 2 ? 'timeout' : 'resigned') : 'resigned',
    opponent: 'x', opponentRating: 1000, myRating: 1000 + i, moveCount: i % 4 ? 20 : 40,
    opening: color === 'w' ? (i < 20 ? 'Italian Game' : 'London System') : 'French Defense',
    openingFull: color === 'w' ? (i < 20 ? 'Italian Game' : 'London System') : 'French Defense',
  });
}
const o = buildOverview(games);
assert.equal(o.total.games, 40);
assert.equal(o.byTimeClass[0].rating, 1039);
assert.equal(o.ratingSeries?.points.length, 40);
assert.equal(o.openings.w.find((r) => r.name === 'Italian Game')?.repertoireId, 'italian');
const tips = buildTips(o, null);

// ---- strongest / weakest openings ----
const row = (name: string, games: number, score: number): OpeningRow => ({ name, games, score, wins: 0, draws: 0, losses: 0 });
const rows = [row('A', 80, 62), row('B', 20, 65), row('C', 9, 90), row('D', 40, 56), row('E', 30, 42), row('F', 4, 0), row('G', 12, 61),
  row('Undefined', 14, 71), row('Unknown', 30, 10)]; // games with no recognized opening are neither strong nor weak
// average 55: C has too few games, D is not 5 points above, the order is by score
assert.deepEqual(strongestOpenings(rows, 55).map((r) => r.name), ['B', 'A', 'G']);
assert.deepEqual(strongestOpenings(rows, 70).map((r) => r.name), []); // nothing clearly above a high average
// weakest: 5+ games (F is out), lowest first
assert.deepEqual(weakestOpenings(rows).map((r) => r.name), ['E', 'D', 'G']);
assert.ok(tips.length > 0 && tips.length <= 3);
console.log('tips:', tips.map((t) => t.title));

const deep: GameAnalysis[] = [{
  url: 'g', userMoves: 30, mistakes: [
    { fen: '', moveNumber: 15, played: 'a', best: 'b', bestUci: 'a2a3', drop: 40, kind: 'blunder', phase: 'middlegame', gameUrl: 'g' },
    { fen: '', moveNumber: 5, played: 'a', best: 'b', bestUci: 'a2a3', drop: 12, kind: 'inaccuracy', phase: 'opening', gameUrl: 'g' },
  ],
}];
const d = summarizeDeep(deep);
assert.deepEqual(d.counts, { inaccuracy: 1, mistake: 0, blunder: 1 });
assert.equal(d.byPhase.middlegame, 1);
assert.equal(d.worst.length, 1);
assert.ok(buildTips(o, d).some((t) => t.action?.type === 'drill'));

// ---- where games leave the repertoire ----
const game = (pgn: string, color: 'w' | 'b', n: number) => ({ pgn: `[Event "x"]

${pgn}`, color, url: `g${n}` }) as GameSummary;
const dv = findDeviations(
  [
    game('1. d4 d5 2. Bf4 Nf6 3. e3 g6 1-0', 'w', 1), // opponent leaves the London at 3...g6
    game('1. d4 d5 2. Bf4 Nf6 3. e3 g6 0-1', 'w', 2), // same again
    game('1. d4 d5 2. Bf4 Nf6 3. Nf3 e6 1-0', 'w', 3), // the user leaves the line: 3.Nf3 instead of 3.e3
    game('1. e4 c6 2. Bc4 d5 0-1', 'b', 4), // Caro-Kann: 2.Bc4 is not answered
    game('1. c4 e5 1-0', 'b', 5), // another first move: not a branch
    game('1. d4 d5 2. c4 c6 3. Nf3 Nf6 1-0', 'b', 6), // follows the Slav: nothing to report
    game('1. e4 e5 2. Nf3 Nc6 1-0', 'b', 7), // Black's own first move is another opening (1...e5), not leaving the Caro-Kann
    game('1. d4 Nf6 2. c4 e6 1-0', 'b', 8), // same against 1.d4
  ],
  REPERTOIRES,
);
assert.equal(dv.opp.length, 2);
assert.deepEqual([dv.opp[0].repId, dv.opp[0].label, dv.opp[0].count], ['london', '3...g6', 2]);
assert.equal(movesText(dv.opp[0].prefix), '1.d4 d5 2.Bf4 Nf6 3.e3 g6');
assert.deepEqual([dv.opp[1].repId, dv.opp[1].label], ['caro', '2.Bc4']);
assert.equal(dv.mine.length, 1);
assert.deepEqual([dv.mine[0].repId, dv.mine[0].played, dv.mine[0].expected, dv.mine[0].label], ['london', 'Nf3', ['e3'], '3.e3']);

// ---- accuracy over time ----
{
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
  const items = [
    { t: at(2026, 9, 2), acc: 60 }, { t: at(2026, 9, 20), acc: 70 }, { t: at(2026, 9, 28), acc: 80 }, // Sep: 70 avg
    { t: at(2026, 10, 5), acc: 90 }, { t: at(2026, 10, 6), acc: 50 }, // Oct: only 2 games, left out
    { t: at(2026, 11, 1), acc: 80 }, { t: at(2026, 11, 3), acc: 80 }, { t: at(2026, 11, 30), acc: 83 }, // Nov
  ];
  const months = accuracyByMonth(items);
  assert.deepEqual(months.map((p) => [p.month, Math.round(p.avg), p.n]), [['2026-09', 70, 3], ['2026-11', 81, 3]]);
  assert.equal(accuracyByMonth(items, 1).length, 3);
  const tr = accuracyTrend(months)!;
  assert.equal(tr.last.month, '2026-11');
  assert.equal(Math.round(tr.delta), 11);
  assert.equal(accuracyTrend(months.slice(0, 1)), null);
}

// ---- reviewing one game ----
{
  const { parseGame, dropOf, classify, moveAccuracy, gameAccuracy, bookInfo, buildReview, analyzePositions } = await import('../src/gameAnalysis.ts');
  assert.equal(parseGame('[Event "x"]\n\n*'), null); // no moves
  const g = parseGame('1. e4 c5 2. Nf3 e6 3. Qe2 Qh4 4. Nxh4 1-0')!;
  assert.equal(g.moves.length, 7);
  assert.equal(g.fens.length, 8);
  // drop: the mover's win% before minus after (the after-eval is from the opponent's side)
  assert.equal(dropOf({ cp: 0, mate: null }, { cp: 0, mate: null }), 0);
  assert.ok(dropOf({ cp: 0, mate: null }, { cp: 500, mate: null }) > 30); // gave the opponent +5
  assert.equal(dropOf({ cp: 0, mate: null }, { cp: -300, mate: null }), 0); // improved: no drop
  assert.equal(dropOf({ cp: 0, mate: null }, { cp: null, mate: 0 }), 0); // delivered mate: no drop
  assert.equal(dropOf({ cp: null, mate: 3 }, { cp: null, mate: 1 }), 100); // had mate, now gets mated
  // classes
  assert.equal(classify(40, 'e2e4', 'd2d4', true), 'book');
  assert.equal(classify(15, 'e2e4', 'e2e4', false), 'best'); // the engine's own move is never a mistake
  assert.equal(classify(1, 'e2e4', 'd2d4', false), 'best');
  assert.equal(classify(5, 'e2e4', 'd2d4', false), 'good');
  assert.deepEqual([10, 20, 30].map((d) => classify(d, 'a', 'b', false)), ['inaccuracy', 'mistake', 'blunder']);
  // accuracy
  assert.equal(Math.round(moveAccuracy(0)), 100);
  assert.ok(moveAccuracy(30) < 30 && moveAccuracy(5) > 80);
  assert.equal(gameAccuracy([]), null);
  assert.ok(gameAccuracy([100, 100, 100, 5])! < gameAccuracy([100, 100, 100, 60])!); // a blunder weighs
  // book: the London, left by the user at move 3 (3.Nf3 instead of 3.e3)
  const b = bookInfo(['d4', 'd5', 'Bf4', 'Nf6', 'Nf3', 'e6'], 'w', REPERTOIRES)!;
  assert.deepEqual([b.repId, b.plies, b.left?.ply, b.left?.mine, b.left?.expected], ['london', 4, 4, true, ['e3']]);
  assert.ok(b.lineMoves.startsWith('d4 d5 Bf4 Nf6'));
  assert.equal(bookInfo(['a4'], 'w', REPERTOIRES), null); // not a repertoire opening at all
  // the review from evals: 3...Qh4?? hangs the queen (Black's eval goes from 0 to -900)
  const ev = (cp: number, best: string) => ({ cp, mate: null, bestMove: best, pv: [best] });
  const evals = [ev(30, 'e2e4'), ev(-30, 'g1f3'), ev(30, 'b1c3'), ev(-30, 'd2d4'), ev(30, 'g8f6'), ev(-30, 'b8c6'), ev(900, 'f3h4'), ev(-900, 'e8d8')];
  const r = buildReview(g, evals, 2);
  assert.equal(r.moves.length, 7);
  assert.deepEqual(r.moves.slice(0, 2).map((m) => m.cls), ['book', 'book']);
  const qh4 = r.moves[5];
  assert.deepEqual([qh4.san, qh4.cls, qh4.best], ['Qh4', 'blunder', 'Nc6']);
  assert.equal(r.moves[6].cls, 'best'); // 4.Nxh4 is the engine's move
  assert.equal(r.sides.b.counts.blunder, 1);
  assert.ok(r.sides.w.accuracy! > r.sides.b.accuracy!);
  assert.ok(Math.abs(r.white[0] - 52.8) < 1 && r.white[7] > 90); // White's win% per position
  // partial evals (still analyzing): moves without both evals are left out
  assert.equal(buildReview(g, evals.slice(0, 3), 0).moves.length, 2);
  // the engine pass: a quick look at every position, then a longer one around suspects
  const calls: string[] = [];
  const fake = { analyze: async (fen: string, go: string) => { calls.push(go); return { cp: fen === g.fens[6] ? 900 : 0, mate: null, bestMove: 'a2a3', pv: ['a2a3'] }; } };
  const out = (await analyzePositions(fake, g, { movetime: 10 }))!;
  assert.equal(out.length, 8);
  assert.equal(calls.filter((c) => c === 'movetime 10').length, 8);
  assert.ok(calls.some((c) => c === 'movetime 40')); // 3...Qh4 (White +9 after it) is a suspect: both sides of it get a longer look
  let stop = false;
  assert.equal(await analyzePositions(fake, g, { movetime: 10, cancelled: () => stop, onUpdate: () => { stop = true; } }), null);
}

console.log('check-review: all good');

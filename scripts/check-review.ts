// Sanity checks for the review logic: node --experimental-strip-types scripts/check-review.ts
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { countMoves, openingFromEco, summarize, type GameSummary } from '../src/chesscom.ts';
import { findDeviations, movesText } from '../src/deviations.ts';
import { REPERTOIRES } from '../src/repertoire.ts';
import { buildOverview, buildTips, matchRepertoire, phaseOf, summarizeDeep, type GameAnalysis } from '../src/reviewStats.ts';

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

console.log('check-review: all good');

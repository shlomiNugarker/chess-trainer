// Games one move before a promotion or a draw, for nav.py: {name: {color, moves, play: [from, to], san}} as JSON.
// The long ones (50 moves, insufficient material) are found by random play with a fixed seed, so they are always the same.

import { Chess, type Move } from 'chess.js';

type Case = { color: 'w' | 'b'; moves: string; play: [string, string]; san?: string };
const cases: Record<string, Case> = {
  'promotion': { color: 'w', moves: 'a4 b5 axb5 a6 bxa6 Nc6 a7 Rb8', play: ['a7', 'a8'] },
  'promotion by capture': { color: 'w', moves: 'a4 b5 axb5 a6 bxa6 Nc6 a7 Nb8', play: ['a7', 'b8'] },
  'promotion as Black': { color: 'b', moves: 'Nc3 a5 b4 axb4 Nb1 b3 Nc3 b2 Nb1', play: ['b2', 'a1'] },
  'stalemate': { color: 'w', moves: 'e3 a5 Qh5 Ra6 Qxa5 h5 h4 Rah6 Qxc7 f6 Qxd7+ Kf7 Qxb7 Qd3 Qxb8 Qh7 Qxc8 Kg6', play: ['c8', 'e6'] },
  'threefold repetition': { color: 'b', moves: 'e4 e5 Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1', play: ['f6', 'g8'] },
};

let seed = 7;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = <T>(a: T[]): T => a[Math.floor(random() * a.length)];
const ends = (c: Chess, m: Move, test: () => boolean) => {
  c.move(m.san);
  const yes = test() && !c.isCheckmate() && !c.isStalemate();
  c.undo();
  return yes;
};

for (let t = 0; t < 400 && !cases['the 50-move rule']; t++) {
  const c = new Chess();
  c.move('e4');
  c.move('e5');
  const quiet = () => c.moves({ verbose: true }).filter((m) => !m.captured && m.piece !== 'p');
  for (let i = 0; i < 99 && !c.isGameOver() && quiet().length; i++) c.move(pick(quiet()).san);
  if (c.isGameOver() || c.history().length < 101) continue;
  const last = quiet().find((m) => ends(c, m, () => c.isDrawByFiftyMoves()));
  if (last) cases['the 50-move rule'] = { color: last.color, moves: c.history().join(' '), play: [last.from, last.to] };
}
for (let t = 0; t < 30_000 && !cases['not enough material']; t++) {
  const c = new Chess();
  for (let i = 0; i < 400 && !c.isGameOver(); i++) {
    const all = c.moves({ verbose: true });
    const captures = all.filter((m) => m.captured);
    const last = captures.find((m) => !m.promotion && ends(c, m, () => c.isInsufficientMaterial()));
    if (last) {
      cases['not enough material'] = { color: last.color, moves: c.history().join(' '), play: [last.from, last.to] };
      break;
    }
    c.move(pick(captures.length && random() < 0.8 ? captures : all).san);
  }
}
for (const x of Object.values(cases)) {
  const c = new Chess();
  for (const m of x.moves.split(' ')) c.move(m);
  x.san = c.move({ from: x.play[0], to: x.play[1], promotion: 'q' }).san;
}
console.log(JSON.stringify(cases));

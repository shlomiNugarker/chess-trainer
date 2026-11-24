// Checks the merge rules used to sync progress between devices (src/syncMerge.ts).
// node --experimental-strip-types scripts/check-sync.ts
import assert from 'node:assert/strict';
import { asNewDevice, isSynced, mergeSides } from '../src/syncMerge.ts';

const P = 'chess-trainer:';
const j = JSON.stringify;

// settings: the newer change wins; device-only keys are not synced
let m = mergeSides(
  { data: { [P + 'skill']: '3', [P + 'screen']: '"play"' }, stamps: { [P + 'skill']: 100 } },
  { data: { [P + 'skill']: '7' }, stamps: { [P + 'skill']: 200 } },
);
assert.equal(m.data[P + 'skill'], '7');
assert.equal(m.data[P + 'screen'], undefined);
assert.ok(!isSynced(P + 'sync-stamps') && isSynced(P + 'mistakes') && !isSynced('other-app:x'));

// one side only: kept
m = mergeSides({ data: { [P + 'lang']: '"en"' }, stamps: {} }, { data: {}, stamps: {} });
assert.equal(m.data[P + 'lang'], '"en"');

// mistakes: union, the most recently touched state of the same position wins
const a = [{ fen: 'A', repertoire: 'london', at: 10, due: 10, box: 0 }, { fen: 'B', repertoire: 'caro', at: 10, due: 50, box: 2, reviewed: 40 }];
const b = [{ fen: 'B', repertoire: 'caro', at: 10, due: 99, box: 3, reviewed: 90 }, { fen: 'C', repertoire: 'puzzle', at: 20, due: 20, box: 0 }];
m = mergeSides({ data: { [P + 'mistakes']: j(a) }, stamps: {} }, { data: { [P + 'mistakes']: j(b) }, stamps: {} });
const mm = JSON.parse(m.data[P + 'mistakes']);
assert.equal(mm.length, 3);
assert.equal(mm.find((x: { fen: string }) => x.fen === 'B').box, 3);

// mastery: per line, the later run
m = mergeSides(
  { data: { [P + 'mastery']: j({ london: { L1: { tries: 2, clean: 1, last: 0, at: 5 }, L2: { tries: 1, clean: 0, last: 3, at: 9 } } }) }, stamps: {} },
  { data: { [P + 'mastery']: j({ london: { L2: { tries: 2, clean: 1, last: 0, at: 12 } }, caro: { C1: { tries: 1, clean: 1, last: 0, at: 1 } } }) }, stamps: {} },
);
const ms = JSON.parse(m.data[P + 'mastery']);
assert.equal(ms.london.L1.at, 5);
assert.equal(ms.london.L2.last, 0);
assert.ok(ms.caro.C1);

// daily: the larger count per day
m = mergeSides({ data: { [P + 'daily']: j({ d1: 5, d2: 2 }) }, stamps: {} }, { data: { [P + 'daily']: j({ d2: 4, d3: 1 }) }, stamps: {} });
assert.deepEqual(JSON.parse(m.data[P + 'daily']), { d1: 5, d2: 4, d3: 1 });

// puzzles: stats of the device that played more, seen = union
m = mergeSides(
  { data: { [P + 'puzzles']: j({ rating: 1300, played: 20, seen: ['a', 'b'] }) }, stamps: {} },
  { data: { [P + 'puzzles']: j({ rating: 1250, played: 8, seen: ['b', 'c'] }) }, stamps: {} },
);
const pz = JSON.parse(m.data[P + 'puzzles']);
assert.equal(pz.rating, 1300);
assert.deepEqual([...pz.seen].sort(), ['a', 'b', 'c']);

// learned: union, an existing lesson is never replaced
m = mergeSides(
  { data: { [P + 'learned']: j({ london: { p1: 'Nf3' } }) }, stamps: {} },
  { data: { [P + 'learned']: j({ london: { p1: 'e3', p2: 'c3' } }) }, stamps: {} },
);
assert.deepEqual(JSON.parse(m.data[P + 'learned']), { london: { p1: 'Nf3', p2: 'c3' } });

// custom-lines: every branch from both devices, once
m = mergeSides(
  { data: { [P + 'custom-lines']: j({ london: [{ moves: 'a', dev: 'x', at: 1 }] }) }, stamps: {} },
  { data: { [P + 'custom-lines']: j({ london: [{ moves: 'a', dev: 'x', at: 2 }, { moves: 'b', dev: 'y', at: 3 }], caro: [{ moves: 'c', dev: 'z', at: 4 }] }) }, stamps: {} },
);
const cl = JSON.parse(m.data[P + 'custom-lines']);
assert.deepEqual(cl.london.map((c: { moves: string }) => c.moves), ['a', 'b']);
assert.equal(cl.caro.length, 1);

// custom-lines: a branch removed on one device stays removed; added again later, it is back
m = mergeSides(
  { data: { [P + 'custom-lines']: j({ london: [{ moves: 'a', dev: 'x', at: 1, removed: 5 }, { moves: 'b', dev: 'y', at: 9 }] }) }, stamps: {} },
  { data: { [P + 'custom-lines']: j({ london: [{ moves: 'a', dev: 'x', at: 1 }, { moves: 'b', dev: 'y', at: 2, removed: 4 }] }) }, stamps: {} },
);
const rm = JSON.parse(m.data[P + 'custom-lines']).london as { moves: string; removed?: number }[];
assert.equal(rm.find((c) => c.moves === 'a')!.removed, 5);
assert.equal(rm.find((c) => c.moves === 'b')!.removed, undefined);

// the first sync of a device: the cloud's settings win even over a newer stamp (or when the cloud has none);
// progress is still merged, and a setting only this device has is kept
m = mergeSides(
  asNewDevice({
    data: { [P + 'skill']: '3', [P + 'threshold']: '20', [P + 'sound']: 'false', [P + 'daily']: j({ d1: 4 }) },
    stamps: { [P + 'skill']: 999, [P + 'threshold']: 999, [P + 'sound']: 999 },
  }),
  { data: { [P + 'skill']: '11', [P + 'threshold']: '30', [P + 'daily']: j({ d1: 2, d2: 1 }) }, stamps: { [P + 'skill']: 5 } },
);
assert.equal(m.data[P + 'skill'], '11');
assert.equal(m.data[P + 'threshold'], '30');
assert.equal(m.data[P + 'sound'], 'false');
assert.deepEqual(JSON.parse(m.data[P + 'daily']), { d1: 4, d2: 1 });

console.log('check-sync: all good');

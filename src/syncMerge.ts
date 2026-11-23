// Merging this device's saved data with the copy in the cloud, key by key, so using the app on two
// devices never loses progress. Pure functions (tested by scripts/check-sync.ts).

export const PREFIX = 'chess-trainer:';

/** Keys that belong to this device only (where you are in the app, sync bookkeeping). */
const LOCAL_ONLY = new Set(['screen', 'practice-view', 'learn-repertoire', 'learn-line', 'sync-stamps', 'cloud-signed-in', 'cloud-signing-in', 'cloud-last-sync', 'analyses', 'game-reviews']);

/** Should this localStorage key travel between devices? (`key` includes the prefix) */
export const isSynced = (key: string) => key.startsWith(PREFIX) && !LOCAL_ONLY.has(key.slice(PREFIX.length));

type Mistake = { fen: string; repertoire: string; at: number; due: number; reviewed?: number };
type LineRecord = { at: number };
type Stats = { played: number; seen: string[] };

const parse = <T>(s: string | undefined, fallback: T): T => {
  try {
    return s === undefined ? fallback : (JSON.parse(s) as T);
  } catch {
    return fallback;
  }
};

const touched = (m: Mistake) => Math.max(m.at ?? 0, m.reviewed ?? 0);

/** Progress keys are merged item by item; anything else: the newer change wins. */
const MERGERS: Record<string, (a: string, b: string) => string> = {
  // every saved position from both devices; for the same one, the most recently touched state
  mistakes: (a, b) => {
    const out = new Map<string, Mistake>();
    for (const m of [...parse<Mistake[]>(a, []), ...parse<Mistake[]>(b, [])]) {
      const k = `${m.fen}|${m.repertoire}`;
      const prev = out.get(k);
      if (!prev || touched(m) > touched(prev)) out.set(k, m);
    }
    return JSON.stringify([...out.values()]);
  },
  // repertoire -> line -> record: the later test run wins
  mastery: (a, b) => {
    const x = parse<Record<string, Record<string, LineRecord>>>(a, {});
    const y = parse<Record<string, Record<string, LineRecord>>>(b, {});
    for (const [rep, lines] of Object.entries(y)) {
      const into = (x[rep] ??= {});
      for (const [name, r] of Object.entries(lines)) if (!into[name] || r.at > into[name].at) into[name] = r;
    }
    return JSON.stringify(x);
  },
  // date -> puzzles that day: the larger count (both devices count the same day separately)
  daily: (a, b) => {
    const x = parse<Record<string, number>>(a, {});
    for (const [d, n] of Object.entries(parse<Record<string, number>>(b, {}))) x[d] = Math.max(x[d] ?? 0, n);
    return JSON.stringify(x);
  },
  // puzzle rating: the device that played more, plus every puzzle seen anywhere
  puzzles: (a, b) => {
    const x = parse<Stats>(a, { played: 0, seen: [] });
    const y = parse<Stats>(b, { played: 0, seen: [] });
    const [base, other] = (y.played ?? 0) > (x.played ?? 0) ? [y, x] : [x, y];
    const seen = [...(other.seen ?? []).filter((id) => !(base.seen ?? []).includes(id)), ...(base.seen ?? [])].slice(-2000);
    return JSON.stringify({ ...base, seen });
  },
  // repertoire -> position -> move: every lesson from both devices (the first lesson stays)
  learned: (a, b) => {
    const x = parse<Record<string, Record<string, string>>>(a, {});
    for (const [rep, moves] of Object.entries(parse<Record<string, Record<string, string>>>(b, {}))) x[rep] = { ...moves, ...x[rep] };
    return JSON.stringify(x);
  },
};

type Branch = { moves: string; at: number; removed?: number };
const lastTouch = (c: Branch) => Math.max(c.at ?? 0, c.removed ?? 0);

MERGERS['custom-lines'] = (a, b) => {
  // repertoire -> branches: every branch from both devices (by move list); for the same one, the later of
  // adding and removing it, so a branch removed on one device is not brought back by the other
  const x = parse<Record<string, Branch[]>>(a, {});
  for (const [rep, list] of Object.entries(parse<Record<string, Branch[]>>(b, {}))) {
    const mine = (x[rep] ??= []);
    for (const c of list) {
      const i = mine.findIndex((d) => d.moves === c.moves);
      if (i < 0) mine.push(c);
      else if (lastTouch(c) > lastTouch(mine[i])) mine[i] = c;
    }
  }
  return JSON.stringify(x);
};

export type Side = { data: Record<string, string>; stamps: Record<string, number> };

/** The merged state of both sides. Keys are full localStorage keys (with the prefix). */
export function mergeSides(local: Side, remote: Side): Side {
  const data: Record<string, string> = {};
  const stamps: Record<string, number> = {};
  for (const key of new Set([...Object.keys(local.data), ...Object.keys(remote.data)])) {
    if (!isSynced(key)) continue;
    const a = local.data[key];
    const b = remote.data[key];
    const ta = local.stamps[key] ?? 0;
    const tb = remote.stamps[key] ?? 0;
    const merge = MERGERS[key.slice(PREFIX.length)];
    if (a === undefined) data[key] = b;
    else if (b === undefined) data[key] = a;
    else if (merge) data[key] = merge(a, b);
    else data[key] = tb > ta ? b : a;
    stamps[key] = Math.max(ta, tb);
  }
  return { data, stamps };
}

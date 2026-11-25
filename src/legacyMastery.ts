// The first versions kept the progress of a line under its Hebrew name. It is copied to the line's id, at every start
// that finds such a key: an old version on another device may still write them. Nothing is deleted (a deleted key would
// come back with the next sync), and nothing is written when there is nothing new.

import { readStored, writeStored } from './storage';
import type { LineRecord } from './mastery';

type Store = Record<string, Record<string, LineRecord>>;
const HEBREW = /[\u0590-\u05ff]/;

export async function migrateMastery() {
  const store = readStored<Store>('mastery', {});
  if (!Object.values(store).some((lines) => Object.keys(lines).some((k) => HEBREW.test(k)))) return;
  const { default: names } = await import('./lang/repertoire.he.ts');
  let changed = false;
  for (const [rep, lines] of Object.entries(store)) {
    for (const [id, { name }] of Object.entries(names[rep]?.lines ?? {})) {
      const old = lines[name];
      if (!old || (lines[id] && lines[id].at >= old.at)) continue;
      lines[id] = old;
      changed = true;
    }
  }
  if (changed) writeStored('mastery', store);
}

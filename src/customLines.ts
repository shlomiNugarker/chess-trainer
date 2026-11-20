// Branches the user added from their own games ("My review" → where opponents leave your lines).
// Each is a full line in SAN from the start position: the repertoire moves, the opponent's deviation, and
// Stockfish's answer for a few moves. They are merged into the repertoire everywhere (Learn, training book,
// stats) through withCustom / useRepertoire, and synced between devices like any other saved key.

import { useEffect, useMemo, useState } from 'react';
import { REPERTOIRES, type Repertoire } from './repertoire';

const KEY = 'chess-trainer:custom-lines';
export const CUSTOM_CHANGED = 'chess-trainer:custom-lines-changed';

/** moves: SAN from the start; dev: label of the opponent's deviating move ("2.Bc4"). */
export type CustomLine = { moves: string; dev: string; at: number };
type Store = Record<string, CustomLine[]>; // repertoire id -> branches

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(CUSTOM_CHANGED));
  } catch {
    /* storage unavailable — ignore */
  }
}

export const loadCustom = (repId: string): CustomLine[] => read()[repId] ?? [];

/** Adds a branch (once per move list). */
export function addCustomLine(repId: string, moves: string[], dev: string) {
  const s = read();
  const list = (s[repId] ??= []);
  const m = moves.join(' ');
  if (!list.some((c) => c.moves === m)) list.push({ moves: m, dev, at: Date.now() });
  write(s);
}

export function removeCustomLine(repId: string, moves: string) {
  const s = read();
  s[repId] = (s[repId] ?? []).filter((c) => c.moves !== moves);
  write(s);
}

/** Stable id of a branch (used as its line name, so "mastered" marks stick to it). */
export const customName = (moves: string) => `custom:${moves}`;

/** The repertoire with the user's branches appended to its lines. */
export function withCustom(rep: Repertoire): Repertoire {
  const extra = loadCustom(rep.id);
  if (!extra.length) return rep;
  return { ...rep, lines: [...rep.lines, ...extra.map((c) => ({ name: customName(c.moves), moves: c.moves, custom: c.dev }))] };
}

/** The repertoire with the user's branches, refreshed whenever a branch is added or removed. */
export function useRepertoire(id: string): Repertoire {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CUSTOM_CHANGED, bump);
    return () => window.removeEventListener(CUSTOM_CHANGED, bump);
  }, []);
  return useMemo(
    () => withCustom(REPERTOIRES.find((r) => r.id === id) ?? REPERTOIRES[0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, version],
  );
}

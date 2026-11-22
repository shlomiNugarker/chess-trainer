// Repertoires the user chose to hide from the pickers (say, an opening they don't play). Nothing is deleted:
// progress stays, and a hidden repertoire can be shown again. Shared by Learn and the Trainer (both can be
// mounted at once), stored like every other setting, so it syncs between devices.

import { useMemo, useSyncExternalStore } from 'react';
import { REPERTOIRES, type Repertoire } from './repertoire';

const KEY = 'chess-trainer:hidden-repertoires';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener('storage', fn); // another tab
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', fn);
  };
}

function parse(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Repertoires to show (never empty: if everything is hidden, all are shown). */
export function visibleOf(hidden: string[]): Repertoire[] {
  const v = REPERTOIRES.filter((r) => !hidden.includes(r.id));
  return v.length ? v : REPERTOIRES;
}

export function useHiddenRepertoires() {
  const raw = useSyncExternalStore(subscribe, read, () => '[]');
  const hidden = useMemo(() => parse(raw), [raw]);
  const visible = useMemo(() => visibleOf(hidden), [hidden]);
  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    if (REPERTOIRES.every((r) => next.includes(r.id))) return; // keep at least one shown
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — ignore */
    }
    listeners.forEach((fn) => fn());
  };
  return { hidden, visible, toggle };
}

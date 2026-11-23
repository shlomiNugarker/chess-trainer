// Branches the user added from their own games ("My review" → where opponents leave your lines).
// Each is a full line in SAN from the start position: the repertoire moves, the opponent's deviation, and
// Stockfish's answer for a few moves. They are merged into the repertoire everywhere (Learn, training book,
// stats) through withCustom / useRepertoire, and synced between devices like any other saved key.

import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { REPERTOIRES, buildBook, moveLabel, posKey, type Repertoire } from './repertoire';
import { tr } from './i18n';

const KEY = 'chess-trainer:custom-lines';
export const CUSTOM_CHANGED = 'chess-trainer:custom-lines-changed';

/**
 * moves: SAN from the start; dev: label of the opponent's deviating move ("2.Bc4"); at: when it was added.
 * A removed branch stays as a marker (`removed`: when), so syncing with a device that still has it does not
 * bring it back; adding it again later wins over the marker.
 */
export type CustomLine = { moves: string; dev: string; at: number; removed?: number };
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

export const loadCustom = (repId: string): CustomLine[] => (read()[repId] ?? []).filter((c) => !c.removed);

/** Adds a branch (once per move list; a removed one comes back). */
export function addCustomLine(repId: string, moves: string[], dev: string) {
  const s = read();
  const list = (s[repId] ??= []);
  const m = moves.join(' ');
  const old = list.find((c) => c.moves === m);
  if (!old) list.push({ moves: m, dev, at: Date.now() });
  else if (old.removed) Object.assign(old, { dev, at: Date.now(), removed: undefined });
  write(s);
}

export function removeCustomLine(repId: string, moves: string) {
  const s = read();
  for (const c of s[repId] ?? []) if (c.moves === moves) c.removed = Date.now();
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

const START = new Chess().fen();
const MAX_PLIES = 40;

export type ImportResult = { ok: boolean; text: string };

/**
 * Imports lines from PGN text (one or more games, or just moves like "1.e4 c6 2.d4"). Only the main line is used
 * (variations and comments are ignored). A line is added as a branch unless it contradicts the repertoire (a
 * different move of yours in a position the repertoire already answers) or adds nothing new.
 */
export function importPgn(repId: string, text: string): ImportResult[] {
  const games = text
    .split(/\n\s*\n(?=\s*\[)/) // games start with their tag section
    .map((g) => g.trim())
    .filter(Boolean);
  const results: ImportResult[] = [];
  for (const [n, pgn] of games.entries()) {
    const which = games.length > 1 ? tr(`משחק ${n + 1}: `, `Game ${n + 1}: `) : '';
    const c = new Chess();
    try {
      c.loadPgn(pgn);
    } catch {
      results.push({ ok: false, text: which + tr('לא הצלחתי לקרוא את המהלכים.', 'Could not read the moves.') });
      continue;
    }
    const moves = c.history({ verbose: true });
    if (!moves.length) {
      results.push({ ok: false, text: which + tr('אין מהלכים.', 'No moves.') });
      continue;
    }
    if (moves[0].before !== START) {
      results.push({ ok: false, text: which + tr('רק קווים מעמדת הפתיחה הרגילה.', 'Only lines from the normal starting position.') });
      continue;
    }
    const rep = withCustom(REPERTOIRES.find((r) => r.id === repId)!);
    const book = buildBook(rep);
    const sans = moves.slice(0, MAX_PLIES).map((m) => m.san);
    let firstNew = -1;
    let conflict = '';
    for (const [i, m] of moves.slice(0, MAX_PLIES).entries()) {
      const known = book.get(posKey(m.before));
      if (known?.includes(m.san)) continue;
      if (known?.length && m.color === rep.userColor) {
        conflict = tr(
          `הקו משחק ${moveLabel(i, m.san)}, אבל ברפרטואר שלך משחקים כאן ${moveLabel(i, known[0])}. אפשר רק מהלך אחד שלך בכל עמדה.`,
          `The line plays ${moveLabel(i, m.san)}, but your repertoire plays ${moveLabel(i, known[0])} here. Only one move of yours per position.`,
        );
        break;
      }
      if (firstNew < 0) firstNew = i;
    }
    if (conflict) {
      results.push({ ok: false, text: which + conflict });
      continue;
    }
    if (firstNew < 0) {
      results.push({ ok: false, text: which + tr('הקו כבר נמצא ברפרטואר.', 'This line is already in the repertoire.') });
      continue;
    }
    const dev = moveLabel(firstNew, sans[firstNew]);
    addCustomLine(repId, sans, dev);
    results.push({ ok: true, text: which + tr(`נוסף: ★ מול ${dev} (${Math.ceil(sans.length / 2)} מהלכים)`, `Added: ★ Vs ${dev} (${Math.ceil(sans.length / 2)} moves)`) });
  }
  if (!games.length) results.push({ ok: false, text: tr('הדבק PGN או מהלכים.', 'Paste a PGN or moves.') });
  return results;
}

// Moves the user "learned" after the book ends: the coach's best move in each position the user reached,
// up to move LEARN_UNTIL. Next time the same position comes up it is checked like a book move,
// so the repertoire grows by itself from the user's own games.

import { posKey } from './repertoire';
import { RESET_MARK } from './syncMerge';

/** Learn (and play a strong opponent) up to this full-move number. */
export const LEARN_UNTIL = 15;

const KEY = 'chess-trainer:learned';

type Store = Record<string, Record<string, string>>; // repertoireId -> posKey -> SAN (and RESET_MARK -> time)

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
  } catch {
    /* storage unavailable — ignore */
  }
}

/** posKey -> SAN of every learned move for this repertoire. */
export function loadLearned(repertoireId: string): Record<string, string> {
  const { [RESET_MARK]: _reset, ...moves } = read()[repertoireId] ?? {};
  return moves;
}

/** Remember `san` as the move to play in `fen`. Never overwrites: the first lesson stays. Returns true if new. */
export function learnMove(repertoireId: string, fen: string, san: string): boolean {
  const s = read();
  const rep = (s[repertoireId] ??= {});
  const key = posKey(fen);
  if (rep[key]) return false;
  rep[key] = san;
  write(s);
  return true;
}

/** Forgets them all; the mark keeps syncing from bringing them back from another device. */
export function clearLearned(repertoireId: string) {
  const s = read();
  s[repertoireId] = { [RESET_MARK]: String(Date.now()) };
  write(s);
}

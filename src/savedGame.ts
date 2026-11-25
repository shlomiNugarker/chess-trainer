// The game in progress on the Play screen, so a reload (or a phone that closed the app) does not lose it.
// On this device only: not synced.

import { Chess } from 'chess.js';
import { readStored } from './storage';

const KEY = 'chess-trainer:game';
/** An older game is not continued: a new one starts. */
const MAX_AGE = 24 * 60 * 60 * 1000;

export type SavedGame = {
  mode: 'train' | 'play';
  repertoire: string;
  color: 'w' | 'b'; // the user's color in a regular game
  phase: 'book' | 'free';
  moves: string[]; // SAN
  at: number;
};

/** The saved game with its board, or null when there is none to continue. */
export function loadGame(now = Date.now()): (SavedGame & { board: Chess }) | null {
  const s = readStored<SavedGame | null>('game', null);
  if (!s || !Array.isArray(s.moves) || !s.moves.length || !(now - s.at < MAX_AGE)) return null;
  const board = new Chess();
  try {
    for (const m of s.moves) board.move(m);
  } catch {
    return null;
  }
  return board.isGameOver() ? null : { ...s, board };
}

export function saveGame(s: Omit<SavedGame, 'at'> | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify({ ...s, at: Date.now() }));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}

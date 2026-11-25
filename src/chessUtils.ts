import { Chess } from 'chess.js';
import type { Arrow } from 'react-chessboard';
import { DROP } from './engine.ts';
import { tr } from './i18n.ts';

// keep SAN / percentages left-to-right inside right-to-left text
export const ltr = (t: string | number) => `⁦${t}⁩`;

/** The name of a move that lost `drop` win% (at least DROP.inaccuracy). */
export const judge = (drop: number) =>
  drop >= DROP.blunder ? tr('Blunder') : drop >= DROP.mistake ? tr('Mistake') : tr('Inaccuracy');

export const uciToArrow = (uci: string, color: string): Arrow => ({
  startSquare: uci.slice(0, 2),
  endSquare: uci.slice(2, 4),
  color,
});

export const sanToUci = (fen: string, san: string) => {
  const m = new Chess(fen).move(san);
  return m.from + m.to + (m.promotion ?? '');
};

export const uciToSan = (fen: string, uci: string) => {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' }).san;
  } catch {
    return uci;
  }
};

/** First `plies` moves of a UCI line as SAN, e.g. "Bd3 c5 c3 Nc6". Stops quietly at an illegal move. */
export const pvToSan = (fen: string, pv: string[], plies = 4) => {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, plies)) {
    try {
      out.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' }).san);
    } catch {
      break;
    }
  }
  return out.join(' ');
};

// ---- board look (shared by every board in the app) ----
export const GREEN_ARROW = 'rgba(95, 179, 107, 0.9)'; // the right move
export const BLUE_ARROW = 'rgba(106, 167, 232, 0.85)'; // a hint
export const LAST_MOVE = 'rgba(246, 246, 105, 0.5)';
export const WRONG_MOVE = 'rgba(224, 108, 95, 0.6)';

/** Square colors and frame, spread into react-chessboard options. */
export const BOARD_THEME = {
  // a drag starts only after the finger really moves; with the default (1px) every tap on a phone became a drag
  dragActivationDistance: 8,
  darkSquareStyle: { backgroundColor: '#739552' },
  lightSquareStyle: { backgroundColor: '#ebecd0' },
  boardStyle: { borderRadius: '8px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)' },
  darkSquareNotationStyle: { color: '#ebecd0', fontWeight: 600 },
  lightSquareNotationStyle: { color: '#739552', fontWeight: 600 },
};

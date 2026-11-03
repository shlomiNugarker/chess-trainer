import { Chess } from 'chess.js';
import type { Arrow } from 'react-chessboard';

// keep SAN / percentages left-to-right inside Hebrew text
export const ltr = (t: string | number) => `⁦${t}⁩`;

/** Win% drop thresholds: 10 inaccuracy, 20 mistake, 30 blunder. */
export const judge = (drop: number) => (drop >= 30 ? 'בלאנדר' : drop >= 20 ? 'טעות' : 'אי-דיוק');

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

export const GREEN_ARROW = 'rgba(0, 160, 60, 0.85)';
export const BLUE_ARROW = 'rgba(0, 120, 255, 0.7)';

import { useState, type CSSProperties } from 'react';
import { Chess, type Square } from 'chess.js';
import type { SquareHandlerArgs } from 'react-chessboard';

const SELECTED: CSSProperties = { background: 'rgba(95, 179, 107, 0.55)' };
const TARGET: CSSProperties = { background: 'radial-gradient(circle, rgba(0, 0, 0, 0.18) 24%, transparent 26%)' };
const CAPTURE: CSSProperties = { background: 'radial-gradient(circle, transparent 58%, rgba(0, 0, 0, 0.18) 60%)' };

/**
 * Tap a piece, then tap where it goes — alongside drag & drop (easier on phones).
 * `canSelect(color)` says whose pieces may be picked; `onMove` is the same handler a drop uses.
 */
export function useClickToMove(
  fen: string,
  canSelect: (color: 'w' | 'b') => boolean,
  onMove: (from: string, to: string) => boolean,
) {
  // the selection belongs to one position: any move (drag, engine, undo) ends it
  const [selection, setSelection] = useState<{ fen: string; square: string } | null>(null);
  const selected = selection?.fen === fen ? selection.square : null;
  const setSelected = (square: string | null) => setSelection(square ? { fen, square } : null);

  const onSquareClick = ({ piece, square }: SquareHandlerArgs) => {
    const own = piece && canSelect(piece.pieceType[0] as 'w' | 'b');
    if (selected && selected !== square) {
      if (onMove(selected, square)) return setSelected(null);
      return setSelected(own ? square : null); // illegal target: re-select another own piece, or drop the selection
    }
    setSelected(own && selected !== square ? square : null);
  };

  const styles: Record<string, CSSProperties> = {};
  if (selected) {
    styles[selected] = SELECTED;
    try {
      for (const m of new Chess(fen).moves({ square: selected as Square, verbose: true })) {
        styles[m.to] = m.captured ? CAPTURE : TARGET;
      }
    } catch {
      /* stale selection — ignore */
    }
  }

  return { onSquareClick, clickStyles: styles, clearSelection: () => setSelected(null) };
}

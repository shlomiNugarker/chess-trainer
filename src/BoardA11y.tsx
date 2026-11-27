import { useEffect, useRef } from 'react';
import { msg, tr, trKey, useLang } from './i18n';

const PIECES: Record<string, string> = {
  wK: trKey('white king'),
  wQ: trKey('white queen'),
  wR: trKey('white rook'),
  wB: trKey('white bishop'),
  wN: trKey('white knight'),
  wP: trKey('white pawn'),
  bK: trKey('black king'),
  bQ: trKey('black queen'),
  bR: trKey('black rook'),
  bB: trKey('black bishop'),
  bN: trKey('black knight'),
  bP: trKey('black pawn'),
};

/** Placement of a FEN as square -> piece code ("e4" -> "wN"). */
function placement(fen: string): Map<string, string> {
  const out = new Map<string, string>();
  fen
    .split(' ')[0]
    .split('/')
    .forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else {
          out.set(`${'abcdefgh'[f]}${8 - r}`, `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}`);
          f++;
        }
      }
    });
  return out;
}

/**
 * The board for screen readers and the keyboard, beside a react-chessboard with options.id = `id`: every square is a
 * button named by its square and piece ("e4, white knight"); one Tab reaches the board, the arrows move between the
 * squares (as they are shown: also when the board is turned), and Enter or Space taps a square, which is how a move is
 * made by clicking (useClickToMove). The pieces' own drag handles leave the Tab order. The last move is announced.
 */
export function BoardA11y({ id, fen, lastMove, label }: { id: string; fen: string; lastMove?: string; label?: string }) {
  const lang = useLang();
  const focused = useRef<string | null>(null); // the square that keeps the Tab stop

  useEffect(() => {
    const board = document.getElementById(`${id}-board`);
    if (!board) return;
    const pieces = placement(fen);
    const squares = () => [...board.querySelectorAll<HTMLElement>('[data-square]')];
    const set = (el: Element, name: string, value: string) => el.getAttribute(name) !== value && el.setAttribute(name, value);
    const apply = () => {
      set(board, 'role', 'group');
      set(board, 'aria-label', label ?? tr('Chess board'));
      const all = squares();
      const stop = all.find((s) => s.dataset.square === focused.current) ?? all[0];
      for (const sq of all) {
        const piece = pieces.get(sq.dataset.square!);
        set(sq, 'role', 'button');
        set(sq, 'tabindex', sq === stop ? '0' : '-1');
        set(sq, 'aria-label', `${sq.dataset.square}, ${piece ? tr(PIECES[piece]) : tr('empty')}`);
        // the drag handle of the piece: not a second Tab stop, and its "draggable" button is not read
        for (const h of sq.querySelectorAll('[aria-roledescription]')) {
          set(h, 'tabindex', '-1');
          set(h, 'aria-hidden', 'true');
        }
      }
    };
    apply();
    const watch = new MutationObserver(apply); // the board renders its squares again after a move or a drag
    watch.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'aria-hidden'] });

    const onKey = (e: KeyboardEvent) => {
      const sq = (e.target as HTMLElement).closest<HTMLElement>('[data-square]');
      // a square focused by a click or a tap: the keys stay the screen's (the arrows step through the moves)
      if (!sq || !sq.matches(':focus-visible')) return;
      const all = squares();
      const i = all.indexOf(sq);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
      if (step !== undefined) {
        e.preventDefault();
        e.stopPropagation(); // not the move stepper of the screen
        const next = i + step;
        if (next < 0 || next >= all.length || (Math.abs(step) === 1 && Math.floor(next / 8) !== Math.floor(i / 8))) return;
        focused.current = all[next].dataset.square!;
        apply();
        all[next].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        focused.current = sq.dataset.square!;
        sq.click();
      }
    };
    const onFocus = (e: FocusEvent) => {
      const sq = (e.target as HTMLElement).closest<HTMLElement>('[data-square]');
      if (sq) focused.current = sq.dataset.square!;
    };
    board.addEventListener('keydown', onKey);
    board.addEventListener('focusin', onFocus);
    return () => {
      watch.disconnect();
      board.removeEventListener('keydown', onKey);
      board.removeEventListener('focusin', onFocus);
    };
  }, [id, fen, label, lang]);

  return (
    <div className="sr-only" aria-live="polite">
      {lastMove ? tr(msg`Last move: ${lastMove}`) : ''}
    </div>
  );
}

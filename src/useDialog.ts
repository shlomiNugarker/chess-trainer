import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], summary';

/** Is a dialog open? Keys that step through a line or a game belong to it then, not to the page behind. */
export const dialogOpen = () => document.querySelector('[aria-modal="true"]') !== null;

/**
 * Keyboard behavior of a dialog while `open`: the focus moves into it and stays there (Tab goes around), Escape
 * closes it, and afterwards the focus is back where it was.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    items()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const all = items();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      const out = at < 0 || (e.shiftKey ? at === 0 : at === all.length - 1);
      if (!out) return;
      e.preventDefault();
      all[e.shiftKey ? all.length - 1 : 0].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus({ preventScroll: true });
    };
  }, [ref, open]);
}

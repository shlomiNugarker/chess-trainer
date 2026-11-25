import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps the current move of a move list in view. On phones the list is one row that scrolls sideways, elsewhere it
 * scrolls down; without this it stays at move 1 while the game goes on. Only the list scrolls, never the page.
 */
export function useScrollToMove<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const current = list.querySelector<HTMLElement>('.move.last');
    if (!current) {
      list.scrollLeft = 0; // the starting position
      list.scrollTop = 0;
      return;
    }
    const box = list.getBoundingClientRect();
    const r = current.getBoundingClientRect();
    if (r.left < box.left || r.right > box.right) list.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
    if (r.top < box.top || r.bottom > box.bottom) list.scrollTop += r.top - box.top - (box.height - r.height) / 2;
  }, [dep]);
  return ref;
}

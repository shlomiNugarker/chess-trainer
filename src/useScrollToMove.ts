import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps the current move of a move list in view. On phones the list is one row that scrolls sideways, and
 * without this it stays at move 1 while the game goes on. Only the list scrolls, never the page.
 */
export function useScrollToMove<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const current = list.querySelector<HTMLElement>('.move.last');
    if (!current) {
      list.scrollLeft = list.scrollWidth;
      return;
    }
    const box = list.getBoundingClientRect();
    const r = current.getBoundingClientRect();
    if (r.left < box.left || r.right > box.right) list.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
  }, [dep]);
  return ref;
}

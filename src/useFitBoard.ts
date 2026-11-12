import { useLayoutEffect, useRef } from 'react';

/**
 * Measures the room left on screen below the board's top edge and publishes it as `--fit-h` on the element,
 * so CSS can make the board exactly as tall as the remaining viewport (no needless page scrolling).
 * The CSS decides when to use it (side-by-side layouts) and keeps a minimum size.
 */
export function useFitBoard<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bottomGap = 24; // breathing room under the board
      el.style.setProperty('--fit-h', `${Math.round(window.innerHeight - top - bottomGap)}px`);
    };
    update();
    window.addEventListener('resize', update);
    // things above the board change height (settings opened, a card appears, tab becomes visible)
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    ro.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, []);

  return ref;
}

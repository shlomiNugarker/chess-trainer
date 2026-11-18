import { useLayoutEffect, useState } from 'react';

/**
 * Measures the room left on screen below the board's top edge and publishes it as `--fit-h` on the element,
 * so CSS can make the board exactly as tall as the remaining viewport (no needless page scrolling).
 * The CSS decides when to use it (side-by-side layouts) and keeps a minimum size.
 * Returns a callback ref, so a board that appears later (e.g. after data loads) is measured too.
 */
export function useFitBoard<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bottomGap = 24; // breathing room under the board (matches the page's bottom padding)
      // positions are fractional with display scaling (125%, 150%): round toward "smaller", or a
      // half pixel too much is enough for the browser to show a scrollbar
      let fit = Math.floor(window.innerHeight - Math.ceil(top) - bottomGap);
      el.style.setProperty('--fit-h', `${fit}px`);
      // whatever sub-pixel overflow is still left (borders, rounding) comes off the board too
      const over = document.documentElement.scrollHeight - window.innerHeight;
      if (over > 0 && over <= 4) {
        fit -= over;
        el.style.setProperty('--fit-h', `${fit}px`);
      }
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
  }, [el]);

  return setEl;
}

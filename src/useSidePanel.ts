import { useLayoutEffect, useState } from 'react';

/**
 * For the side panel next to the board (`<aside>`). On wide screens it scrolls inside (App.css), so a
 * feedback card that appears while it is scrolled down ("you left the line", "not that move", a notice)
 * could be out of sight. This scrolls the panel — only the panel, never the page — to show it.
 * When the panel does not scroll (phones and tablets, where it sits under the board) it does nothing.
 * Returns a callback ref for the `<aside>`.
 */
export function useSidePanel<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!el) return;
    const reveal = (card: Element) => {
      if (el.scrollHeight <= el.clientHeight) return; // not scrolling inside
      const box = el.getBoundingClientRect();
      const r = card.getBoundingClientRect();
      const pad = 8;
      if (r.top < box.top) el.scrollTop -= box.top - r.top + pad;
      else if (r.bottom > box.bottom) el.scrollTop += Math.min(r.bottom - box.bottom + pad, r.top - box.top - pad);
    };
    const mo = new MutationObserver((records) => {
      for (const rec of records)
        for (const n of rec.addedNodes)
          if (n instanceof Element && n.matches('.feedback, .notice')) return reveal(n);
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [el]);

  return setEl;
}

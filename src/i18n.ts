// Two languages, no library: every string is written in place as tr('עברית', 'English').
// The current language is module state, so plain modules (tips, errors) can use tr() too;
// React re-renders through useLang().

import { useSyncExternalStore } from 'react';

export type Lang = 'he' | 'en';

const KEY = 'chess-trainer:lang';
const TITLES: Record<Lang, string> = { he: 'מאמן שחמט', en: 'Chess Trainer' };

function initial(): Lang {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    /* storage unavailable — fall through */
  }
  return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('he') ? 'en' : 'he';
}

let lang: Lang = typeof window === 'undefined' ? 'he' : initial(); // Node (scripts/) stays Hebrew
const listeners = new Set<() => void>();

function applyToDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.title = TITLES[lang];
}
applyToDocument();

export const getLang = () => lang;

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — ignore */
  }
  applyToDocument();
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}

/** The string for the current language. */
export const tr = (he: string, en: string) => (lang === 'he' ? he : en);

export const dir = () => (lang === 'he' ? 'rtl' : 'ltr');

export const formatDate = (t: number) => new Date(t).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB');

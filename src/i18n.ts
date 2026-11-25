// The languages of the interface, no library. Every string is written in place in Hebrew and English:
// tr('עברית', 'English'). Other languages have a dictionary from the English text (src/lang/<id>.ts), loaded only
// when that language is chosen; a text missing there shows in English (scripts/check-i18n.ts fails on it).
// The current language is module state, so plain modules (tips, errors) can use tr() too;
// React re-renders through useLang().
//
// A text with values: tr(`שלב ${n}`, msg`Step ${n}`) — the dictionary key is 'Step {0}', so a translation can
// put the values in another order. Values are numbers, names or other tr() results, never English words.

import { useSyncExternalStore } from 'react';

export type Lang = 'he' | 'en' | 'es';
type Dict = Record<string, string>;

/** Adding a language: a line here, its dictionary in src/lang/, and an entry in DICTS. */
export const LANGS: { id: Lang; name: string; title: string; locale: string; dir: 'rtl' | 'ltr' }[] = [
  { id: 'he', name: 'עברית', title: 'מאמן שחמט', locale: 'he-IL', dir: 'rtl' },
  { id: 'en', name: 'English', title: 'Chess Trainer', locale: 'en-GB', dir: 'ltr' },
  { id: 'es', name: 'Español', title: 'Entrenador de ajedrez', locale: 'es-ES', dir: 'ltr' },
];

const DICTS: Partial<Record<Lang, () => Promise<{ default: Dict }>>> = {
  es: () => import('./lang/es.ts'),
};

const KEY = 'chess-trainer:lang';
const info = (id: Lang) => LANGS.find((l) => l.id === id)!;
const isLang = (x: unknown): x is Lang => LANGS.some((l) => l.id === x);

/** The saved language, or the browser's (English when the app does not speak it). */
function preferred(): Lang {
  if (typeof window === 'undefined') return 'he'; // Node (scripts/) stays Hebrew
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable — fall through */
  }
  const browser = navigator.language.toLowerCase();
  return LANGS.find((l) => browser.startsWith(l.id))?.id ?? 'en';
}

let wanted: Lang = preferred();
let lang: Lang = DICTS[wanted] ? 'en' : wanted; // English until the dictionary is here
let dict: Dict | null = null;
const listeners = new Set<() => void>();

function show(next: Lang, d: Dict | null) {
  lang = next;
  dict = d;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = info(lang).dir;
    document.title = info(lang).title;
  }
  listeners.forEach((l) => l());
}

/** Shows `next` as soon as its texts are loaded; if they cannot be (first time, offline), the app stays as it is. */
async function load(next: Lang) {
  wanted = next;
  const get = DICTS[next];
  if (!get) return show(next, null);
  try {
    const d = (await get()).default;
    if (wanted === next) show(next, d); // not if another language was chosen meanwhile
  } catch {
    /* not loaded: the language shown now stays, and the choice is tried again at the next start */
  }
}

show(lang, null);
/** Settles when the first language is ready (or could not be loaded, or takes too long): the app renders then. */
export const langReady: Promise<unknown> = Promise.race([load(wanted), new Promise((r) => setTimeout(r, DICTS[wanted] ? 3000 : 0))]);

export const getLang = () => lang;

export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — ignore */
  }
  void load(next);
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

/** An English text with values. */
export type Msg = { key: string; values: (string | number)[] };
export const msg = (parts: TemplateStringsArray, ...values: (string | number)[]): Msg => ({
  key: parts.reduce((s, p, i) => `${s}{${i - 1}}${p}`),
  values,
});

/** The string for the current language. */
export function tr(he: string, en: string | Msg): string {
  if (lang === 'he') return he;
  if (typeof en === 'string') return dict?.[en] ?? en;
  return (dict?.[en.key] ?? en.key).replace(/\{(\d+)\}/g, (_, i: string) => String(en.values[Number(i)]));
}

/** Are the explanations of the openings written in this language? (src/repertoire.ts and repertoire.en.ts) */
export const hasExplanations = (l: Lang) => l === 'he' || l === 'en';

export const dir = () => info(lang).dir;

/** For dates and numbers. */
export const locale = () => info(lang).locale;

export const formatDate = (t: number) => new Date(t).toLocaleDateString(locale());

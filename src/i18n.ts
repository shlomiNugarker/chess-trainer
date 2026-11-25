// The languages of the app, no library. Every text is written in place in English: tr('Close'). Every other language
// has a dictionary keyed by the English text (src/lang/<id>.ts), loaded only when that language is chosen; a text
// missing there shows in English (scripts/check-i18n.ts fails on it).
// The current language is module state, so plain modules (tips, errors) can use tr() too;
// React re-renders through useLang().
//
// A text with values: tr(msg`Step ${n}`) — the key is 'Step {0}', so a translation can put the values in another
// order. Values are numbers, names or other tr() results, never English words. What belongs to a value is part of it
// ('41%', '3/83'): in a right-to-left language every value is kept apart from the text around it.

import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'es' | 'he';
type Dict = Record<string, string>;
/** The opening lines of a repertoire in another language, by the id of the line. */
export type LineText = { name: string; idea: string; notes: Record<string, string> };
export type RepertoireText = { name: string; lines: Record<string, LineText> };
type Explanations = Record<string, RepertoireText>;

/** Adding a language: a line here, its dictionary in src/lang/, and an entry in LOADERS. */
export const LANGS: { id: Lang; locale: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en', locale: 'en-GB', dir: 'ltr' },
  { id: 'es', locale: 'es-ES', dir: 'ltr' },
  { id: 'he', locale: 'he-IL', dir: 'rtl' },
];

type Texts = { dict: Dict; explanations: Explanations | null };
const LOADERS: Partial<Record<Lang, () => Promise<Texts>>> = {
  es: async () => ({ dict: (await import('./lang/es.ts')).default, explanations: null }),
  he: async () => {
    const [dict, lines] = await Promise.all([import('./lang/he.ts'), import('./lang/repertoire.he.ts')]);
    return { dict: dict.default, explanations: lines.default };
  },
};

/** The language's name in the language itself. */
export function langName(id: Lang): string {
  const name = new Intl.DisplayNames([id], { type: 'language' }).of(id) ?? id;
  return name.charAt(0).toLocaleUpperCase(id) + name.slice(1);
}

const KEY = 'chess-trainer:lang';
const info = (id: Lang) => LANGS.find((l) => l.id === id)!;
const isLang = (x: unknown): x is Lang => LANGS.some((l) => l.id === x);

/** The saved language, or the browser's (English when the app does not speak it). */
function preferred(): Lang {
  if (typeof window === 'undefined') return 'en'; // Node (scripts/)
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
let lang: Lang = 'en'; // until the dictionary is here
let texts: Texts | null = null;
const listeners = new Set<() => void>();

function show(next: Lang, t: Texts | null) {
  lang = next;
  texts = t;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = info(lang).dir;
    document.title = tr('Chess Trainer');
  }
  listeners.forEach((l) => l());
}

/** Shows `next` as soon as its texts are loaded; if they cannot be (first time, offline), the app stays as it is. */
async function load(next: Lang) {
  wanted = next;
  const get = LOADERS[next];
  if (!get) return show(next, null);
  try {
    const t = await get();
    if (wanted === next) show(next, t); // not if another language was chosen meanwhile
  } catch {
    /* not loaded: the language shown now stays, and the choice is tried again at the next start */
  }
}

show(lang, null);
/** Settles when the first language is ready (or could not be loaded, or takes too long): the app renders then. */
export const langReady: Promise<unknown> = Promise.race([load(wanted), new Promise((r) => setTimeout(r, LOADERS[wanted] ? 3000 : 0))]);

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

/** Marks a text of a table that is shown later: { fork: trKey('Fork') } and tr(TABLE[x]). */
export const trKey = (en: string) => en;

// a value stands by itself in a right-to-left text, in its own direction: "Qa4+" and "41%" are not turned around
const apart = (v: string | number) => (info(lang).dir === 'rtl' ? `\u2068${v}\u2069` : String(v));

/** The text in the current language. `context`: for an English text that other languages say in more than one way. */
export function tr(en: string | Msg, context?: string): string {
  const key = typeof en === 'string' ? en : en.key;
  const text = (context && texts?.dict[`${key}|${context}`]) ?? texts?.dict[key] ?? key;
  return typeof en === 'string' ? text : text.replace(/\{(\d+)\}/g, (_, i: string) => apart(en.values[Number(i)]));
}

/** The opening lines in the current language; null: in English (src/repertoire.ts). */
export const explanations = () => texts?.explanations ?? null;
/** Are the explanations of the openings in the current language? */
export const hasExplanations = () => lang === 'en' || explanations() !== null;

export const dir = () => info(lang).dir;

/** For dates and numbers. */
export const locale = () => info(lang).locale;

export const formatDate = (t: number) => new Date(t).toLocaleDateString(locale());

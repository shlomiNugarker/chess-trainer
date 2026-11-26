// Every text of the interface has a translation in every dictionary: node --experimental-strip-types scripts/check-i18n.ts
// Reads the code itself: the English text of each tr('Close') is the dictionary's key ('Step {0}' for msg`Step ${n}`,
// 'Practice|verb' for tr('Practice', 'verb')). Fails on a missing or unused translation, on values that do not match,
// on an English word hidden inside a value (it would stay English in every language), and on Hebrew anywhere but in
// src/lang/. `--missing` prints what to translate.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { parseSync } from 'vite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;
const problems: string[] = [];
const keys = new Map<string, string>(); // English text (and context) -> where
const hebrew = /[\u0590-\u05ff]/;
const isText = (n: Node) => n?.type === 'Literal' && typeof n.value === 'string';

for (const file of readdirSync('src').filter((f) => /\.tsx?$/.test(f) && f !== 'i18n.ts')) {
  const code = readFileSync(`src/${file}`, 'utf8');
  const { program, errors } = parseSync(file, code) as { program: Node; errors: unknown[] };
  if (errors.length) problems.push(`${file}: cannot be parsed`);
  const where = (n: Node) => `${file}:${code.slice(0, n.start).split('\n').length}`;

  /** English words inside the values of a msg`...`, unless they go through tr() themselves. */
  const englishIn = (n: Node): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(englishIn);
    if (n.type === 'CallExpression') return n.callee?.name !== 'tr' && n.arguments.some(englishIn); // .join(' or ')
    if (n.type === 'ConditionalExpression') return englishIn(n.consequent) || englishIn(n.alternate);
    if (isText(n)) return /[A-Za-z]{2}/.test(n.value);
    if (n.type === 'TemplateLiteral') return n.quasis.some((q: Node) => /[A-Za-z]{2}/.test(q.value.cooked)) || n.expressions.some(englishIn);
    return false;
  };

  const walk = (n: Node) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === 'CallExpression' && (n.callee?.name === 'tr' || n.callee?.name === 'trKey')) {
      const [en, context] = n.arguments;
      const add = (key: string) => keys.set(isText(context) ? `${key}|${context.value}` : key, where(n));
      if (isText(en)) add(en.value);
      else if (en?.type === 'TaggedTemplateExpression' && en.tag?.name === 'msg') {
        const { quasis, expressions } = en.quasi;
        add(quasis.map((q: Node, i: number) => (i ? `{${i - 1}}` : '') + q.value.cooked).join(''));
        if (expressions.some(englishIn)) problems.push(`${where(n)}: an English word inside a value — use tr() for it`);
        // "{0}%" would be turned around in a right-to-left language
        quasis.forEach((q: Node, i: number) => {
          if ((i && /^[%/×+]/.test(q.value.cooked)) || (i < quasis.length - 1 && /[+/×]$/.test(q.value.cooked))) problems.push(`${where(n)}: a sign beside a value — make it part of the value`);
        });
      } else if (en?.type === 'TemplateLiteral') problems.push(`${where(n)}: a text with values must be msg\`...\``);
      // anything else is a text of a table, marked there with trKey()
    }
    for (const k in n) if (k !== 'start' && k !== 'end') walk(n[k]);
  };
  walk(program);
}
keys.set('Chess Trainer', 'i18n.ts (the page title)');

const slots = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join();
for (const f of readdirSync('src/lang').filter((x) => !x.startsWith('repertoire.'))) {
  const dict = (await import(`../src/lang/${f}`)).default as Record<string, string>;
  // a context is for languages that need it: without one, the text itself is enough
  const missing = [...keys].filter(([k]) => !(k in dict) && !(k.split('|')[0] in dict));
  if (process.argv.includes('--missing')) console.log(`// ${f}\n${missing.map(([k]) => JSON.stringify(k)).join('\n')}`);
  for (const [k, at] of missing) problems.push(`${f}: no translation of ${JSON.stringify(k)} (${at})`);
  for (const [k, v] of Object.entries(dict)) {
    const used = keys.has(k) || [...keys.keys()].some((x) => x.split('|')[0] === k);
    if (!used) problems.push(`${f}: translates a text that is not in the app: ${JSON.stringify(k)}`);
    else if (slots(k) !== slots(v)) problems.push(`${f}: the values do not match: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    else if (!v.trim() || (hebrew.test(v) && f !== 'he.ts')) problems.push(`${f}: not a translation: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
  }
}

// the project is in English; Hebrew is one of its translations
const scan = (path: string) => {
  if (!existsSync(path) || /(^|\/)(node_modules|dist|out|lang|__pycache__)$/.test(path)) return;
  if (statSync(path).isDirectory()) return readdirSync(path).forEach((x) => scan(`${path}/${x}`));
  if (!/\.(tsx?|css|html|md|py|json|yml|webmanifest|js)$/.test(path) || /package-lock|puzzles-v/.test(path)) return;
  // except the link preview of index.html: the crawlers of Facebook and others read it without running the app
  const preview = (l: string) => path === 'index.html' && /<meta (name|property)="(description|og:[a-z:_]+|twitter:[a-z]+)" content=/.test(l);
  readFileSync(path, 'utf8').split('\n').forEach((l, i) => hebrew.test(l) && !preview(l) && problems.push(`${path}:${i + 1}: Hebrew outside src/lang/`));
};
for (const p of ['src', 'scripts', 'docs', '.github', 'index.html', 'public/manifest.webmanifest', 'public/sw.js', ...readdirSync('.').filter((x) => /\.(md|json)$/.test(x))]) scan(p);

// the language of a link: ?lang=he wins, an unknown one is ignored, and the other parameters stay
{
  const { langFromSearch } = await import('../src/i18n.ts');
  const cases: [string, string | null, string][] = [
    ['?lang=he&utm_source=facebook', 'he', '?utm_source=facebook'],
    ['?utm_source=facebook&lang=es', 'es', '?utm_source=facebook'],
    ['?lang=en', 'en', ''],
    ['?lang=fr&utm_source=x', null, '?utm_source=x'],
    ['?utm_source=x', null, '?utm_source=x'],
    ['', null, ''],
  ];
  for (const [search, lang, rest] of cases) {
    const got = langFromSearch(search);
    if (got.lang !== lang || got.rest !== rest) problems.push(`langFromSearch(${JSON.stringify(search)}): ${JSON.stringify(got)}, not ${JSON.stringify({ lang, rest })}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-i18n: all good (${keys.size} texts)`);

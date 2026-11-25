// Every text of the interface has a translation in every dictionary: node --experimental-strip-types scripts/check-i18n.ts
// Reads the code itself: the English text of each tr('עברית', 'English') is the dictionary's key ('Step {0}' for
// msg`Step ${n}`). Fails on a missing or unused translation, on values that do not match, and on an English word
// hidden inside a value (it would stay English in every language). `--missing` prints what to translate.

import { readdirSync, readFileSync } from 'node:fs';
import { parseSync } from 'vite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;
const problems: string[] = [];
const keys = new Map<string, string>(); // English text -> where
const hebrew = /[֐-׿]/;
const isText = (n: Node) => n?.type === 'Literal' && typeof n.value === 'string';

for (const file of readdirSync('src').filter((f) => /\.tsx?$/.test(f) && f !== 'i18n.ts' && f !== 'repertoire.en.ts')) {
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
    if (n.type === 'CallExpression' && n.callee?.name === 'tr') {
      const en = n.arguments[1];
      if (isText(en)) keys.set(en.value, where(n));
      else if (en?.type === 'TaggedTemplateExpression' && en.tag?.name === 'msg') {
        const { quasis, expressions } = en.quasi;
        keys.set(quasis.map((q: Node, i: number) => (i ? `{${i - 1}}` : '') + q.value.cooked).join(''), where(n));
        if (expressions.some(englishIn)) problems.push(`${where(n)}: an English word inside a value — use tr() for it`);
      } else if (n.arguments[0]?.type !== 'SpreadElement') problems.push(`${where(n)}: the English text must be a plain string or msg\`...\``);
    }
    // tables of [Hebrew, English], used as tr(...TABLE[x])
    if (n.type === 'ArrayExpression' && n.elements.length === 2 && n.elements.every(isText) && hebrew.test(n.elements[0].value)) keys.set(n.elements[1].value, where(n));
    for (const k in n) if (k !== 'start' && k !== 'end') walk(n[k]);
  };
  walk(program);
}

const slots = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join();
for (const f of readdirSync('src/lang')) {
  const dict = (await import(`../src/lang/${f}`)).default as Record<string, string>;
  const missing = [...keys].filter(([k]) => !(k in dict));
  if (process.argv.includes('--missing')) console.log(`// ${f}\n${missing.map(([k]) => JSON.stringify(k)).join('\n')}`);
  for (const [k, at] of missing) problems.push(`${f}: no translation of ${JSON.stringify(k)} (${at})`);
  for (const [k, v] of Object.entries(dict)) {
    if (!keys.has(k)) problems.push(`${f}: translates a text that is not in the app: ${JSON.stringify(k)}`);
    else if (slots(k) !== slots(v)) problems.push(`${f}: the values do not match: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    else if (!v.trim() || hebrew.test(v)) problems.push(`${f}: not a translation: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-i18n: all good (${keys.size} texts)`);

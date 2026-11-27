// How the openings are grouped in the pickers: White's, and Black's by the first move they answer.

import { repName, type Repertoire } from './repertoire';
import { msg, tr } from './i18n';

/** White's repertoires, and Black's by the first move they answer. */
export const GROUPS: { label: () => string; of: (r: Repertoire) => boolean }[] = [
  { label: () => tr('As White'), of: (r) => r.userColor === 'w' },
  { label: () => tr(msg`As Black against ${'1.e4'}`), of: (r) => r.userColor === 'b' && r.lines[0].moves.startsWith('e4') },
  { label: () => tr(msg`As Black against ${'1.d4'}`), of: (r) => r.userColor === 'b' && r.lines[0].moves.startsWith('d4') },
  { label: () => tr('As Black against other first moves'), of: (r) => r.userColor === 'b' && !/^(e4|d4)/.test(r.lines[0].moves) },
];

/**
 * "Not sure? Recommend for me" in the first opening choice: one as White, one against 1.e4, one against 1.d4, with
 * simple plans and few sharp lines. The London is one setup against almost everything; the Caro-Kann and the Slav share
 * the ...c6 and ...d5 structure, and the Slav's lines also meet the London, the Colle and the other quiet systems.
 */
export const BEGINNER = ['london', 'caro', 'slav'];

/** The name without "(White)" / "(Black)": the group says which color. */
export const shortName = (r: Repertoire) => repName(r).replace(/\s*\([^()]*\)$/, '');

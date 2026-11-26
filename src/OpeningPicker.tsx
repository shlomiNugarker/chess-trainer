import { useState } from 'react';
import { REPERTOIRES, repName, type Repertoire } from './repertoire';
import { msg, tr } from './i18n';

/** White's repertoires, and Black's by the first move they answer. */
const GROUPS: { label: () => string; of: (r: Repertoire) => boolean }[] = [
  { label: () => tr('As White'), of: (r) => r.userColor === 'w' },
  { label: () => tr(msg`As Black against ${'1.e4'}`), of: (r) => r.userColor === 'b' && r.lines[0].moves.startsWith('e4') },
  { label: () => tr(msg`As Black against ${'1.d4'}`), of: (r) => r.userColor === 'b' && r.lines[0].moves.startsWith('d4') },
  { label: () => tr('As Black against other first moves'), of: (r) => r.userColor === 'b' && !/^(e4|d4)/.test(r.lines[0].moves) },
];

/**
 * The first visit to Learn: which openings do you play? Only those are shown (the others are hidden, not deleted, and
 * come back from ⚙). "Show all" keeps every one.
 */
export function OpeningPicker({ onDone }: { onDone: (hidden: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const flip = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="card opening-picker">
      <strong>{tr('Which openings do you play?')}</strong>
      <p className="muted">{tr('Only these will show. You can change it any time with ⚙.')}</p>
      {GROUPS.map((g) => (
        <div key={g.label()} className="picker-group">
          <span className="picker-label">{g.label()}</span>
          <div className="chips">
            {REPERTOIRES.filter(g.of).map((r) => (
              <button key={r.id} className={picked.includes(r.id) ? 'chip active' : 'chip'} aria-pressed={picked.includes(r.id)} onClick={() => flip(r.id)}>
                {repName(r).replace(/\s*\([^()]*\)$/, '') /* the group says which color */}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="buttons">
        <button className="primary" disabled={!picked.length} onClick={() => onDone(REPERTOIRES.filter((r) => !picked.includes(r.id)).map((r) => r.id))}>
          {tr('Show these')}
        </button>
        <button className="ghost" onClick={() => onDone([])}>{tr('Show all')}</button>
      </div>
    </div>
  );
}

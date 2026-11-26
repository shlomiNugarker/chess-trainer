import { useState } from 'react';
import { REPERTOIRES } from './repertoire';
import { tr } from './i18n';
import { GROUPS, shortName } from './openingGroups';


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
      <p className="muted">{tr('Only these will show. You can change it any time from the opening button.')}</p>
      {GROUPS.map((g) => (
        <div key={g.label()} className="picker-group">
          <span className="picker-label">{g.label()}</span>
          <div className="chips">
            {REPERTOIRES.filter(g.of).map((r) => (
              <button key={r.id} className={picked.includes(r.id) ? 'chip active' : 'chip'} aria-pressed={picked.includes(r.id)} onClick={() => flip(r.id)}>
                {shortName(r)}
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

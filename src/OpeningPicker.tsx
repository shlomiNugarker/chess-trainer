import { useState } from 'react';
import { REPERTOIRES } from './repertoire';
import { msg, tr } from './i18n';
import { BEGINNER, GROUPS, pickerOrder, shortName } from './openingGroups';

const nameOf = (id: string) => shortName(REPERTOIRES.find((r) => r.id === id)!);

/**
 * The first visit to Learn: which openings do you play? Only those are shown (the others are hidden, not deleted, and
 * come back from ⚙). "Not sure?" picks three for a beginner; "Show all" keeps every one.
 */
export function OpeningPicker({ onDone }: { onDone: (hidden: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const flip = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const only = (ids: string[]) => onDone(REPERTOIRES.filter((r) => !ids.includes(r.id)).map((r) => r.id));
  const [white, vsE4, vsD4] = BEGINNER;
  return (
    <div className="card opening-picker" role="main">
      <strong>{tr('Which openings do you play?')}</strong>
      <p className="muted">{tr('Only these will show. You can change it any time from the opening button.')}</p>
      <div className="picker-recommend">
        <button className="recommend-btn" onClick={() => only(BEGINNER)}>
          {tr('Not sure? Recommend for me')}
        </button>
        <p className="muted">
          {tr(msg`A simple start: ${nameOf(white)} as White, ${nameOf(vsE4)} against ${'1.e4'} and ${nameOf(vsD4)} against ${'1.d4'}.`)}
        </p>
      </div>
      {GROUPS.map((g) => (
        <div key={g.label()} className="picker-group">
          <span className="picker-label">{g.label()}</span>
          <div className="chips">
            {pickerOrder(REPERTOIRES.filter(g.of)).map((r) => (
              <button key={r.id} data-rep={r.id} className={picked.includes(r.id) ? 'chip active' : 'chip'} aria-pressed={picked.includes(r.id)} onClick={() => flip(r.id)}>
                {shortName(r)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="buttons">
        <button className="primary" disabled={!picked.length} onClick={() => only(picked)}>
          {tr('Show these')}
        </button>
        <button className="ghost" onClick={() => onDone([])}>{tr('Show all')}</button>
      </div>
    </div>
  );
}

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { REPERTOIRES, lineText, repName, type Repertoire } from './repertoire';
import { withCustom } from './customLines';
import { isMastered, loadMastery } from './mastery';
import { loadMistakes } from './mistakes';
import { lineStats } from './lineStats';
import { msg, tr } from './i18n';
import { useDialog } from './useDialog';
import { GROUPS, pickerOrder, shortName } from './openingGroups';

/** A panel over the page: a sheet from the bottom on a phone, a centered box on a computer. */
export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, true, onClose);
  return (
    <>
      <div className="account-backdrop" onClick={onClose} />
      <div ref={panel} className={`pick-sheet card ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" aria-hidden />
        <div className="account-head">
          <h2>{title}</h2>
          <button className="ghost icon-btn" onClick={onClose} aria-label={tr('Close')}>✕</button>
        </div>
        <div className="pick-sheet-body">{children}</div>
      </div>
    </>
  );
}

/** Lines passed with no mistake, of all the lines of a repertoire (with the user's own branches). */
function progressOf(r: Repertoire) {
  const full = withCustom(r);
  const mastery = loadMastery(r.id);
  return { done: full.lines.filter((l) => isMastered(mastery[l.id])).length, of: full.lines.length };
}

/**
 * Which opening to study: the shown ones by group (White; Black against 1.e4, 1.d4, the rest), each with how many of
 * its lines are mastered. Below: which openings to show, and adding your own line from a PGN.
 */
export function OpeningSheet(props: {
  current: string;
  hidden: string[];
  visible: Repertoire[];
  onPick: (id: string) => void;
  onToggle: (id: string) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const { current, hidden, visible, onPick, onToggle, onImport, onClose } = props;
  const [managing, setManaging] = useState(false);
  const progress = useMemo(() => Object.fromEntries(REPERTOIRES.map((r) => [r.id, progressOf(r)])), []);

  if (managing)
    return (
      <Sheet title={tr('Which openings to show')} onClose={onClose}>
        <p className="muted">
          {tr('A hidden opening doesn’t appear here, in the training opening picker or in My mistakes. Nothing is deleted — you can show it again any time.')}
        </p>
        {GROUPS.map((g) => (
          <div key={g.label()} className="sheet-group manage-card">
            <span className="picker-label">{g.label()}</span>
            {pickerOrder(REPERTOIRES.filter(g.of)).map((r) => {
              const shown = !hidden.includes(r.id);
              return (
                <label key={r.id} className="manage-row" data-rep={r.id}>
                  <input type="checkbox" checked={shown} disabled={shown && visible.length === 1} onChange={() => onToggle(r.id)} />
                  {shortName(r)}
                </label>
              );
            })}
          </div>
        ))}
        <button className="primary sheet-wide" onClick={() => setManaging(false)}>{tr('Done')}</button>
      </Sheet>
    );

  return (
    <Sheet title={tr('Choose an opening')} onClose={onClose}>
      {GROUPS.map((g) => {
        const reps = pickerOrder(visible.filter(g.of));
        if (!reps.length) return null;
        return (
          <div key={g.label()} className="sheet-group">
            <span className="picker-label">{g.label()}</span>
            {reps.map((r) => {
              const p = progress[r.id];
              return (
                <button
                  key={r.id}
                  data-rep={r.id}
                  className={r.id === current ? 'sheet-row active' : 'sheet-row'}
                  aria-current={r.id === current}
                  onClick={() => onPick(r.id)}
                >
                  <span className="sheet-row-name">{shortName(r)}</span>
                  <span className={p.done === p.of ? 'sheet-row-meta all' : 'sheet-row-meta'} title={tr('Lines you passed in a test with no mistakes')}>
                    ✓ {p.done}/{p.of}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="sheet-foot">
        <button className="ghost manage-chip" onClick={() => setManaging(true)}>
          ⚙ {tr('Choose which openings to show')}{hidden.length ? ` (${tr(msg`${hidden.length} hidden`)})` : ''}
        </button>
        <button className="ghost import-link" onClick={onImport}>＋ {tr('Add your opening (PGN)')}</button>
      </div>
    </Sheet>
  );
}

/** The lines of the opening: mastered (✓), the test success rate and the move missed most, one tap to open each. */
export function LineSheet(props: {
  rep: Repertoire;
  current: number;
  onPick: (idx: number, atPly?: number) => void;
  onClose: () => void;
}) {
  const { rep, current, onPick, onClose } = props;
  const mastery = useMemo(() => loadMastery(rep.id), [rep.id]);
  const stats = useMemo(() => lineStats(rep, mastery, loadMistakes()), [rep, mastery]);
  const done = rep.lines.filter((l) => isMastered(mastery[l.id])).length;
  return (
    <Sheet title={tr(msg`Lines of ${repName(rep)}`)} onClose={onClose} className="line-sheet">
      <p className="muted">{tr(msg`Mastered ${done} of ${rep.lines.length}`)} · {tr('✓ = passed a test with no mistakes')}</p>
      {rep.lines.map((l, i) => {
        const st = stats[i];
        return (
          <div key={l.id} className={i === current ? 'sheet-line active' : 'sheet-line'}>
            <button className="sheet-row line-stats-name" aria-current={i === current} onClick={() => onPick(i)}>
              <span className="sheet-row-name">
                {isMastered(mastery[l.id]) ? '✓ ' : ''}
                {lineText(rep, l).name}
              </span>
              <span className={st.rate === null ? 'sheet-row-meta' : st.rate >= 70 ? 'sheet-row-meta rate good' : st.rate >= 40 ? 'sheet-row-meta rate mid' : 'sheet-row-meta rate low'}>
                {st.rate === null ? tr('Not tested yet') : tr(msg`${`${st.rate}%`} · ${st.clean} of ${st.tries} clean`)}
              </span>
            </button>
            {st.hardest && (
              <button className="link hardest" onClick={() => onPick(i, st.hardest!.ply)}>
                {tr('Hardest:')} <span dir="ltr">{st.hardest.label}</span>{' '}
                {st.hardest.misses === 1 ? tr('(missed once)') : tr(msg`(missed ${st.hardest.misses} times)`)}
              </button>
            )}
          </div>
        );
      })}
    </Sheet>
  );
}

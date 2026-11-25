import Drill from './Drill';
import Puzzles from './Puzzles';
import { tr } from './i18n';

export type PracticeView = 'puzzles' | 'mistakes';

/** The "Practice" tab: puzzles, and the spaced-repetition review of your own mistakes. */
export default function Practice({ view, onView, due }: { view: PracticeView; onView: (v: PracticeView) => void; due: number }) {
  return (
    <>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={view === 'puzzles'} className={view === 'puzzles' ? 'active' : ''} onClick={() => onView('puzzles')}>
          🧩 {tr('Puzzles')}
        </button>
        <button role="tab" aria-selected={view === 'mistakes'} className={view === 'mistakes' ? 'active' : ''} onClick={() => onView('mistakes')}>
          ↻ {tr('My mistakes')}
          {due > 0 && <span className="badge">{due}</span>}
        </button>
      </div>
      {view === 'puzzles' ? <Puzzles /> : <Drill />}
    </>
  );
}

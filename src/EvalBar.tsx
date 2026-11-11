/** Vertical win-chance bar for both sides; the side at the bottom of the board is at the bottom of the bar. */
export default function EvalBar({ white, orientation }: { white: number | null; orientation: 'white' | 'black' }) {
  const w = Math.round(white ?? 50);
  const sides = [
    { name: 'שחור', pct: 100 - w },
    { name: 'לבן', pct: w },
  ];
  const [top, bottom] = orientation === 'white' ? sides : [...sides].reverse();
  const label = (s: (typeof sides)[number]) => (
    <div className="evalbar-label">
      <small>{s.name}</small>
      <b>{white === null ? '—' : `${s.pct}%`}</b>
    </div>
  );
  return (
    <div className="evalbar" title={`סיכויי ניצחון: לבן ${w}%, שחור ${100 - w}%`}>
      {label(top)}
      <div className={`evalbar-track ${orientation === 'white' ? 'white-bottom' : 'white-top'}`}>
        <div className="evalbar-white" style={{ height: `${w}%` }} />
      </div>
      {label(bottom)}
    </div>
  );
}

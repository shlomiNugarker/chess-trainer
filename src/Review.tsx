import { useEffect, useMemo, useRef, useState } from 'react';
import { ChessComError, fetchGames, type GameSummary, type TimeClass } from './chesscom';
import { Engine } from './engine';
import { saveMistake } from './mistakes';
import {
  PHASE_LABELS, REASON_LABELS, TIME_CLASS_LABELS, MIN_OPENING_GAMES, SHORT_GAME,
  analyzeGame, buildOverview, buildTips, summarizeDeep,
  type GameAnalysis, type GamePhase, type OpeningRow, type Score, type Tip,
} from './reviewStats';
import { ltr } from './chessUtils';
import { useStored } from './storage';

const pct = (n: number) => ltr(`${Math.round(n)}%`);
const date = (t: number) => new Date(t).toLocaleDateString('he-IL');
const KIND_LABELS = { blunder: 'בלאנדרים', mistake: 'טעויות', inaccuracy: 'אי-דיוקים' } as const;

type Props = { onTrain: (repertoireId: string) => void; onDrill: () => void };

export default function Review({ onTrain, onDrill }: Props) {
  const [username, setUsername] = useStored('chesscom-user', '');
  const [input, setInput] = useState(username);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [timeClass, setTimeClass] = useState<TimeClass | 'all'>('all');
  const loadToken = useRef({ cancelled: false });

  const [deepCount, setDeepCount] = useStored('deep-count', 10);
  const [deep, setDeep] = useState<GameAnalysis[] | null>(null);
  const [deepProgress, setDeepProgress] = useState<{ game: number; total: number; pos: number; posTotal: number } | null>(null);
  const deepRun = useRef<{ engine: Engine; cancelled: boolean } | null>(null);

  useEffect(() => () => deepRun.current?.engine.terminate(), []);

  const load = async (name: string) => {
    const user = name.trim();
    if (!user) return;
    loadToken.current.cancelled = true;
    const token = { cancelled: false };
    loadToken.current = token;
    stopDeep();
    setError('');
    setGames(null);
    setDeep(null);
    setLoading({ done: 0, total: 0 });
    try {
      const all = await fetchGames(user, (done, total) => !token.cancelled && setLoading({ done, total }), token);
      if (token.cancelled) return;
      setUsername(user);
      setGames(all);
      setTimeClass('all');
    } catch (e) {
      if (!token.cancelled) setError(e instanceof ChessComError ? e.message : 'משהו השתבש בטעינת המשחקים.');
    } finally {
      if (!token.cancelled) setLoading(null);
    }
  };

  const filtered = useMemo(
    () => (games ?? []).filter((g) => timeClass === 'all' || g.timeClass === timeClass),
    [games, timeClass],
  );
  const overview = useMemo(() => (filtered.length ? buildOverview(filtered) : null), [filtered]);
  const deepSummary = useMemo(() => (deep?.length ? summarizeDeep(deep) : null), [deep]);
  const tips = useMemo(() => (overview ? buildTips(overview, deepSummary) : []), [overview, deepSummary]);

  function stopDeep() {
    if (!deepRun.current) return;
    deepRun.current.cancelled = true;
    deepRun.current.engine.terminate();
    deepRun.current = null;
    setDeepProgress(null);
  }

  const runDeep = async () => {
    stopDeep();
    const run = { engine: new Engine(), cancelled: false };
    deepRun.current = run;
    const recent = filtered.slice(-deepCount).reverse();
    const results: GameAnalysis[] = [];
    setDeep([]);
    for (let i = 0; i < recent.length; i++) {
      setDeepProgress({ game: i + 1, total: recent.length, pos: 0, posTotal: 0 });
      const a = await analyzeGame(run.engine, recent[i], {
        cancelled: () => run.cancelled,
        onPosition: (pos, posTotal) => !run.cancelled && setDeepProgress({ game: i + 1, total: recent.length, pos, posTotal }),
      });
      if (run.cancelled) return;
      if (!a) continue;
      for (const m of a.mistakes) {
        if (m.kind === 'inaccuracy') continue; // only real mistakes become drills
        saveMistake({ fen: m.fen, played: m.played, correct: m.best, source: 'engine', repertoire: 'chesscom', drop: m.drop, gameUrl: m.gameUrl });
      }
      results.push(a);
      setDeep([...results]);
    }
    run.engine.terminate();
    deepRun.current = null;
    setDeepProgress(null);
  };

  const onTip = (t: Tip) => {
    if (t.action?.type === 'train') onTrain(t.action.repertoireId);
    else if (t.action?.type === 'drill') onDrill();
    else if (t.action?.type === 'deep') document.getElementById('deep')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="review">
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          load(input);
        }}
      >
        <label>
          שם המשתמש שלך ב-Chess.com
          <input dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} placeholder="username" autoComplete="off" />
        </label>
        <button className="primary" type="submit" disabled={!input.trim() || !!loading}>
          {games && input.trim().toLowerCase() === username.toLowerCase() ? 'רענן' : 'טען משחקים'}
        </button>
      </form>

      {loading && (
        <div className="card">
          {loading.total ? `טוען חודש ${loading.done} מתוך ${loading.total}…` : 'מתחבר ל-Chess.com…'}
          <Progress value={loading.total ? loading.done / loading.total : 0} />
        </div>
      )}
      {error && <div className="notice">{error}</div>}
      {games && !games.length && <div className="notice">לא נמצאו משחקי שחמט רגיל למשתמש הזה.</div>}

      {games && games.length > 0 && overview && (
        <>
          <div className="chips">
            {(['all', 'bullet', 'blitz', 'rapid', 'daily'] as const)
              .filter((tc) => tc === 'all' || games.some((g) => g.timeClass === tc))
              .map((tc) => (
                <button key={tc} className={tc === timeClass ? 'chip active' : 'chip'} onClick={() => setTimeClass(tc)}>
                  {tc === 'all' ? 'הכל' : TIME_CLASS_LABELS[tc]}
                </button>
              ))}
          </div>

          <section className="card tips">
            <h2>3 הדברים הכי חשובים לשפר</h2>
            <ol>
              {tips.map((t) => (
                <li key={t.title}>
                  <strong>{t.title}</strong>
                  <p>{t.text}</p>
                  {t.action && (
                    <button onClick={() => onTip(t)}>
                      {t.action.type === 'train' ? 'תאמן את הפתיחה' : t.action.type === 'drill' ? 'לתרגול הטעויות' : 'לניתוח המנוע'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="tiles">
            <Tile label="משחקים" value={overview.total.games.toLocaleString()} />
            <Tile
              label="ניצחון / תיקו / הפסד"
              // no ltr(): the numbers must read right-to-left in the same order as the label
              value={[overview.total.wins, overview.total.draws, overview.total.losses].map((n) => n.toLocaleString()).join(' / ')}
            />
            <Tile label="ניקוד" value={pct(overview.total.score)} />
            {overview.accuracy && (
              <Tile label={`דיוק ממוצע (${overview.accuracy.games} משחקים שנבדקו)`} value={pct(overview.accuracy.avg)} />
            )}
          </section>

          {overview.ratingSeries && (
            <section className="card">
              <h2>הדירוג שלך ב{TIME_CLASS_LABELS[overview.ratingSeries.timeClass]} לאורך זמן</h2>
              <RatingChart points={overview.ratingSeries.points} />
            </section>
          )}

          <div className="grid2">
            <section className="card">
              <h2>לפי צבע</h2>
              <ScoreRow name="לבן" s={overview.byColor.w} />
              <ScoreRow name="שחור" s={overview.byColor.b} />
            </section>
            <section className="card">
              <h2>לפי קצב</h2>
              {overview.byTimeClass.map((t) => (
                <ScoreRow key={t.timeClass} name={`${TIME_CLASS_LABELS[t.timeClass]} · ${t.rating}`} s={t} />
              ))}
            </section>
          </div>

          <div className="grid2">
            <OpeningTable title="הפתיחות שלך בלבן" rows={overview.openings.w} onTrain={onTrain} />
            <OpeningTable title="הפתיחות שלך בשחור" rows={overview.openings.b} onTrain={onTrain} />
          </div>

          {overview.total.losses > 0 && (
            <section className="card">
              <h2>איך אתה מפסיד</h2>
              {overview.lossReasons.map((r) => (
                <Bar key={r.reason} label={REASON_LABELS[r.reason] ?? r.reason} value={r.count / overview.total.losses} text={`${r.count}`} />
              ))}
              <p className="muted">
                {pct((overview.shortLosses / overview.total.losses) * 100)} מההפסדים נגמרו עד מהלך {SHORT_GAME}.
              </p>
            </section>
          )}

          <section className="card" id="deep">
            <h2>ניתוח מנוע של המשחקים האחרונים</h2>
            <p className="muted">
              Stockfish עובר על כל מהלך שלך ומוצא טעויות. כל טעות ובלאנדר נכנסים למסך "חזרה" כתרגיל. לוקח כ-10 שניות למשחק.
            </p>
            <div className="buttons">
              <select value={deepCount} onChange={(e) => setDeepCount(Number(e.target.value))} disabled={!!deepProgress}>
                {[5, 10, 20].map((n) => (
                  <option key={n} value={n}>{n} משחקים אחרונים</option>
                ))}
              </select>
              {deepProgress ? (
                <button onClick={stopDeep}>עצור</button>
              ) : (
                <button className="primary" onClick={runDeep}>{deep ? 'נתח שוב' : 'נתח'}</button>
              )}
            </div>
            {deepProgress && (
              <div>
                משחק {deepProgress.game} מתוך {deepProgress.total}
                <Progress value={(deepProgress.game - 1 + (deepProgress.posTotal ? deepProgress.pos / deepProgress.posTotal : 0)) / deepProgress.total} />
              </div>
            )}
            {deepSummary && <DeepResults summary={deepSummary} onDrill={onDrill} />}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function Bar({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div className="bar-row" title={`${label}: ${text}`}>
      <span className="bar-label">{label}</span>
      <span className="bar">
        <span className="bar-fill" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </span>
      <span className="bar-value">{text}</span>
    </div>
  );
}

function ScoreRow({ name, s }: { name: string; s: Score }) {
  return (
    <div title={`${s.wins} ניצחונות, ${s.draws} תיקו, ${s.losses} הפסדים`}>
      <Bar label={name} value={s.score / 100} text={`${pct(s.score)} · ${s.games}`} />
    </div>
  );
}

function OpeningTable({ title, rows, onTrain }: { title: string; rows: OpeningRow[]; onTrain: (id: string) => void }) {
  const shown = rows.slice(0, 8);
  const weakest = rows
    .filter((r) => r.games >= MIN_OPENING_GAMES)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((r) => r.name);
  return (
    <section className="card">
      <h2>{title}</h2>
      {!shown.length && <p className="muted">אין משחקים.</p>}
      {shown.map((r) => (
        <div key={r.name} className={weakest.includes(r.name) ? 'opening weak' : 'opening'}>
          <Bar label={r.name} value={r.score / 100} text={`${pct(r.score)} · ${r.games}`} />
          {r.repertoireId && (
            <button className="small" onClick={() => onTrain(r.repertoireId!)}>תאמן</button>
          )}
        </div>
      ))}
      <p className="muted">ניקוד % · מספר משחקים. מסומנות באדום: 3 החלשות (מ-{MIN_OPENING_GAMES} משחקים ומעלה).</p>
    </section>
  );
}

function DeepResults({ summary, onDrill }: { summary: ReturnType<typeof summarizeDeep>; onDrill: () => void }) {
  const phaseTotal = Object.values(summary.byPhase).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="deep">
      <div className="tiles">
        {(['blunder', 'mistake', 'inaccuracy'] as const).map((k) => (
          <Tile key={k} label={`${KIND_LABELS[k]} (${(summary.counts[k] / summary.games).toFixed(1)} למשחק)`} value={`${summary.counts[k]}`} />
        ))}
      </div>
      <h3>איפה הטעויות והבלאנדרים</h3>
      {(Object.keys(summary.byPhase) as GamePhase[]).map((p) => (
        <Bar key={p} label={PHASE_LABELS[p]} value={summary.byPhase[p] / phaseTotal} text={`${summary.byPhase[p]}`} />
      ))}
      {summary.worst.length > 0 && (
        <>
          <h3>הטעויות הגדולות</h3>
          <ul className="worst">
            {summary.worst.map((m) => (
              <li key={m.gameUrl + m.fen}>
                מהלך {m.moveNumber}: שיחקת {ltr(m.played)}, עדיף {ltr(m.best)} — איבדת {pct(m.drop)} מסיכויי הניצחון.{' '}
                <a href={m.gameUrl} target="_blank" rel="noreferrer">למשחק</a>
              </li>
            ))}
          </ul>
          <button className="primary" onClick={onDrill}>תרגל את הטעויות האלה</button>
        </>
      )}
    </div>
  );
}

/** Single-series rating line with a hover crosshair + tooltip. */
function RatingChart({ points: raw }: { points: { t: number; r: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // thousands of games -> keep one point per bucket so the line stays readable
  const points = useMemo(() => {
    const step = Math.ceil(raw.length / 300);
    return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  }, [raw]);

  const W = 640, H = 200, L = 44, R = 12, T = 12, B = 24;
  const rs = points.map((p) => p.r);
  const lo = Math.floor(Math.min(...rs) / 50) * 50;
  const hi = Math.ceil(Math.max(...rs) / 50) * 50 || lo + 50;
  const x = (i: number) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (r: number) => T + (1 - (r - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="chart" dir="ltr">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`דירוג מ-${points[0].r} ל-${points[points.length - 1].r}`}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          setHover(Math.round(((px - L) / (W - L - R)) * (points.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[lo, (lo + hi) / 2, hi].map((r) => (
          <g key={r}>
            <line x1={L} x2={W - R} y1={y(r)} y2={y(r)} className="grid" />
            <text x={L - 6} y={y(r) + 4} textAnchor="end" className="axis">{Math.round(r)}</text>
          </g>
        ))}
        <text x={L} y={H - 6} className="axis">{date(points[0].t)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="axis">{date(points[points.length - 1].t)}</text>
        <path d={path} className="line" />
        {h && hover !== null && hover >= 0 && hover < points.length && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />
            <circle cx={x(hover)} cy={y(h.r)} r={4} className="dot" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{h.r}</strong> · {date(h.t)}
        </div>
      )}
    </div>
  );
}

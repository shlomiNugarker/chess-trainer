import { useEffect, useMemo, useRef, useState } from 'react';
import { ChessComError, fetchGames, type GameSummary, type TimeClass } from './chesscom';
import { Engine } from './engine';
import { getAnalysis, saveAnalysis } from './analysisCache';
import { saveMistake } from './mistakes';
import Branches from './Branches';
import GameReview from './GameReview';
import { isReviewed, storedReviews, storedAccuracy } from './gameAnalysis';
import { REPERTOIRES } from './repertoire';
import { withCustom } from './customLines';
import { go, useNav } from './nav';
import { createStore, type Store } from './createStore';
import {
  phaseLabel, reasonLabel, timeClassLabel, MIN_MONTH_GAMES, MIN_OPENING_GAMES, MIN_STRONG_GAMES, SHORT_GAME,
  accuracyByMonth, accuracyTrend, analyzeGame, buildOverview, buildTips, strongestOpenings, summarizeDeep, weakestOpenings,
  type GameAnalysis, type GamePhase, type MonthPoint, type OpeningRow, type Score, type Tip,
} from './reviewStats';
import { ltr } from './chessUtils';
import { useStored } from './storage';
import { formatDate, locale, msg, tr, useLang } from './i18n';

const pct = (n: number) => ltr(`${Math.round(n)}%`);
const date = formatDate;
const kindLabel = (k: 'blunder' | 'mistake' | 'inaccuracy') =>
  ({ blunder: tr('בלאנדרים', 'Blunders'), mistake: tr('טעויות', 'Mistakes'), inaccuracy: tr('אי-דיוקים', 'Inaccuracies') })[k];

type Props = {
  active: boolean; // the tab is showing
  onTrain: (repertoireId: string) => void;
  onDrill: () => void;
  onLearn: (repertoireId: string, moves: string) => void;
};

export default function Review({ active, onTrain, onDrill, onLearn }: Props) {
  const [username, setUsername] = useStored('chesscom-user', '');
  const [input, setInput] = useState(username);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [loading, setLoading] = useState<{ fraction: number; count: number } | null>(null);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState('');
  const [timeClass, setTimeClass] = useState<TimeClass | 'all'>('all');
  const download = useRef(new AbortController());
  const { review: reviewUrl } = useNav();
  const reviewing = useMemo(() => games?.find((g) => g.url === reviewUrl) ?? null, [games, reviewUrl]); // one game, move by move

  const [deepCount, setDeepCount] = useStored('deep-count', 10);
  const [deep, setDeep] = useState<GameAnalysis[] | null>(null);
  const [deepRunning, setDeepRunning] = useState(false);
  const [progress] = useState(() => createStore<Deep | null>(null)); // changes at every position: only its own line follows it
  const setDeepProgress = (p: Deep | null) => {
    progress.set(p);
    setDeepRunning(p !== null);
  };
  const deepRun = useRef<{ engine: Engine; cancelled: boolean } | null>(null);

  useEffect(() => () => deepRun.current?.engine.terminate(), []);

  const load = async (name: string) => {
    const user = name.trim();
    if (!user) return;
    download.current.abort();
    const token = new AbortController();
    download.current = token;
    stopDeep();
    setError('');
    setGames(null);
    setDeep(null);
    go({ review: null });
    setLoading({ fraction: 0, count: 0 });
    try {
      const { games: all, partial } = await fetchGames(user, (fraction, count) => !token.signal.aborted && setLoading({ fraction, count }), token.signal);
      if (token.signal.aborted) return;
      setUsername(user);
      setGames(all);
      setPartial(partial);
      setTimeClass('all');
      // results of an earlier engine pass show at once
      const known = all.slice(-deepCount).reverse().map((g) => getAnalysis(g.url)).filter((a): a is GameAnalysis => !!a);
      if (known.length) setDeep(known);
    } catch (e) {
      if (!token.signal.aborted) setError(e instanceof ChessComError ? e.message : tr('משהו השתבש בטעינת המשחקים.', 'Something went wrong while loading the games.'));
    } finally {
      if (!token.signal.aborted) setLoading(null);
    }
  };

  // the games live only in memory: the first time the tab is opened, load the saved username's games again
  // (past months come from the browser cache, so this is quick)
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!active || autoLoaded.current || !username) return;
    autoLoaded.current = true;
    void load(username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, username]);

  const filtered = useMemo(
    () => (games ?? []).filter((g) => timeClass === 'all' || g.timeClass === timeClass),
    [games, timeClass],
  );
  const overview = useMemo(() => (filtered.length ? buildOverview(filtered) : null), [filtered]);
  // accuracy over time: games reviewed on Chess.com, and games reviewed here (recomputed after a review closes)
  const accuracy = useMemo(() => {
    const chesscom = accuracyByMonth(filtered.filter((g) => g.accuracy !== undefined).map((g) => ({ t: g.endTime, acc: g.accuracy! })));
    const reviews = storedReviews();
    const reps = REPERTOIRES.map(withCustom);
    const ownItems = filtered
      .filter((g) => g.url in reviews)
      .map((g) => ({ t: g.endTime, acc: storedAccuracy(g, reviews[g.url], reps) }))
      .filter((x): x is { t: number; acc: number } => x.acc !== null);
    return { chesscom, own: accuracyByMonth(ownItems, 1), ownGames: ownItems.length };
  }, [filtered, reviewing]); // eslint-disable-line react-hooks/exhaustive-deps
  const deepSummary = useMemo(() => (deep?.length ? summarizeDeep(deep) : null), [deep]);
  // recent games without a stored analysis (deep changes whenever one is added)
  const pending = useMemo(
    () => filtered.slice(-deepCount).filter((g) => !getAnalysis(g.url)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, deepCount, deep],
  );
  const lang = useLang();
  const tips = useMemo(() => (overview ? buildTips(overview, deepSummary) : []), [overview, deepSummary, lang]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // analyzed before: reuse it (its mistakes are already in the drill)
      const known = getAnalysis(recent[i].url);
      if (known) {
        results.push(known);
        setDeep([...results]);
        continue;
      }
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
      saveAnalysis(a);
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

  if (reviewing) {
    return (
      <GameReview
        key={reviewing.url}
        game={reviewing}
        username={username}
        active={active}
        onClose={() => go({ review: null })}
        onLearn={onLearn}
        onDrill={onDrill}
      />
    );
  }

  const openReview = (g: GameSummary) => {
    stopDeep(); // one engine at a time — both would compete for the CPU (the games done so far are kept)
    go({ review: g.url });
    window.scrollTo({ top: 0 });
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
          {tr('שם המשתמש שלך ב-Chess.com', 'Your Chess.com username')}
          <input dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} placeholder="username" autoComplete="off" />
        </label>
        <button className="primary" type="submit" disabled={!input.trim() || !!loading}>
          {games && input.trim().toLowerCase() === username.toLowerCase() ? tr('רענן', 'Refresh') : tr('טען משחקים', 'Load games')}
        </button>
      </form>

      {loading && (
        <div className="card">
          {loading.count
            ? tr(`טוען משחקים… ${loading.count.toLocaleString(locale())}`, msg`Loading games… ${loading.count.toLocaleString(locale())}`)
            : tr('מתחבר ל-Chess.com…', 'Connecting to Chess.com…')}
          <Progress value={loading.fraction} />
        </div>
      )}
      {games && partial && games.length > 0 && (
        <p className="muted small-print">
          {tr(
            `הסקירה מבוססת על ${games.length.toLocaleString(locale())} המשחקים האחרונים (מאז ${date(games[0].endTime)}).`,
            msg`Based on your last ${games.length.toLocaleString(locale())} games (since ${date(games[0].endTime)}).`,
          )}
        </p>
      )}
      {error && <div className="notice">{error}</div>}
      {games && !games.length && <div className="notice">{tr('לא נמצאו משחקי שחמט רגיל למשתמש הזה.', 'No standard chess games found for this user.')}</div>}

      {games && games.length > 0 && <RecentGames games={games} onReview={openReview} />}

      {games && games.length > 0 && overview && (
        <>
          <div className="chips">
            {(['all', 'bullet', 'blitz', 'rapid', 'daily'] as const)
              .filter((tc) => tc === 'all' || games.some((g) => g.timeClass === tc))
              .map((tc) => (
                <button key={tc} className={tc === timeClass ? 'chip active' : 'chip'} aria-pressed={tc === timeClass} onClick={() => setTimeClass(tc)}>
                  {tc === 'all' ? tr('הכל', 'All') : timeClassLabel(tc)}
                </button>
              ))}
          </div>

          <section className="card tips">
            <h2>{tr('3 הדברים הכי חשובים לשפר', 'The 3 most important things to improve')}</h2>
            <ol>
              {tips.map((t) => (
                <li key={t.title}>
                  <strong>{t.title}</strong>
                  <p>{t.text}</p>
                  {t.action && (
                    <button onClick={() => onTip(t)}>
                      {t.action.type === 'train'
                        ? tr('תאמן את הפתיחה', 'Train this opening')
                        : t.action.type === 'drill'
                          ? tr('לתרגול הטעויות', 'Practice the mistakes')
                          : tr('לניתוח המנוע', 'To the engine analysis')}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="tiles">
            <Tile label={tr('משחקים', 'Games')} value={overview.total.games.toLocaleString(locale())} />
            <Tile
              label={tr('ניצחון / תיקו / הפסד', 'Win / draw / loss')}
              // no ltr(): the numbers must read right-to-left in the same order as the label
              value={[overview.total.wins, overview.total.draws, overview.total.losses].map((n) => n.toLocaleString(locale())).join(' / ')}
            />
            <Tile label={tr('ניקוד', 'Score')} value={pct(overview.total.score)} />
            {overview.accuracy && (
              <Tile label={tr(`דיוק ממוצע (${overview.accuracy.games} משחקים שנבדקו)`, msg`Average accuracy (${overview.accuracy.games} reviewed games)`)} value={pct(overview.accuracy.avg)} />
            )}
          </section>

          {overview.ratingSeries && (
            <section className="card">
              <h2>
                {tr(
                  `הדירוג שלך ב${timeClassLabel(overview.ratingSeries.timeClass)} לאורך זמן`,
                  msg`Your ${timeClassLabel(overview.ratingSeries.timeClass).toLowerCase()} rating over time`,
                )}
              </h2>
              <RatingChart points={overview.ratingSeries.points} />
            </section>
          )}

          <AccuracyCard chesscom={accuracy.chesscom} own={accuracy.own} ownGames={accuracy.ownGames} />

          <div className="grid2">
            <section className="card">
              <h2>{tr('לפי צבע', 'By color')}</h2>
              <ScoreRow name={tr('לבן', 'White')} s={overview.byColor.w} />
              <ScoreRow name={tr('שחור', 'Black')} s={overview.byColor.b} />
            </section>
            <section className="card">
              <h2>{tr('לפי קצב', 'By time control')}</h2>
              {overview.byTimeClass.map((t) => (
                <ScoreRow key={t.timeClass} name={`${timeClassLabel(t.timeClass)} · ${t.rating}`} s={t} />
              ))}
            </section>
          </div>

          <Strengths overview={overview} />

          <div className="grid2">
            <OpeningTable title={tr('הפתיחות שלך בלבן', 'Your openings as White')} rows={overview.openings.w} average={overview.byColor.w.score} onTrain={onTrain} />
            <OpeningTable title={tr('הפתיחות שלך בשחור', 'Your openings as Black')} rows={overview.openings.b} average={overview.byColor.b.score} onTrain={onTrain} />
          </div>

          {overview.total.losses > 0 && (
            <section className="card">
              <h2>{tr('איך אתה מפסיד', 'How you lose')}</h2>
              {overview.lossReasons.map((r) => (
                <Bar key={r.reason} label={reasonLabel(r.reason)} value={r.count / overview.total.losses} text={`${r.count}`} />
              ))}
              <p className="muted">
                {pct((overview.shortLosses / overview.total.losses) * 100)}{' '}
                {tr(`מההפסדים נגמרו עד מהלך ${SHORT_GAME}.`, msg`of your losses ended by move ${SHORT_GAME}.`)}
              </p>
            </section>
          )}

          <Branches games={filtered} onLearn={onLearn} onDrill={onDrill} />

          <section className="card" id="deep">
            <h2>{tr('ניתוח מנוע של המשחקים האחרונים', 'Engine analysis of your recent games')}</h2>
            <p className="muted">
              {tr(
                'Stockfish עובר על כל מהלך שלך ומוצא טעויות. כל טעות ובלאנדר נכנסים ל"תרגול ← הטעויות שלי". לוקח 10 עד 30 שניות למשחק; משחק שכבר נותח לא מנותח שוב.',
                'Stockfish goes over each of your moves and finds mistakes. Every mistake and blunder goes to "Practice → My mistakes". It takes 10 to 30 seconds per game; a game already analyzed is not analyzed again.',
              )}
            </p>
            <div className="buttons">
              <select value={deepCount} onChange={(e) => setDeepCount(Number(e.target.value))} disabled={deepRunning}>
                {[5, 10, 20].map((n) => (
                  <option key={n} value={n}>{tr(`${n} משחקים אחרונים`, msg`Last ${n} games`)}</option>
                ))}
              </select>
              {deepRunning ? (
                <button onClick={stopDeep}>{tr('עצור', 'Stop')}</button>
              ) : (
                <button className="primary" onClick={runDeep} disabled={pending === 0 && !!deep?.length}>
                  {pending === 0
                    ? tr('הכל כבר נותח ✓', 'All analyzed ✓')
                    : pending === Math.min(deepCount, filtered.length)
                      ? tr('נתח', 'Analyze')
                      : tr(`נתח ${pending} משחקים חדשים`, msg`Analyze ${pending} new games`)}
                </button>
              )}
            </div>
            <DeepProgress store={progress} />
            {deepSummary && <DeepResults summary={deepSummary} onDrill={onDrill} />}
          </section>
        </>
      )}
    </div>
  );
}

type Deep = { game: number; total: number; pos: number; posTotal: number };

function DeepProgress({ store }: { store: Store<Deep | null> }) {
  const p = store.use();
  if (!p) return null;
  return (
    <div>
      {tr(`משחק ${p.game} מתוך ${p.total}`, msg`Game ${p.game} of ${p.total}`)}
      <Progress value={(p.game - 1 + (p.posTotal ? p.pos / p.posTotal : 0)) / p.total} />
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

/** The latest games, each one a tap away from a move-by-move review. */
function RecentGames({ games, onReview }: { games: GameSummary[]; onReview: (g: GameSummary) => void }) {
  const [shown, setShown] = useState(5);
  const recent = games.slice(-50).reverse();
  const res = (g: GameSummary) =>
    g.result === 'win' ? tr('נ', 'W') : g.result === 'loss' ? tr('ה', 'L') : tr('ת', 'D');
  return (
    <section className="card recent-games">
      <div className="recent-games-head">
        <h2>{tr('סקירת משחק', 'Game review')}</h2>
        <button className="primary" onClick={() => onReview(recent[0])}>{tr('סקור את המשחק האחרון', 'Review my last game')}</button>
      </div>
      <p className="muted">
        {tr(
          'כל מהלך מקבל ציון מהמנוע (ספר, הטוב ביותר, אי-דיוק, טעות, בלאנדר), עם המהלך הטוב והדיוק של שני הצדדים. בלי הגבלה יומית — המנוע רץ אצלך.',
          'Every move gets the engine’s verdict (book, best, inaccuracy, mistake, blunder), with the better move and both players’ accuracy. No daily limit — the engine runs on your device.',
        )}
      </p>
      <ul className="recent-list">
        {recent.slice(0, shown).map((g) => (
          <li key={g.url}>
            <button className="recent-game" onClick={() => onReview(g)}>
              <span className={`result-badge result-${g.result}`}>{res(g)}</span>
              <span className="recent-main">
                <span className="recent-opp">{g.color === 'w' ? '♔' : '♚'} {tr('מול', 'vs')} {g.opponent} <span className="muted">({g.opponentRating})</span></span>
                <span className="muted recent-meta">{date(g.endTime)} · {timeClassLabel(g.timeClass)} · {g.opening}</span>
              </span>
              {isReviewed(g.url) && <span className="pill" title={tr('נסקר — ייפתח מיד', 'Reviewed — opens at once')}>✓</span>}
              <span className="recent-go">{tr('סקור ›', 'Review ›')}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown < recent.length && (
        <button className="link" onClick={() => setShown((n) => Math.min(n + 10, recent.length))}>{tr('עוד משחקים', 'More games')}</button>
      )}
    </section>
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
    <div title={tr(`${s.wins} ניצחונות, ${s.draws} תיקו, ${s.losses} הפסדים`, msg`${s.wins} wins, ${s.draws} draws, ${s.losses} losses`)}>
      <Bar label={name} value={s.score / 100} text={`${pct(s.score)} · ${s.games}`} />
    </div>
  );
}

/** The best opening with each color (enough games, clearly above the user's average with that color). */
function Strengths({ overview }: { overview: ReturnType<typeof buildOverview> }) {
  const sides = (['w', 'b'] as const).map((c) => ({
    c,
    label: c === 'w' ? tr('בלבן', 'As White') : tr('בשחור', 'As Black'),
    avg: overview.byColor[c].score,
    best: strongestOpenings(overview.openings[c], overview.byColor[c].score)[0],
  }));
  if (!sides.some((s) => overview.byColor[s.c].games)) return null;
  return (
    <section className="card strengths">
      <h2>{tr('החוזקות שלך', 'Your strengths')}</h2>
      <ul>
        {sides.map(({ c, label, avg, best }) => (
          <li key={c}>
            <strong>{label}:</strong>{' '}
            {best
              ? tr(
                  `${ltr(best.name)} — ${pct(best.score)} ב-${best.games} משחקים (הממוצע שלך ${label}: ${pct(avg)}).`,
                  msg`${best.name} — ${pct(best.score)} in ${best.games} games (your average ${label.toLowerCase()}: ${pct(avg)}).`,
                )
              : tr(
                  `עוד אין פתיחה שבולטת מעל הממוצע שלך (${pct(avg)}, צריך לפחות ${MIN_STRONG_GAMES} משחקים בפתיחה).`,
                  msg`No opening stands out above your average yet (${pct(avg)}; it takes ${MIN_STRONG_GAMES}+ games in an opening).`,
                )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpeningTable({ title, rows, average, onTrain }: { title: string; rows: OpeningRow[]; average: number; onTrain: (id: string) => void }) {
  const weakest = weakestOpenings(rows).map((r) => r.name);
  const strongest = strongestOpenings(rows, average).map((r) => r.name);
  // the 8 most played, plus any marked opening that is played less (rows come sorted by number of games)
  const shown = rows.filter((r, i) => i < 8 || weakest.includes(r.name) || strongest.includes(r.name));
  const mark = (name: string) => (strongest.includes(name) ? 'opening strong' : weakest.includes(name) ? 'opening weak' : 'opening');
  return (
    <section className="card">
      <h2>{title}</h2>
      {!shown.length && <p className="muted">{tr('אין משחקים.', 'No games.')}</p>}
      {shown.map((r) => (
        <div key={r.name} className={mark(r.name)}>
          <Bar label={r.name} value={r.score / 100} text={`${pct(r.score)} · ${r.games}`} />
          {r.repertoireId && (
            <button className="small" onClick={() => onTrain(r.repertoireId!)}>{tr('תאמן', 'Train')}</button>
          )}
        </div>
      ))}
      <p className="muted">
        {tr(
          `ניקוד % · מספר משחקים. בירוק: 3 החזקות (מ-${MIN_STRONG_GAMES} משחקים, מעל הממוצע שלך: ${pct(average)}). באדום: 3 החלשות (מ-${MIN_OPENING_GAMES} משחקים).`,
          msg`Score % · number of games. In green: the 3 strongest (${MIN_STRONG_GAMES}+ games, above your average of ${pct(average)}). In red: the 3 weakest (${MIN_OPENING_GAMES}+ games).`,
        )}
      </p>
    </section>
  );
}

function DeepResults({ summary, onDrill }: { summary: ReturnType<typeof summarizeDeep>; onDrill: () => void }) {
  const phaseTotal = Object.values(summary.byPhase).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="deep">
      <div className="tiles">
        {(['blunder', 'mistake', 'inaccuracy'] as const).map((k) => (
          <Tile key={k} label={`${kindLabel(k)} (${(summary.counts[k] / summary.games).toFixed(1)} ${tr('למשחק', 'per game')})`} value={`${summary.counts[k]}`} />
        ))}
      </div>
      <h3>{tr('איפה הטעויות והבלאנדרים', 'Where the mistakes and blunders are')}</h3>
      {(Object.keys(summary.byPhase) as GamePhase[]).map((p) => (
        <Bar key={p} label={phaseLabel(p)} value={summary.byPhase[p] / phaseTotal} text={`${summary.byPhase[p]}`} />
      ))}
      {summary.worst.length > 0 && (
        <>
          <h3>{tr('הטעויות הגדולות', 'The biggest mistakes')}</h3>
          <ul className="worst">
            {summary.worst.map((m) => (
              <li key={m.gameUrl + m.fen}>
                {tr(
                  `מהלך ${m.moveNumber}: שיחקת ${ltr(m.played)}, עדיף ${ltr(m.best)} — איבדת ${pct(m.drop)} מסיכויי הניצחון.`,
                  msg`Move ${m.moveNumber}: you played ${m.played}, better was ${m.best} — you lost ${pct(m.drop)} win chance.`,
                )}{' '}
                <a href={m.gameUrl} target="_blank" rel="noreferrer">{tr('למשחק', 'Game')}</a>
              </li>
            ))}
          </ul>
          <button className="primary" onClick={onDrill}>{tr('תרגל את הטעויות האלה', 'Practice these mistakes')}</button>
        </>
      )}
    </div>
  );
}

/** Single-series rating line with a hover crosshair + tooltip. */
/** Accuracy month by month: games reviewed on Chess.com, and games reviewed here. */
/** The chart's width in CSS pixels (640 until measured): charts are drawn at their real size, so the text stays
 * readable on a phone instead of shrinking with the whole drawing. */
function useChartWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width)) || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

function AccuracyCard({ chesscom, own, ownGames }: { chesscom: MonthPoint[]; own: MonthPoint[]; ownGames: number }) {
  if (!chesscom.length && !own.length) return null;
  const trend = accuracyTrend(chesscom.length >= 2 ? chesscom : own);
  const monthName = (p: MonthPoint) => new Date(p.t).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  return (
    <section className="card accuracy-card">
      <h2>{tr('הדיוק שלך לאורך זמן', 'Your accuracy over time')}</h2>
      {trend ? (
        <p className={trend.delta >= 2 ? 'trend up' : trend.delta <= -2 ? 'trend down' : 'trend'}>
          {trend.delta >= 2
            ? tr(
                `${monthName(trend.last)}: ${pct(trend.last.avg)} (${trend.last.n} משחקים) — עלייה של ${ltr(Math.round(trend.delta))} נקודות לעומת הממוצע של החודשים שלפני (${pct(trend.before)}).`,
                msg`${monthName(trend.last)}: ${pct(trend.last.avg)} (${trend.last.n} games) — up ${Math.round(trend.delta)} points from the months before (${pct(trend.before)}).`,
              )
            : trend.delta <= -2
              ? tr(
                  `${monthName(trend.last)}: ${pct(trend.last.avg)} (${trend.last.n} משחקים) — ירידה של ${ltr(Math.round(-trend.delta))} נקודות לעומת הממוצע של החודשים שלפני (${pct(trend.before)}).`,
                  msg`${monthName(trend.last)}: ${pct(trend.last.avg)} (${trend.last.n} games) — down ${Math.round(-trend.delta)} points from the months before (${pct(trend.before)}).`,
                )
              : tr(
                  `${monthName(trend.last)}: ${pct(trend.last.avg)} (${trend.last.n} משחקים) — בערך כמו הממוצע של החודשים שלפני (${pct(trend.before)}).`,
                  msg`${monthName(trend.last)}: ${pct(trend.last.avg)} (${trend.last.n} games) — about the same as the months before (${pct(trend.before)}).`,
                )}
        </p>
      ) : (
        <p className="muted">{tr('עוד אין מספיק חודשים כדי לראות מגמה.', 'Not enough months yet to see a trend.')}</p>
      )}
      <AccuracyChart series={[
        { key: 'chesscom', label: tr('Chess.com (משחקים שסקרת שם)', 'Chess.com (games you reviewed there)'), points: chesscom },
        { key: 'own', label: ownGames === 1 ? tr('הסקירה כאן (משחק אחד)', 'Reviewed here (1 game)') : tr(`הסקירה כאן (${ownGames} משחקים)`, msg`Reviewed here (${ownGames} games)`), points: own },
      ]} />
      <p className="muted">
        {tr(
          `ממוצע לפי חודש. מ-Chess.com נספרים רק חודשים עם ${MIN_MONTH_GAMES} משחקים לפחות. שני המנועים שונים, אז הקווים לא זהים — חשוב הכיוון של כל קו.`,
          msg`Monthly average. Chess.com months count from ${MIN_MONTH_GAMES} games. The two engines differ, so the lines are not identical — what matters is where each one goes.`,
        )}
      </p>
    </section>
  );
}

/** The values' range in whole steps, at least two steps high (one value, or all the same). */
function range(values: number[], step: number, min: number, max: number): [number, number] {
  let lo = Math.floor(Math.min(...values) / step) * step;
  let hi = Math.ceil(Math.max(...values) / step) * step;
  if (hi === lo) [lo, hi] = [lo - step, hi + step];
  return [Math.max(min, lo), Math.min(max, hi)];
}

function AccuracyChart({ series }: { series: { key: string; label: string; points: MonthPoint[] }[] }) {
  const [hover, setHover] = useState<string | null>(null); // a month: the tooltip shows every series in it
  const [ref, W] = useChartWidth();
  const all = series.flatMap((s) => s.points);
  const H = 180, L = 40, R = 12, T = 12, B = 24;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const [lo, hi] = range(all.map((p) => p.avg), 10, 0, 100);
  const x = (t: number) => (t1 === t0 ? (L + W - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (a: number) => T + (1 - (a - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const atHover = hover ? series.map((s) => ({ s, p: s.points.find((p) => p.month === hover) })).filter((x) => x.p) : [];
  const hoverT = atHover[0]?.p?.t;
  const month = (t: number) => new Date(t).toLocaleDateString(locale(), { month: 'short', year: '2-digit' });
  return (
    <>
      <div className="chart" dir="ltr" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('הדיוק שלך לפי חודש', 'Your accuracy by month')} onMouseLeave={() => setHover(null)}>
          {[lo, (lo + hi) / 2, hi].map((a) => (
            <g key={a}>
              <line x1={L} x2={W - R} y1={y(a)} y2={y(a)} className="grid" />
              <text x={L - 6} y={y(a) + 4} textAnchor="end" className="axis">{Math.round(a)}%</text>
            </g>
          ))}
          <text x={L} y={H - 6} className="axis">{month(t0)}</text>
          {t1 !== t0 && <text x={W - R} y={H - 6} textAnchor="end" className="axis">{month(t1)}</text>}
          {series.map((s) => (
            <g key={s.key} className={`acc-${s.key}`}>
              {s.points.length > 1 && <path d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join('')} className="line" />}
              {s.points.map((p) => (
                <circle
                  key={p.month}
                  cx={x(p.t)}
                  cy={y(p.avg)}
                  r={hover === p.month ? 6 : 4}
                  className="dot"
                  onMouseEnter={() => setHover(p.month)}
                  onClick={() => setHover(p.month)}
                />
              ))}
            </g>
          ))}
        </svg>
        {hoverT !== undefined && (
          <div className="tooltip" style={{ left: `${Math.min(85, Math.max(15, (x(hoverT) / W) * 100))}%` }}>
            {month(hoverT)}
            {atHover.map(({ s, p }) => (
              <div key={s.key} className={`legend acc-${s.key}`}>
                <i /><strong>{Math.round(p!.avg)}%</strong> · {p!.n === 1 ? tr('משחק אחד', '1 game') : tr(`${p!.n} משחקים`, msg`${p!.n} games`)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="chart-legend">
        {series.filter((s) => s.points.length).map((s) => (
          <span key={s.key} className={`legend acc-${s.key}`}><i />{s.label}</span>
        ))}
      </div>
    </>
  );
}

function RatingChart({ points: raw }: { points: { t: number; r: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // thousands of games -> keep one point per bucket so the line stays readable
  const points = useMemo(() => {
    const step = Math.ceil(raw.length / 300);
    return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  }, [raw]);

  const [ref, W] = useChartWidth();
  const H = 200, L = 44, R = 12, T = 12, B = 24;
  const rs = points.map((p) => p.r);
  const [lo, hi] = range(rs, 50, 0, Infinity);
  const x = (i: number) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (r: number) => T + (1 - (r - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="chart" dir="ltr" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={tr(`דירוג מ-${points[0].r} ל-${points[points.length - 1].r}`, msg`Rating from ${points[0].r} to ${points[points.length - 1].r}`)}
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import {
  applyUci,
  isCorrect,
  loadPuzzles,
  loadStats,
  markSeen,
  pickNext,
  recordResult,
  themeNames,
  type Puzzle,
  type PuzzleMode,
} from './puzzleData';
import { saveMistake } from './mistakes';
import { DAILY_GOAL, dayStreak, recordPuzzleDay, todayCount, daysLabel } from './daily';
import { useStored } from './storage';
import { tr } from './i18n';
import { BOARD_THEME, GREEN_ARROW, LAST_MOVE, ltr, uciToArrow } from './chessUtils';
import { useClickToMove } from './useClickToMove';
import { playSound, useMoveSound } from './sound';
import { useFitBoard } from './useFitBoard';
import { useSidePanel } from './useSidePanel';

/**
 * intro: the opponent's first move is about to be played · solving: your turn · opponent: their reply is coming
 * solved: done (clean, or after a mistake) · shown: the solution was played out for you
 */
type Status = 'intro' | 'solving' | 'opponent' | 'solved' | 'shown';

const HINT_SQUARE = 'rgba(106, 167, 232, 0.55)';

export default function Puzzles() {
  const [all, setAll] = useState<Puzzle[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useStored<PuzzleMode>('puzzle-mode', 'level');
  const [stats, setStats] = useState(loadStats);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [ply, setPly] = useState(0); // index of the next move in puzzle.moves
  const [status, setStatus] = useState<Status>('intro');
  const [failed, setFailed] = useState(false); // a mistake or "show solution" — rated as not solved
  const [wrong, setWrong] = useState<string | null>(null); // the right move's UCI after a wrong try
  const [hint, setHint] = useState(false);
  const [usedHint, setUsedHint] = useState(false); // solved after a hint: rated half, like a draw
  const [delta, setDelta] = useState<number | null>(null);
  const [today, setToday] = useState(() => todayCount());
  const [goalJustMet, setGoalJustMet] = useState(false);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const start = useCallback((p: Puzzle | undefined) => {
    clearTimers();
    setPuzzle(p ?? null);
    setWrong(null);
    setHint(false);
    setUsedHint(false);
    setFailed(false);
    setDelta(null);
    setGoalJustMet(false);
    setLastMove(null);
    if (!p) return;
    setFen(p.fen);
    setPly(0);
    setStatus('intro');
    later(() => {
      setFen(applyUci(p.fen, p.moves[0]).fen); // the opponent's move that sets up the puzzle
      setLastMove(p.moves[0]);
      setPly(1);
      setStatus('solving');
    }, 600);
  }, []);

  useEffect(() => {
    let alive = true;
    loadPuzzles()
      .then((list) => {
        if (!alive) return;
        setAll(list);
        const s = loadStats();
        start(pickNext(list, mode, s.rating, s.seen));
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
    // first load only; changing the mode picks a new puzzle through changeMode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rate = (p: Puzzle, score: number) => {
    const r = recordResult(p, score);
    setStats(r.stats);
    setDelta(r.delta);
    const n = recordPuzzleDay();
    setToday(n);
    setGoalJustMet(n === DAILY_GOAL);
  };

  /** Fails the puzzle once: the rating goes down, and later tries no longer count. */
  const fail = (p: Puzzle) => {
    if (failed) return;
    setFailed(true);
    rate(p, 0);
  };

  const finish = (p: Puzzle) => {
    setStatus('solved');
    setWrong(null);
    playSound('success', 0.15);
    if (!failed) rate(p, usedHint ? 0.5 : 1);
  };

  const onMove = (from: string, to: string) => {
    if (!puzzle || status !== 'solving') return false;
    const uci = from + to;
    let san: string;
    try {
      san = new Chess(fen).move({ from, to, promotion: 'q' }).san;
    } catch {
      return false;
    }
    if (!isCorrect(puzzle, ply, fen, uci)) {
      playSound('error');
      const right = puzzle.moves[ply];
      setWrong(right);
      if (!failed) {
        // the position comes back in "My mistakes"
        saveMistake({ fen, played: san, correct: applyUci(fen, right).san, source: 'puzzle', repertoire: 'puzzle', puzzleId: puzzle.id });
      }
      fail(puzzle);
      return false;
    }
    // the solution's own move (keeps an under-promotion), or another move that mates
    const played = uci === puzzle.moves[ply].slice(0, 4) ? puzzle.moves[ply] : uci + (san.includes('=') ? 'q' : '');
    const after = applyUci(fen, played).fen;
    setFen(after);
    setLastMove(played);
    setWrong(null);
    setHint(false);
    const next = ply + 1;
    if (next >= puzzle.moves.length || new Chess(after).isCheckmate()) {
      setPly(next);
      finish(puzzle);
      return true;
    }
    setStatus('opponent');
    later(() => {
      setFen(applyUci(after, puzzle.moves[next]).fen);
      setLastMove(puzzle.moves[next]);
      setPly(next + 1);
      setStatus('solving');
    }, 450);
    return true;
  };

  const { onSquareClick, onDrop, clickStyles, clearSelection } = useClickToMove(
    fen,
    (color) => status === 'solving' && !!puzzle && color === solverColor(puzzle),
    onMove,
  );
  const boardRef = useFitBoard<HTMLDivElement>();
  const panelRef = useSidePanel<HTMLElement>();
  useMoveSound(fen);

  const showHint = () => {
    if (!puzzle || status !== 'solving') return;
    setHint(true);
    setUsedHint(true); // solving it now counts half
  };

  /** Plays the rest of the solution move by move. */
  const showSolution = () => {
    if (!puzzle || (status !== 'solving' && status !== 'opponent')) return;
    clearTimers();
    clearSelection();
    fail(puzzle);
    setStatus('shown');
    setWrong(null);
    setHint(false);
    let f = fen;
    puzzle.moves.slice(ply).forEach((m, i) => {
      later(() => {
        f = applyUci(f, m).fen;
        setFen(f);
        setLastMove(m);
        setPly(ply + i + 1);
      }, 500 * (i + 1));
    });
  };

  const nextPuzzle = (m: PuzzleMode = mode) => {
    if (!all) return;
    if (puzzle && (status === 'intro' || status === 'solving') && !failed && ply <= 1) markSeen(puzzle.id); // skipped untried
    const s = loadStats();
    setStats(s);
    start(pickNext(all, m, s.rating, s.seen, puzzle?.id));
  };

  const changeMode = (m: PuzzleMode) => {
    setMode(m);
    nextPuzzle(m);
  };

  const modes: { id: PuzzleMode; label: string }[] = [
    { id: 'level', label: tr('לרמה שלי', 'For my level') },
    { id: 'openings', label: tr('מהפתיחות שלי', 'From my openings') },
    { id: 'mates', label: tr('מטים', 'Mates') },
  ];

  const streakDays = dayStreak();
  const header = (
    <header className="learn-header puzzle-header">
      <div className="chips" role="tablist">
        {modes.map((m) => (
          <button key={m.id} className={m.id === mode ? 'chip active' : 'chip'} onClick={() => changeMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <span className="pill puzzle-rating" title={tr('הדירוג שלך בפאזלים', 'Your puzzle rating')}>
        {tr('דירוג', 'Rating')} <b>{stats.rating}</b>
      </span>
      <span className={today >= DAILY_GOAL ? 'pill daily-pill done' : 'pill daily-pill'} title={tr(`המטרה היומית: ${DAILY_GOAL} פאזלים`, `Daily goal: ${DAILY_GOAL} puzzles`)}>
        🎯 {tr('היום', 'Today')} {Math.min(today, DAILY_GOAL)}/{DAILY_GOAL}
      </span>
      {streakDays > 0 && <span className="pill">🔥 {daysLabel(streakDays)}</span>}
    </header>
  );

  if (loadError) {
    return (
      <div className="card drill-empty">
        <div className="empty-mark" aria-hidden>🧩</div>
        <h2>{tr('לא הצלחתי לטעון את הפאזלים', 'Could not load the puzzles')}</h2>
        <p className="muted">{tr('צריך חיבור לאינטרנט בפעם הראשונה. אחר כך הם עובדים גם בלי.', 'The first time needs an internet connection; after that they work offline too.')}</p>
        <button className="primary" onClick={() => location.reload()}>{tr('נסה שוב', 'Try again')}</button>
      </div>
    );
  }
  if (!all || !puzzle) {
    return (
      <>
        {header}
        <div className="card drill-empty">
          <div className="empty-mark" aria-hidden>🧩</div>
          <p className="muted">{all ? tr('אין פאזלים במצב הזה.', 'No puzzles in this mode.') : tr('טוען פאזלים…', 'Loading puzzles…')}</p>
        </div>
      </>
    );
  }

  const me = solverColor(puzzle);
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) for (const sq of [lastMove.slice(0, 2), lastMove.slice(2, 4)]) squareStyles[sq] = { backgroundColor: LAST_MOVE };
  if (hint && status === 'solving') squareStyles[puzzle.moves[ply].slice(0, 2)] = { backgroundColor: HINT_SQUARE };
  Object.assign(squareStyles, clickStyles);
  const arrows: Arrow[] = wrong ? [uciToArrow(wrong, GREEN_ARROW)] : [];
  const done = status === 'solved' || status === 'shown';
  const themes = themeNames(puzzle);
  const side = me === 'w' ? tr('לבן', 'White') : tr('שחור', 'Black');

  return (
    <>
      {header}
      <main>
        <div className="board-wrap" dir="ltr" ref={boardRef}>
          <div className="board">
            <Chessboard
              options={{
                id: 'puzzle',
                position: fen,
                boardOrientation: me === 'w' ? 'white' : 'black',
                onPieceDrop: ({ sourceSquare, targetSquare }) => onDrop(sourceSquare, targetSquare),
                onSquareClick,
                squareStyles,
                arrows,
                ...BOARD_THEME,
                allowDrawingArrows: false,
                canDragPiece: ({ piece }) => status === 'solving' && piece.pieceType[0] === me,
              }}
            />
          </div>
        </div>
        <aside ref={panelRef} data-puzzle-id={puzzle.id}>
          <div className={done ? 'status status-user' : status === 'solving' ? 'status status-user' : 'status status-opponent'}>
            <span className="status-dot" aria-hidden />
            <span className="status-text">
              {status === 'solved'
                ? failed
                  ? tr('פתרת — אחרי עזרה', 'Solved — with help')
                  : usedHint
                    ? tr('נפתר עם רמז — חצי נקודה', 'Solved with a hint — half credit')
                    : tr('נפתר ✓', 'Solved ✓')
                : status === 'shown'
                  ? tr('זה הפתרון', 'That is the solution')
                  : status === 'solving'
                    ? tr(`מצא את המהלך הטוב ביותר ל${side}`, `Find the best move for ${side}`)
                    : tr('היריב משחק…', 'Opponent is moving…')}
            </span>
            <span className="pill">{tr(`פאזל ${puzzle.rating}`, `Puzzle ${puzzle.rating}`)}</span>
          </div>

          {wrong && status === 'solving' && (
            <div className="card feedback tone-error">
              <strong>{tr('לא המהלך הזה', 'Not that move')}</strong>
              <p className="muted">
                {tr(
                  `החץ הירוק מראה את המהלך הנכון: ${ltr(applyUci(fen, wrong).san)}. שחק אותו כדי להמשיך. העמדה נשמרה ב"הטעויות שלי".`,
                  `The green arrow shows the right move: ${applyUci(fen, wrong).san}. Play it to go on. The position was saved to "My mistakes".`,
                )}
              </p>
            </div>
          )}

          {done && (
            <div className={status === 'solved' && !failed ? 'card notice tone-ok' : 'card notice'}>
              <strong>
                {delta !== null &&
                  (delta >= 0
                    ? tr(`הדירוג שלך: ${stats.rating} (${ltr('+' + delta)})`, `Your rating: ${stats.rating} (+${delta})`)
                    : tr(`הדירוג שלך: ${stats.rating} (${ltr(String(delta))})`, `Your rating: ${stats.rating} (${delta})`))}
              </strong>
              {themes.length > 0 && <p>{tr(`הנושא: ${themes.join(' · ')}`, `Theme: ${themes.join(' · ')}`)}</p>}
              {goalJustMet && (
                <p className="daily-done">
                  {tr(
                    `🎯 המטרה היומית הושגה! 🔥 ${daysLabel(streakDays)} ברצף. אפשר להמשיך או לחזור מחר.`,
                    `🎯 Daily goal reached! 🔥 ${daysLabel(streakDays)} in a row. Keep going, or come back tomorrow.`,
                  )}
                </p>
              )}
            </div>
          )}

          <div className="buttons">
            {done ? (
              <button className="primary" onClick={() => nextPuzzle()}>{tr('הפאזל הבא ›', 'Next puzzle ›')}</button>
            ) : (
              <>
                <button className="ghost" onClick={showHint} disabled={status !== 'solving' || hint}>
                  💡 {tr('רמז', 'Hint')}
                </button>
                <button className="ghost" onClick={showSolution} disabled={status === 'intro'}>
                  {tr('הראה פתרון', 'Show solution')}
                </button>
                <button className="ghost" onClick={() => nextPuzzle()}>{tr('דלג', 'Skip')}</button>
              </>
            )}
          </div>

          <div className="muted puzzle-stats">
            {tr(
              `פתרת ${stats.solved} מתוך ${stats.played}` + (stats.best > 1 ? ` · שיא רצף: ${stats.best}` : ''),
              `Solved ${stats.solved} of ${stats.played}` + (stats.best > 1 ? ` · Best streak: ${stats.best}` : ''),
            )}
            {' · '}
            <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">
              {tr('פאזלים: Lichess', 'Puzzles: Lichess')}
            </a>
          </div>
        </aside>
      </main>
    </>
  );
}

/** The solver plays the side to move after the opponent's first move. */
function solverColor(p: Puzzle): 'w' | 'b' {
  return p.fen.split(' ')[1] === 'w' ? 'b' : 'w';
}

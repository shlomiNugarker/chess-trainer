import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { REPERTOIRES, lineMoves, moveLabel, posKey } from './repertoire';
import { saveMistake } from './mistakes';
import { BLUE_ARROW, BOARD_THEME, GREEN_ARROW, LAST_MOVE, WRONG_MOVE, ltr, uciToArrow } from './chessUtils';
import { useClickToMove } from './useClickToMove';
import { useStored } from './storage';

const START = new Chess().fen();

/** In "test me" mode: what happened on the user's last try. */
type QuizState = { wrong?: { san: string; correctUci: string }; mistakes: number };

/**
 * Study a repertoire line move by move on a board, with the idea of the line and a note on key moves.
 * "Test me" replays the line: the user plays their side, the app plays the other.
 */
export default function Learn({ onTrain }: { onTrain: (repertoireId: string) => void }) {
  const [repId, setRepId] = useStored('learn-repertoire', REPERTOIRES[0].id);
  const rep = REPERTOIRES.find((r) => r.id === repId) ?? REPERTOIRES[0];
  const [storedLine, setLineIdx] = useStored('learn-line', 0);
  const lineIdx = storedLine < rep.lines.length ? storedLine : 0;
  const line = rep.lines[lineIdx];
  const moves = useMemo(() => lineMoves(line.moves), [line]);
  const [ply, setPly] = useState(0); // moves played on the board
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const done = !!quiz && ply >= moves.length; // finished the line in test mode

  const fen = ply === 0 ? START : moves[ply - 1].after;
  const userTurn = fen.split(' ')[1] === rep.userColor;
  const current = ply > 0 ? moves[ply - 1] : null;
  const next = moves[ply];
  const note = current ? line.notes?.[moveLabel(ply - 1, current.san)] : undefined;

  const go = (p: number) => setPly(Math.max(0, Math.min(moves.length, p)));
  const pickLine = (repertoireId: string, idx: number, atPly = 0) => {
    setRepId(repertoireId);
    setLineIdx(idx);
    setPly(atPly);
    setQuiz(null);
  };

  // arrow keys step through the line (not while testing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (quiz || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight') setPly((p) => Math.min(moves.length, p + 1));
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quiz, moves.length]);

  // test mode: the app plays the other side's moves of the line
  useEffect(() => {
    if (!quiz || done || quiz.wrong || userTurn) return;
    const t = setTimeout(() => setPly((p) => p + 1), 450);
    return () => clearTimeout(t);
  }, [quiz, done, userTurn]);

  /** Other lines of this repertoire that reach this same position (also by transposition) and go on differently. */
  const branches = useMemo(() => {
    const here = posKey(fen);
    const out: { lineIdx: number; atPly: number; san: string; name: string }[] = [];
    rep.lines.forEach((l, i) => {
      if (i === lineIdx) return;
      const ms = lineMoves(l.moves);
      for (let k = 0; k < ms.length; k++) {
        if (posKey(ms[k].before) !== here) continue;
        if (ms[k].san !== next?.san) out.push({ lineIdx: i, atPly: k, san: ms[k].san, name: l.name });
        break;
      }
    });
    return out;
  }, [fen, lineIdx, next, rep]);

  const onMove = (from: string, to: string) => {
    if (!quiz || done || quiz.wrong || !userTurn || !next) return false;
    let san: string;
    try {
      san = new Chess(fen).move({ from, to, promotion: 'q' }).san;
    } catch {
      return false;
    }
    if (san === next.san) {
      setPly(ply + 1);
      return true;
    }
    saveMistake({ fen, played: san, correct: next.san, source: 'book', repertoire: rep.id });
    setQuiz({ ...quiz, mistakes: quiz.mistakes + 1, wrong: { san, correctUci: next.from + next.to + (next.promotion ?? '') } });
    return false; // the piece goes back; the right move is shown
  };

  const { onSquareClick, onDrop, clickStyles } = useClickToMove(
    fen,
    (color) => !!quiz && !done && !quiz.wrong && color === rep.userColor,
    onMove,
  );

  const startQuiz = () => {
    setPly(0);
    setQuiz({ mistakes: 0 });
  };

  const arrows: Arrow[] = [];
  if (quiz?.wrong) arrows.push(uciToArrow(quiz.wrong.correctUci, GREEN_ARROW));
  else if (!quiz && next) arrows.push(uciToArrow(next.from + next.to, BLUE_ARROW)); // study: show what comes next

  const squareStyles: Record<string, React.CSSProperties> = { ...clickStyles };
  if (current) {
    squareStyles[current.from] = { background: LAST_MOVE };
    squareStyles[current.to] = { background: LAST_MOVE };
  }
  if (quiz?.wrong && next) squareStyles[next.from] = { background: WRONG_MOVE };

  const lastPly = ply - 1;
  const whose = (i: number) => (i % 2 === 0 ? 'w' : 'b') === rep.userColor;

  return (
    <div className="learn">
      <header className="learn-header">
        <div className="chips" role="tablist">
          {REPERTOIRES.map((r) => (
            <button
              key={r.id}
              className={r.id === rep.id ? 'chip active' : 'chip'}
              onClick={() => pickLine(r.id, 0)}
            >
              {r.name}
            </button>
          ))}
        </div>
        <select value={lineIdx} onChange={(e) => pickLine(rep.id, Number(e.target.value))} aria-label="קו">
          {rep.lines.map((l, i) => (
            <option key={i} value={i}>
              {l.name} · {Math.ceil(l.moves.split(/\s+/).length / 2)} מהלכים
            </option>
          ))}
        </select>
      </header>

      <main>
        <div className="board-wrap" dir="ltr">
          <div className="board">
            <Chessboard
              options={{
                id: 'learn',
                position: fen,
                boardOrientation: rep.userColor === 'w' ? 'white' : 'black',
                onPieceDrop: ({ sourceSquare, targetSquare }) => onDrop(sourceSquare, targetSquare),
                onSquareClick,
                arrows,
                squareStyles,
                ...BOARD_THEME,
                allowDrawingArrows: false,
                canDragPiece: ({ piece }) =>
                  !!quiz && !done && !quiz.wrong && piece.pieceType[0] === rep.userColor,
              }}
            />
          </div>
        </div>

        <aside>
          {quiz ? (
            <div className={quiz.wrong ? 'status status-paused' : userTurn || done ? 'status status-user' : 'status status-opponent'}>
              <span className="status-dot" aria-hidden />
              <span className="status-text">
                {done
                  ? `סיימת את הקו! ${quiz.mistakes ? `${quiz.mistakes} טעויות` : 'בלי טעויות ✓'}`
                  : quiz.wrong
                    ? 'לא המהלך של הקו'
                    : userTurn
                      ? 'שחק את המהלך הבא בקו'
                      : 'היריב משחק…'}
              </span>
              <span className="pill">בחינה · {Math.min(ply, moves.length)}/{moves.length}</span>
            </div>
          ) : (
            <div className="card learn-move">
              <div className="learn-move-head">
                <strong>{current ? `${moveLabel(ply - 1, current.san)}` : 'עמדת הפתיחה'}</strong>
                {current && <span className="pill">{whose(ply - 1) ? 'המהלך שלך' : 'היריב'}</span>}
              </div>
              <p>{note ?? (current ? '' : line.idea)}</p>
              {next && <p className="muted">הבא: {ltr(moveLabel(ply, next.san))} — החץ הכחול מראה אותו.</p>}
              {!next && <p className="muted">סוף הקו.</p>}
            </div>
          )}

          {quiz?.wrong && (
            <div className="card feedback tone-error">
              <strong>שיחקת {ltr(quiz.wrong.san)}</strong>
              <p>בקו משחקים כאן {ltr(next ? next.san : '')}. החץ הירוק מראה אותו. העמדה נשמרה לחזרה.</p>
              <div className="buttons">
                <button className="primary" onClick={() => setQuiz({ ...quiz, wrong: undefined })}>↩ נסה שוב</button>
              </div>
            </div>
          )}

          {done && (
            <div className="card notice tone-ok">
              <p>{line.idea}</p>
              <div className="buttons">
                <button className="primary" onClick={startQuiz}>↻ שוב</button>
                {lineIdx + 1 < rep.lines.length && (
                  <button className="ghost" onClick={() => pickLine(rep.id, lineIdx + 1)}>הקו הבא</button>
                )}
              </div>
            </div>
          )}

          {quiz ? (
            <div className="actions actions-2">
              <button onClick={() => setQuiz(null)}>
                <span className="icon" aria-hidden>📖</span>חזרה ללימוד
              </button>
              <button onClick={() => onTrain(rep.id)}>
                <span className="icon" aria-hidden>♟</span>תרגל במשחק
              </button>
            </div>
          ) : (
            <>
              <div className="stepper">
                <button onClick={() => go(0)} disabled={ply === 0} aria-label="להתחלה">⏮</button>
                <button onClick={() => go(ply - 1)} disabled={ply === 0}>‹ הקודם</button>
                <button className="primary" onClick={() => go(ply + 1)} disabled={!next}>הבא ›</button>
                <button onClick={() => go(moves.length)} disabled={!next} aria-label="לסוף">⏭</button>
              </div>
              <div className="actions actions-2">
                <button onClick={startQuiz}>
                  <span className="icon" aria-hidden>🎯</span>בחן אותי על הקו
                </button>
                <button onClick={() => onTrain(rep.id)}>
                  <span className="icon" aria-hidden>♟</span>תרגל במשחק
                </button>
              </div>
            </>
          )}

          <ol className="moves" dir="ltr">
            {moves.map((_, i) =>
              i % 2 === 0 ? (
                <li key={i}>
                  <span className="move-no">{i / 2 + 1}.</span>
                  {[i, i + 1].map((j) =>
                    moves[j] ? (
                      <button
                        key={j}
                        className={`move${j === lastPly ? ' last' : ''}${whose(j) ? ' mine' : ''}${line.notes?.[moveLabel(j, moves[j].san)] ? ' noted' : ''}`}
                        onClick={() => !quiz && go(j + 1)}
                        disabled={!!quiz}
                      >
                        {quiz && j >= ply ? '•••' : moves[j].san}
                      </button>
                    ) : (
                      <span key={j} />
                    ),
                  )}
                </li>
              ) : null,
            )}
          </ol>

          {!quiz && branches.length > 0 && (
            <div className="card branches">
              <h3>מכאן בקווים אחרים</h3>
              <div className="chips">
                {branches.map((b) => (
                  <button key={b.lineIdx} className="chip" onClick={() => pickLine(rep.id, b.lineIdx, b.atPly)}>
                    {ltr(moveLabel(b.atPly, b.san))} · {b.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!quiz && line.idea && current && (
            <div className="card idea">
              <h3>הרעיון של הקו</h3>
              <p>{line.idea}</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

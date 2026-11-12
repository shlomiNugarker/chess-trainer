import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { REPERTOIRES, lineMoves, lineText, moveLabel, posKey, repName } from './repertoire';
import { tr, useLang } from './i18n';
import { dueMistakes, saveMistake } from './mistakes';
import { BLUE_ARROW, BOARD_THEME, GREEN_ARROW, LAST_MOVE, WRONG_MOVE, ltr, uciToArrow } from './chessUtils';
import { useClickToMove } from './useClickToMove';
import { useFitBoard } from './useFitBoard';
import { useStored } from './storage';
import { hasAnyMastery, isMastered, loadMastery, recordRun } from './mastery';

const START = new Chess().fen();

/** In "test me" mode: what happened on the user's last try. */
type QuizState = { wrong?: { san: string; correctUci: string }; mistakes: number };

/**
 * Study a repertoire line move by move on a board, with the idea of the line and a note on key moves.
 * "Test me" replays the line: the user plays their side, the app plays the other.
 */
type Props = { onTrain: (repertoireId: string) => void; onDrill: () => void };

export default function Learn({ onTrain, onDrill }: Props) {
  const [repId, setRepId] = useStored('learn-repertoire', REPERTOIRES[0].id);
  const rep = REPERTOIRES.find((r) => r.id === repId) ?? REPERTOIRES[0];
  const [storedLine, setLineIdx] = useStored('learn-line', 0);
  const lineIdx = storedLine < rep.lines.length ? storedLine : 0;
  const line = rep.lines[lineIdx];
  const moves = useMemo(() => lineMoves(line.moves), [line]);
  const [ply, setPly] = useState(0); // moves played on the board
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const done = !!quiz && ply >= moves.length; // finished the line in test mode
  const [masteryVersion, setMasteryVersion] = useState(0); // bump to re-read the store
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mastery = useMemo(() => loadMastery(rep.id), [rep.id, masteryVersion]);
  const masteredCount = rep.lines.filter((l) => isMastered(mastery[l.name])).length;
  const [guideDismissed, setGuideDismissed] = useStored('guide-dismissed', false);
  const showGuide = !guideDismissed && !hasAnyMastery();
  // "today": the one or two things worth doing now, one tap each
  const due = dueMistakes().length;
  const firstToLearn = rep.lines.findIndex((l) => !isMastered(mastery[l.name]));
  const nextToLearn = [...rep.lines.keys()]
    .map((k) => (lineIdx + 1 + k) % rep.lines.length)
    .find((i) => i !== lineIdx && !isMastered(mastery[rep.lines[i].name]));

  const fen = ply === 0 ? START : moves[ply - 1].after;
  const userTurn = fen.split(' ')[1] === rep.userColor;
  const current = ply > 0 ? moves[ply - 1] : null;
  const next = moves[ply];
  const lang = useLang();
  const text = lineText(rep, line); // name, idea and notes in the current language
  const note = current ? text.notes[moveLabel(ply - 1, current.san)] : undefined;

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

  /** Test mode: play the next move of the line; finishing the line records the run. */
  const advance = (mistakes: number) => {
    const np = ply + 1;
    setPly(np);
    if (np === moves.length) {
      recordRun(rep.id, line.name, mistakes);
      setMasteryVersion((v) => v + 1);
    }
  };

  // test mode: the app plays the other side's moves of the line
  useEffect(() => {
    if (!quiz || done || quiz.wrong || userTurn) return;
    const t = setTimeout(() => advance(quiz.mistakes), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, done, userTurn, ply]);

  /** Other lines of this repertoire that reach this same position (also by transposition) and go on differently. */
  const branches = useMemo(() => {
    const here = posKey(fen);
    const out: { lineIdx: number; atPly: number; san: string; name: string }[] = [];
    rep.lines.forEach((l, i) => {
      if (i === lineIdx) return;
      const ms = lineMoves(l.moves);
      for (let k = 0; k < ms.length; k++) {
        if (posKey(ms[k].before) !== here) continue;
        if (ms[k].san !== next?.san) out.push({ lineIdx: i, atPly: k, san: ms[k].san, name: lineText(rep, l).name });
        break;
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, lineIdx, next, rep, lang]);

  const onMove = (from: string, to: string) => {
    if (!quiz || done || quiz.wrong || !userTurn || !next) return false;
    let san: string;
    try {
      san = new Chess(fen).move({ from, to, promotion: 'q' }).san;
    } catch {
      return false;
    }
    if (san === next.san) {
      advance(quiz.mistakes);
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
  const boardRef = useFitBoard<HTMLDivElement>();

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
      {showGuide && (
        <div className="card guide">
          <strong>{tr('איך לומדים כאן', 'How to learn here')}</strong>
          <ol>
            <li><b>{tr('למד', 'Learn')}</b> — {tr('עבור על קו מהלך אחר מהלך וקרא למה משחקים כל מהלך.', 'step through a line move by move and read why each move is played.')}</li>
            <li><b>{tr('בחן אותי', 'Test me')}</b> — {tr('שחק את הקו בעצמך עד שאין טעויות (✓).', 'play the line yourself until there are no mistakes (✓).')}</li>
            <li><b>{tr('שחק', 'Play')}</b> — {tr('באימון מול המחשב; כל סטייה מהקו נעצרת ומתוקנת.', 'train against the computer; every step off the line is stopped and corrected.')}</li>
            <li><b>{tr('חזרה', 'Review')}</b> — {tr('כל יום כמה דקות על העמדות שטעית בהן.', 'a few minutes a day on the positions you got wrong.')}</li>
          </ol>
          <button className="ghost small" onClick={() => setGuideDismissed(true)}>{tr('הבנתי', 'Got it')}</button>
        </div>
      )}

      {!showGuide && !quiz && (
        <div className="today">
          <span className="today-title">{tr('היום', 'Today')}</span>
          {due > 0 && (
            <button onClick={onDrill}>↻ {tr(`חזרה על ${due} עמדות`, `Review ${due} positions`)}</button>
          )}
          {firstToLearn === lineIdx ? (
            <button className="primary" onClick={startQuiz}>🎯 {tr('בחן אותי על הקו הזה', 'Test me on this line')}</button>
          ) : firstToLearn >= 0 ? (
            <button className="primary" onClick={() => pickLine(rep.id, firstToLearn)}>
              📖 {tr('ללמוד:', 'Learn:')} {lineText(rep, rep.lines[firstToLearn]).name}
            </button>
          ) : (
            <button className="primary" onClick={() => onTrain(rep.id)}>♟ {tr('שולט בכל הקווים — משחק אימון', 'All lines mastered — training game')}</button>
          )}
        </div>
      )}

      <header className="learn-header">
        <div className="chips" role="tablist">
          {REPERTOIRES.map((r) => (
            <button
              key={r.id}
              className={r.id === rep.id ? 'chip active' : 'chip'}
              onClick={() => pickLine(r.id, 0)}
            >
              {repName(r)}
            </button>
          ))}
        </div>
        <span className="pill progress-pill" title={tr('קווים שעברת בבחינה בלי טעויות', 'Lines you passed in a test with no mistakes')}>
          {tr(`שולט ב-${masteredCount} מתוך ${rep.lines.length}`, `Mastered ${masteredCount} of ${rep.lines.length}`)}
        </span>
        <select value={lineIdx} onChange={(e) => pickLine(rep.id, Number(e.target.value))} aria-label={tr('קו', 'Line')}>
          {rep.lines.map((l, i) => (
            <option key={i} value={i}>
              {isMastered(mastery[l.name]) ? '✓ ' : ''}
              {lineText(rep, l).name} ({Math.ceil(l.moves.split(/\s+/).length / 2)} {tr('מהלכים', 'moves')})
            </option>
          ))}
        </select>
      </header>

      <main>
        <div className="board-wrap" dir="ltr" ref={boardRef}>
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
                  ? tr(
                      `סיימת את הקו! ${quiz.mistakes ? `${quiz.mistakes} טעויות` : 'בלי טעויות ✓'}`,
                      `Line finished! ${quiz.mistakes ? `${quiz.mistakes} mistakes` : 'No mistakes ✓'}`,
                    )
                  : quiz.wrong
                    ? tr('לא המהלך של הקו', 'Not the move of the line')
                    : userTurn
                      ? tr('שחק את המהלך הבא בקו', 'Play the next move of the line')
                      : tr('היריב משחק…', 'Opponent is moving…')}
              </span>
              <span className="pill">{tr('בחינה', 'Test')} · {Math.min(ply, moves.length)}/{moves.length}</span>
            </div>
          ) : (
            <div className="card learn-move">
              <div className="learn-move-head">
                <strong>{current ? `${moveLabel(ply - 1, current.san)}` : tr('עמדת הפתיחה', 'Starting position')}</strong>
                {current && <span className="pill">{whose(ply - 1) ? tr('המהלך שלך', 'Your move') : tr('היריב', 'Opponent')}</span>}
              </div>
              <p>{note ?? (current ? '' : text.idea)}</p>
              {next && (
                <p className="muted">
                  {tr('הבא:', 'Next:')} {ltr(moveLabel(ply, next.san))} — {tr('החץ הכחול מראה אותו.', 'the blue arrow shows it.')}
                </p>
              )}
              {!next && <p className="muted">{tr('סוף הקו.', 'End of the line.')}</p>}
            </div>
          )}

          {quiz?.wrong && (
            <div className="card feedback tone-error">
              <strong>{tr('שיחקת', 'You played')} {ltr(quiz.wrong.san)}</strong>
              <p>
                {tr(
                  `בקו משחקים כאן ${ltr(next ? next.san : '')}. החץ הירוק מראה אותו. העמדה נשמרה לחזרה.`,
                  `The line plays ${next ? next.san : ''} here. The green arrow shows it. The position was saved for review.`,
                )}
              </p>
              <div className="buttons">
                <button className="primary" onClick={() => setQuiz({ ...quiz, wrong: undefined })}>↩ {tr('נסה שוב', 'Try again')}</button>
              </div>
            </div>
          )}

          {done && quiz && (
            <div className={quiz.mistakes ? 'card notice tone-warn' : 'card notice tone-ok'}>
              <strong>
                {quiz.mistakes
                  ? tr('כמעט! עבור על הקו פעם נוספת בלי טעויות כדי לסמן אותו ✓', 'Almost! Go through the line once more without mistakes to mark it ✓')
                  : nextToLearn === undefined
                    ? tr(
                      `שולט בכל הקווים של ${repName(rep)} 🎉 — עכשיו תרגל אותם במשחק.`,
                      `You master all lines of ${repName(rep)} 🎉 — now practice them in a game.`,
                    )
                    : tr('שולט בקו ✓', 'Line mastered ✓')}
              </strong>
              <p>{text.idea}</p>
              <div className="buttons">
                <button className={quiz.mistakes ? 'primary' : 'ghost'} onClick={startQuiz}>↻ {tr('שוב', 'Again')}</button>
                {nextToLearn !== undefined && (
                  <button className={quiz.mistakes ? 'ghost' : 'primary'} onClick={() => pickLine(rep.id, nextToLearn)}>
                    {tr('הקו הבא ללמוד ›', 'Next line to learn ›')}
                  </button>
                )}
                {nextToLearn === undefined && !quiz.mistakes && (
                  <button className="primary" onClick={() => onTrain(rep.id)}>♟ {tr('תרגל במשחק', 'Practice in a game')}</button>
                )}
              </div>
            </div>
          )}

          {quiz ? (
            <div className="actions actions-2">
              <button onClick={() => setQuiz(null)}>
                <span className="icon" aria-hidden>📖</span>{tr('חזרה ללימוד', 'Back to study')}
              </button>
              <button onClick={() => onTrain(rep.id)}>
                <span className="icon" aria-hidden>♟</span>{tr('תרגל במשחק', 'Practice in a game')}
              </button>
            </div>
          ) : (
            <>
              <div className="stepper">
                <button onClick={() => go(0)} disabled={ply === 0} aria-label={tr('להתחלה', 'To the start')}>⏮</button>
                <button onClick={() => go(ply - 1)} disabled={ply === 0}>‹ {tr('הקודם', 'Previous')}</button>
                <button className="primary" onClick={() => go(ply + 1)} disabled={!next}>{tr('הבא', 'Next')} ›</button>
                <button onClick={() => go(moves.length)} disabled={!next} aria-label={tr('לסוף', 'To the end')}>⏭</button>
              </div>
              <div className="actions actions-2">
                <button onClick={startQuiz}>
                  <span className="icon" aria-hidden>🎯</span>{tr('בחן אותי על הקו', 'Test me on this line')}
                </button>
                <button onClick={() => onTrain(rep.id)}>
                  <span className="icon" aria-hidden>♟</span>{tr('תרגל במשחק', 'Practice in a game')}
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
                        className={`move${j === lastPly ? ' last' : ''}${whose(j) ? ' mine' : ''}${text.notes[moveLabel(j, moves[j].san)] ? ' noted' : ''}`}
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
              <h3>{tr('מכאן בקווים אחרים', 'From here in other lines')}</h3>
              <div className="chips">
                {branches.map((b) => (
                  <button key={b.lineIdx} className="chip" onClick={() => pickLine(rep.id, b.lineIdx, b.atPly)}>
                    {ltr(moveLabel(b.atPly, b.san))} · {b.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!quiz && text.idea && current && (
            <div className="card idea">
              <h3>{tr('הרעיון של הקו', 'The idea of the line')}</h3>
              <p>{text.idea}</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

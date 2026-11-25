import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { explanationsNote, lineId, movesOf, REPERTOIRES, lineMoves, lineText, moveLabel, posKey, repName } from './repertoire';
import { importPgn, removeCustomLine, useRepertoire, type ImportResult } from './customLines';
import { hasExplanations, msg, tr, useLang } from './i18n';
import { dueMistakes, loadMistakes, saveMistake, useMistakeCount } from './mistakes';
import { dialogOpen } from './useDialog';
import { lineStats } from './lineStats';
import { BLUE_ARROW, BOARD_THEME, GREEN_ARROW, LAST_MOVE, WRONG_MOVE, ltr, uciToArrow } from './chessUtils';
import { useClickToMove } from './useClickToMove';
import { playSound, useMoveSound } from './sound';
import { DAILY_GOAL, dayStreak, todayCount, daysLabel } from './daily';
import { useScrollToMove } from './useScrollToMove';
import { useFitBoard } from './useFitBoard';
import { useSidePanel } from './useSidePanel';
import { useStored } from './storage';
import { hasAnyMastery, isMastered, loadMastery, recordRun } from './mastery';
import { useHiddenRepertoires } from './hiddenReps';

const START = new Chess().fen();

/** In "test me" mode: what happened on the user's last try. */
type QuizState = { wrong?: { san: string; to: string; correctUci: string }; mistakes: number };

/**
 * Study a repertoire line move by move on a board, with the idea of the line and a note on key moves.
 * "Test me" replays the line: the user plays their side, the app plays the other.
 */
type Props = { onTrain: (repertoireId: string) => void; onDrill: () => void; onPuzzles: () => void };

const dueCount = () => dueMistakes().length;

export default function Learn({ onTrain, onDrill, onPuzzles }: Props) {
  const [storedRepId, setRepId] = useStored('learn-repertoire', REPERTOIRES[0].id);
  const { hidden, visible, toggle: toggleHidden } = useHiddenRepertoires();
  const [manageOpen, setManageOpen] = useState(false);
  // a hidden repertoire is not studied here: fall back to the first one shown
  const repId = visible.some((r) => r.id === storedRepId) ? storedRepId : visible[0].id;
  const rep = useRepertoire(repId); // includes the branches added from your games
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
  const masteredCount = rep.lines.filter((l) => isMastered(mastery[lineId(l)])).length;
  const [statsOpen, setStatsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [imported, setImported] = useState<ImportResult[]>([]);
  // re-read after every test try too (each wrong move is saved as a mistake)
  const stats = useMemo(() => (statsOpen ? lineStats(rep, mastery, loadMistakes()) : []), [statsOpen, rep, mastery, quiz]); // eslint-disable-line react-hooks/exhaustive-deps
  const [guideDismissed, setGuideDismissed] = useStored('guide-dismissed', false);
  const anyMastery = useMemo(hasAnyMastery, [masteryVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const showGuide = !guideDismissed && !anyMastery;
  // "today": the one or two things worth doing now, one tap each
  const due = useMistakeCount(dueCount);
  const [puzzlesToday, streakDays] = useMemo(() => [todayCount(), dayStreak()], []); // they change on another screen
  const firstToLearn = rep.lines.findIndex((l) => !isMastered(mastery[lineId(l)]));
  const nextToLearn = [...rep.lines.keys()]
    .map((k) => (lineIdx + 1 + k) % rep.lines.length)
    .find((i) => i !== lineIdx && !isMastered(mastery[lineId(rep.lines[i])]));

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
      if (quiz || dialogOpen() || (e.target as HTMLElement).closest('input, select, textarea')) return;
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
      recordRun(rep.id, lineId(line), mistakes);
      if (!mistakes) playSound('success', 0.15);
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
      const ms = movesOf(l);
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
    playSound('error');
    setQuiz({ ...quiz, mistakes: quiz.mistakes + 1, wrong: { san, to, correctUci: next.from + next.to + (next.promotion ?? '') } });
    return false; // the piece goes back; the right move is shown
  };

  const { onSquareClick, onDrop, clickStyles } = useClickToMove(
    fen,
    (color) => !!quiz && !done && !quiz.wrong && color === rep.userColor,
    onMove,
  );
  const boardRef = useFitBoard<HTMLDivElement>();
  const panelRef = useSidePanel<HTMLElement>();
  const movesRef = useScrollToMove<HTMLOListElement>(`${lineIdx}:${ply}`);
  useMoveSound(fen);

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
  if (quiz?.wrong) squareStyles[quiz.wrong.to] = { background: WRONG_MOVE };

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
          {streakDays > 0 && <span className="pill">🔥 {daysLabel(streakDays)}</span>}
          {due > 0 && (
            <button onClick={onDrill}>↻ {due === 1 ? tr('חזרה על עמדה אחת', 'Review 1 position') : tr(`חזרה על ${due} עמדות`, msg`Review ${due} positions`)}</button>
          )}
          <button onClick={onPuzzles} className={puzzlesToday >= DAILY_GOAL ? 'daily-btn done' : 'daily-btn'}>
            🧩 {puzzlesToday >= DAILY_GOAL
              ? tr(`${DAILY_GOAL} פאזלים ✓`, msg`${DAILY_GOAL} puzzles ✓`)
              : tr(`פאזלים ${puzzlesToday}/${DAILY_GOAL}`, msg`Puzzles ${puzzlesToday}/${DAILY_GOAL}`)}
          </button>
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
        <div className="chips" role="group" aria-label={tr('פתיחה', 'Opening')}>
          {visible.map((r) => (
            <button
              key={r.id}
              className={r.id === rep.id ? 'chip active' : 'chip'}
              aria-pressed={r.id === rep.id}
              onClick={() => pickLine(r.id, 0)}
            >
              {repName(r)}
            </button>
          ))}
          <button
            className="chip manage-chip"
            aria-expanded={manageOpen}
            onClick={() => setManageOpen((o) => !o)}
            title={tr('בחר אילו פתיחות להציג', 'Choose which openings to show')}
            aria-label={tr('בחר אילו פתיחות להציג', 'Choose which openings to show') + (hidden.length ? ` (${tr(`${hidden.length} מוסתרות`, msg`${hidden.length} hidden`)})` : '')}
          >
            <span aria-hidden="true">⚙</span>{hidden.length ? ` ${tr(`${hidden.length} מוסתרות`, msg`${hidden.length} hidden`)}` : ''}
          </button>
        </div>
        <button
          className="pill progress-pill"
          aria-expanded={statsOpen}
          onClick={() => setStatsOpen((o) => !o)}
          title={tr('קווים שעברת בבחינה בלי טעויות — לחץ לפירוט לפי קו', 'Lines you passed in a test with no mistakes — tap for each line')}
        >
          {tr(`שולט ב-${masteredCount} מתוך ${rep.lines.length}`, msg`Mastered ${masteredCount} of ${rep.lines.length}`)} {statsOpen ? '▴' : '▾'}
        </button>
        <select value={lineIdx} onChange={(e) => pickLine(rep.id, Number(e.target.value))} aria-label={tr('קו', 'Line')}>
          {rep.lines.map((l, i) => (
            <option key={i} value={i}>
              {isMastered(mastery[lineId(l)]) ? '✓ ' : ''}
              {lineText(rep, l).name} ({Math.ceil(l.moves.split(/\s+/).length / 2)} {tr('מהלכים', 'moves')})
            </option>
          ))}
        </select>
        {line.custom && (
          <button
            className="link remove-branch"
            onClick={() => {
              removeCustomLine(rep.id, line.moves);
              pickLine(rep.id, 0);
            }}
          >
            {tr('הסר את הענף', 'Remove this branch')}
          </button>
        )}
        <button className="link import-link" aria-expanded={importOpen} onClick={() => setImportOpen((o) => !o)}>
          ＋ {tr('ייבא קו (PGN)', 'Import a line (PGN)')}
        </button>
      </header>

      {manageOpen && (
        <section className="card manage-card">
          <h3>{tr('אילו פתיחות להציג', 'Which openings to show')}</h3>
          <p className="muted">
            {tr(
              'פתיחה מוסתרת לא מופיעה כאן, בבחירת הפתיחה באימון וב"הטעויות שלי". שום דבר לא נמחק — אפשר להחזיר אותה בכל רגע.',
              'A hidden opening doesn’t appear here, in the training opening picker or in My mistakes. Nothing is deleted — you can show it again any time.',
            )}
          </p>
          {REPERTOIRES.map((r) => {
            const shown = !hidden.includes(r.id);
            return (
              <label key={r.id} className="manage-row">
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={shown && visible.length === 1}
                  onChange={() => toggleHidden(r.id)}
                />
                {repName(r)}
              </label>
            );
          })}
        </section>
      )}

      {importOpen && (
        <section className="card import-card">
          <h3>{tr(`ייבוא קו ל${repName(rep)}`, msg`Import a line into ${repName(rep)}`)}</h3>
          <p className="muted">
            {tr(
              'הדבק PGN (אפשר כמה משחקים) או מהלכים כמו 1.e4 c6 2.d4 d5. נכנס רק הקו הראשי; כל קו נבדק שהוא לא סותר את הרפרטואר, ונוסף כענף ★.',
              'Paste a PGN (several games are fine) or moves like 1.e4 c6 2.d4 d5. Only the main line is used; each line is checked against your repertoire and added as a ★ branch.',
            )}
          </p>
          <textarea dir="ltr" rows={4} value={pgnText} onChange={(e) => setPgnText(e.target.value)} placeholder="1.e4 c6 2.d4 d5 3.Nc3 dxe4 ..." />
          <div className="buttons">
            <button
              className="primary"
              disabled={!pgnText.trim()}
              onClick={() => {
                const r = importPgn(rep.id, pgnText);
                setImported(r);
                if (r.some((x) => x.ok)) setPgnText('');
              }}
            >
              {tr('ייבא', 'Import')}
            </button>
          </div>
          {imported.length > 0 && (
            <ul className="import-results">
              {imported.map((r, i) => (
                <li key={i} className={r.ok ? 'ok' : 'warn'}>{r.ok ? '✓' : '✕'} {r.text}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {statsOpen && (
        <section className="card line-stats">
          <h3>{tr('איך הולך לך בכל קו', 'How each line is going')}</h3>
          <ul>
            {rep.lines.map((l, i) => {
              const st = stats[i];
              if (!st) return null;
              return (
                <li key={lineId(l)}>
                  <button className="line-stats-name" onClick={() => pickLine(rep.id, i)}>
                    {isMastered(mastery[lineId(l)]) ? '✓ ' : ''}
                    {lineText(rep, l).name}
                  </button>
                  <span className={st.rate === null ? 'muted' : st.rate >= 70 ? 'rate good' : st.rate >= 40 ? 'rate mid' : 'rate low'}>
                    {st.rate === null
                      ? tr('עוד לא נבחנת', 'Not tested yet')
                      : tr(`${st.rate}% · ${st.clean} מתוך ${st.tries} בלי טעויות`, msg`${st.rate}% · ${st.clean} of ${st.tries} clean`)}
                  </span>
                  {st.hardest && (
                    <button className="link hardest" onClick={() => pickLine(rep.id, i, st.hardest!.ply)}>
                      {tr('הכי קשה:', 'Hardest:')} <span dir="ltr">{st.hardest.label}</span>{' '}
                      {tr(`(טעית ${st.hardest.misses === 1 ? 'פעם אחת' : `${st.hardest.misses} פעמים`})`, msg`(missed ${st.hardest.misses}×)`)}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted">
            {tr(
              'האחוז הוא מתוך הבחינות ("בחן אותי"). "הכי קשה" הוא המהלך שטעית בו הכי הרבה — באימון או בבחינה; לחיצה עליו פותחת את הקו בדיוק שם.',
              'The rate is from your tests ("Test me"). "Hardest" is the move you missed most — in training or in tests; tap it to open the line right there.',
            )}
          </p>
        </section>
      )}

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

        <aside ref={panelRef}>
          {quiz ? (
            <div className={quiz.wrong ? 'status status-paused' : userTurn || done ? 'status status-user' : 'status status-opponent'}>
              <span className="status-dot" aria-hidden />
              <span className="status-text">
                {done
                  ? quiz.mistakes
                    ? tr(`סיימת את הקו! ${quiz.mistakes} טעויות`, msg`Line finished! ${quiz.mistakes} mistakes`)
                    : tr('סיימת את הקו! בלי טעויות ✓', 'Line finished! No mistakes ✓')
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
                {current ? <strong className="move-label">{moveLabel(ply - 1, current.san)}</strong> : <strong>{tr('עמדת הפתיחה', 'Starting position')}</strong>}
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
                  msg`The line plays ${next ? next.san : ''} here. The green arrow shows it. The position was saved for review.`,
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
                      msg`You master all lines of ${repName(rep)} 🎉 — now practice them in a game.`,
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
                <button onClick={() => go(0)} disabled={ply === 0} aria-label={tr('להתחלה', 'To the start')}><span className="rtl-flip" aria-hidden="true">⏮</span></button>
                <button onClick={() => go(ply - 1)} disabled={ply === 0}>‹ {tr('הקודם', 'Previous')}</button>
                <button className="primary" onClick={() => go(ply + 1)} disabled={!next}>{tr('הבא', 'Next')} ›</button>
                <button onClick={() => go(moves.length)} disabled={!next} aria-label={tr('לסוף', 'To the end')}><span className="rtl-flip" aria-hidden="true">⏭</span></button>
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

          {!hasExplanations(lang) && <p className="muted lang-note">{explanationsNote()}</p>}

          <ol className="moves" dir="ltr" ref={movesRef}>
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

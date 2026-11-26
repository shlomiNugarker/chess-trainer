import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { explanationsNote, movesOf, REPERTOIRES, lineMoves, lineText, moveLabel, posKey, repName } from './repertoire';
import { importPgn, removeCustomLine, useRepertoire, type ImportResult } from './customLines';
import { hasExplanations, msg, tr, useLang } from './i18n';
import { saveMistake, todaysMistakes, useMistakeCount } from './mistakes';
import { dialogOpen } from './useDialog';
import { BLUE_ARROW, BOARD_THEME, GREEN_ARROW, LAST_MOVE, WRONG_MOVE, ltr, uciToArrow } from './chessUtils';
import { useClickToMove } from './useClickToMove';
import { playSound, useMoveSound } from './sound';
import { dayStreak, daysPlayed, daysLabel } from './daily';
import { useScrollToMove } from './useScrollToMove';
import { useFitBoard } from './useFitBoard';
import { useSidePanel } from './useSidePanel';
import { useStored } from './storage';
import { hasAnyMastery, hasMastered, isMastered, loadMastery, recordRun } from './mastery';
import { InstallCard } from './InstallCard';
import { setHidden, useHiddenRepertoires } from './hiddenReps';
import { OpeningPicker } from './OpeningPicker';
import { LineSheet, OpeningSheet } from './LearnSheets';

const START = new Chess().fen();

/** In "test me" mode: what happened on the user's last try. */
type QuizState = { wrong?: { san: string; to: string; correctUci: string }; mistakes: number };

/**
 * Study a repertoire line move by move on a board, with the idea of the line and a note on key moves.
 * "Test me" replays the line: the user plays their side, the app plays the other.
 */
type Props = { onTrain: (repertoireId: string) => void; onDrill: () => void };

const dueCount = () => todaysMistakes().length;

export default function Learn({ onTrain, onDrill }: Props) {
  const [storedRepId, setRepId] = useStored('learn-repertoire', REPERTOIRES[0].id);
  const { hidden, visible, toggle: toggleHidden } = useHiddenRepertoires();
  const [sheet, setSheet] = useState<'opening' | 'line' | null>(null); // the opening or the line picker
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
  const masteredCount = rep.lines.filter((l) => isMastered(mastery[l.id])).length;
  const [importOpen, setImportOpen] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [imported, setImported] = useState<ImportResult[]>([]);
  const [guideDismissed, setGuideDismissed] = useStored('guide-dismissed', false);
  const anyMastery = useMemo(hasAnyMastery, [masteryVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // a first visit asks which openings you play (once, on every device of the account: the answer syncs)
  const [openingsChosen, setOpeningsChosen] = useStored('openings-chosen', false);
  const showPicker = !openingsChosen && !anyMastery && hidden.length === 0;
  const showGuide = !guideDismissed && !anyMastery && !showPicker;
  // not before the app was of use: a line passed without a mistake, or puzzles on two days
  const offerInstall = useMemo(() => hasMastered() || daysPlayed() >= 2, [masteryVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // "today": the streak and the positions to review, when there are any (the daily puzzles are on the Practice tab)
  const due = useMistakeCount(dueCount);
  const streakDays = useMemo(dayStreak, []); // it changes on another screen
  const nextToLearn = [...rep.lines.keys()]
    .map((k) => (lineIdx + 1 + k) % rep.lines.length)
    .find((i) => i !== lineIdx && !isMastered(mastery[rep.lines[i].id]));

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
    setSheet(null);
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
      recordRun(rep.id, line.id, mistakes);
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

  // the first visit: which openings do you play — the whole screen, before the board
  if (showPicker)
    return (
      <div className="learn">
        <OpeningPicker
          onDone={(next) => {
            setHidden(next);
            setOpeningsChosen(true);
          }}
        />
      </div>
    );

  return (
    <div className="learn">

      {showGuide && (
        <div className="card guide">
          {/* "Got it" beside the title: on a phone the board and its step buttons still fit above the tab bar */}
          <div className="guide-head">
            <strong>{tr('How to learn here')}</strong>
            <button className="ghost small" onClick={() => setGuideDismissed(true)}>{tr('Got it')}</button>
          </div>
          <ol>
            <li><b>{tr('Learn')}</b> — {tr('step through a line move by move and read why each move is played.')}</li>
            <li><b>{tr('Test me')}</b> — {tr('play the line yourself until there are no mistakes (✓).')}</li>
            <li><b>{tr('Play')}</b> — {tr('train against the computer; every step off the line is stopped and corrected.')}</li>
            <li><b>{tr('Review')}</b> — {tr('a few minutes a day on the positions you got wrong.')}</li>
          </ol>
        </div>
      )}

      {!showGuide && !quiz && offerInstall && <InstallCard />}

      {!showGuide && !quiz && (streakDays > 0 || due > 0) && (
        <div className="today">
          <span className="today-title">{tr('Today')}</span>
          {streakDays > 0 && <span className="pill">🔥 {daysLabel(streakDays)}</span>}
          {due > 0 && (
            <button onClick={onDrill}>↻ {due === 1 ? tr('Review 1 position') : tr(msg`Review ${due} positions`)}</button>
          )}
        </div>
      )}

      {/* what you study: the opening and its line, each one tap away (a list opens below) */}
      <header className="learn-header">
        <button className="picker-btn opening-btn" aria-haspopup="dialog" onClick={() => setSheet('opening')}>
          <span className="picker-btn-label">{tr('Opening')}</span>
          <span className="picker-btn-value">{repName(rep)}</span>
          <span className="picker-btn-meta progress-pill" title={tr('Lines you passed in a test with no mistakes')}>
            ✓ {masteredCount}/{rep.lines.length}
          </span>
          <span className="picker-btn-arrow" aria-hidden>▾</span>
        </button>
        <button className="picker-btn line-btn" aria-haspopup="dialog" onClick={() => setSheet('line')}>
          <span className="picker-btn-label">{tr('Line')}</span>
          <span className="picker-btn-value">
            {isMastered(mastery[line.id]) ? '✓ ' : ''}
            {text.name}
          </span>
          <span className="picker-btn-meta">{lineIdx + 1}/{rep.lines.length}</span>
          <span className="picker-btn-arrow" aria-hidden>▾</span>
        </button>
        {line.custom && (
          <button
            className="link remove-branch"
            onClick={() => {
              removeCustomLine(rep.id, line.moves);
              pickLine(rep.id, 0);
            }}
          >
            {tr('Remove this branch')}
          </button>
        )}
      </header>

      {sheet === 'opening' && (
        <OpeningSheet
          current={rep.id}
          hidden={hidden}
          visible={visible}
          onPick={(id) => pickLine(id, 0)}
          onToggle={toggleHidden}
          onImport={() => {
            setSheet(null);
            setImportOpen(true);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'line' && <LineSheet rep={rep} current={lineIdx} onPick={(i, at) => pickLine(rep.id, i, at)} onClose={() => setSheet(null)} />}

      {importOpen && (
        <section className="card import-card">
          <h3>{tr(msg`Import a line into ${repName(rep)}`)}</h3>
          <p className="muted">
            {tr('Paste a PGN (several games are fine) or moves like 1.e4 c6 2.d4 d5. Only the main line is used; each line is checked against your repertoire and added as a ★ branch.')}
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
              {tr('Import')}
            </button>
            <button className="ghost" onClick={() => setImportOpen(false)}>{tr('Close')}</button>
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
                    ? tr(msg`Line finished! ${quiz.mistakes} mistakes`)
                    : tr('Line finished! No mistakes ✓')
                  : quiz.wrong
                    ? tr('Not the move of the line')
                    : userTurn
                      ? tr('Play the next move of the line')
                      : tr('Opponent is moving…')}
              </span>
              <span className="pill">{tr('Test')} · {Math.min(ply, moves.length)}/{moves.length}</span>
            </div>
          ) : (
            <div className="card learn-move">
              <div className="learn-move-head">
                {current ? <strong className="move-label">{moveLabel(ply - 1, current.san)}</strong> : <strong>{tr('Starting position')}</strong>}
                {current && <span className="pill">{whose(ply - 1) ? tr('Your move') : tr('Opponent')}</span>}
              </div>
              <p>{note ?? (current ? '' : text.idea)}</p>
              {next && (
                <p className="muted">
                  {tr('Next:')} {ltr(moveLabel(ply, next.san))} — {tr('the blue arrow shows it.')}
                </p>
              )}
              {!next && <p className="muted">{tr('End of the line.')}</p>}
            </div>
          )}

          {quiz?.wrong && (
            <div className="card feedback tone-error">
              <strong>{tr('You played')} {ltr(quiz.wrong.san)}</strong>
              <p>
                {tr(msg`The line plays ${next ? next.san : ''} here. The green arrow shows it. The position was saved for review.`)}
              </p>
              <div className="buttons">
                <button className="primary" onClick={() => setQuiz({ ...quiz, wrong: undefined })}>↩ {tr('Try again')}</button>
              </div>
            </div>
          )}

          {done && quiz && (
            <div className={quiz.mistakes ? 'card notice tone-warn' : 'card notice tone-ok'}>
              <strong>
                {quiz.mistakes
                  ? tr('Almost! Go through the line once more without mistakes to mark it ✓')
                  : nextToLearn === undefined
                    ? tr(msg`You master all lines of ${repName(rep)} 🎉 — now practice them in a game.`)
                    : tr('Line mastered ✓')}
              </strong>
              <p>{text.idea}</p>
              <div className="buttons">
                <button className={quiz.mistakes ? 'primary' : 'ghost'} onClick={startQuiz}>↻ {tr('Again')}</button>
                {nextToLearn !== undefined && (
                  <button className={quiz.mistakes ? 'ghost' : 'primary'} onClick={() => pickLine(rep.id, nextToLearn)}>
                    {tr('Next line to learn ›')}
                  </button>
                )}
                {nextToLearn === undefined && !quiz.mistakes && (
                  <button className="primary" onClick={() => onTrain(rep.id)}>♟ {tr('Play this opening')}</button>
                )}
              </div>
            </div>
          )}

          {quiz ? (
            <div className="actions actions-2">
              <button onClick={() => setQuiz(null)}>
                <span className="icon" aria-hidden>📖</span>{tr('Back to study')}
              </button>
              <button onClick={() => onTrain(rep.id)}>
                <span className="icon" aria-hidden>♟</span>{tr('Play this opening')}
              </button>
            </div>
          ) : (
            <>
              <div className="stepper">
                <button onClick={() => go(0)} disabled={ply === 0} aria-label={tr('To the start')}><span className="rtl-flip" aria-hidden="true">⏮</span></button>
                <button onClick={() => go(ply - 1)} disabled={ply === 0}>‹ {tr('Previous')}</button>
                <button className="primary" onClick={() => go(ply + 1)} disabled={!next}>{tr('Next')} ›</button>
                <button onClick={() => go(moves.length)} disabled={!next} aria-label={tr('To the end')}><span className="rtl-flip" aria-hidden="true">⏭</span></button>
              </div>
              <div className="actions actions-2">
                <button onClick={startQuiz}>
                  <span className="icon" aria-hidden>🎯</span>{tr('Test me on this line')}
                </button>
                <button onClick={() => onTrain(rep.id)}>
                  <span className="icon" aria-hidden>♟</span>{tr('Play this opening')}
                </button>
              </div>
            </>
          )}

          {!hasExplanations() && <p className="muted lang-note">{explanationsNote()}</p>}

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
              <h3>{tr('From here in other lines')}</h3>
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
              <h3>{tr('The idea of the line')}</h3>
              <p>{text.idea}</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

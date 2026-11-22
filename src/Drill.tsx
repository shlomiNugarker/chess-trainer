import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { Engine, winPercent } from './engine';
import { MAX_BOX, dueMistakes, loadMistakes, recordReview, type Mistake } from './mistakes';
import { REPERTOIRES, repName } from './repertoire';
import { formatDate, tr } from './i18n';
import { BOARD_THEME, GREEN_ARROW, ltr, sanToUci, uciToArrow } from './chessUtils';
import { useClickToMove } from './useClickToMove';
import { playSound, useMoveSound } from './sound';
import { useFitBoard } from './useFitBoard';
import { useSidePanel } from './useSidePanel';

/** An alternative move that loses less than this (win%) also counts as correct for engine-found mistakes. */
const ALT_TOLERANCE = 10;

type Answer = { ok: boolean; text: string };

export default function Drill() {
  const [queue, setQueue] = useState<Mistake[]>(() => dueMistakes());
  const [index, setIndex] = useState(0);
  const [fen, setFen] = useState(queue[0]?.fen ?? new Chess().fen());
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [checking, setChecking] = useState(false);
  const [solved, setSolved] = useState(0);
  const engine = useRef<Engine | null>(null);

  useEffect(() => () => engine.current?.terminate(), []);

  const current = queue[index];

  /** Is `san` as good as the stored answer? Only engine-found mistakes accept alternatives. */
  const acceptable = async (m: Mistake, san: string, after: string) => {
    if (san === m.correct) return { ok: true, text: tr('נכון!', 'Correct!') };
    if (m.source !== 'engine') return { ok: false, text: '' };
    engine.current ??= new Engine();
    const pre = await engine.current.analyze(m.fen, 'movetime 300');
    const post = await engine.current.analyze(after, 'movetime 300');
    const drop = winPercent(pre) - (100 - winPercent(post));
    return drop < ALT_TOLERANCE
      ? { ok: true, text: tr(`גם ${ltr(san)} טוב! המהלך של המנוע היה ${ltr(m.correct)}.`, `${san} is good too! The engine's move was ${m.correct}.`) }
      : { ok: false, text: '' };
  };

  const onPieceDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!current || answer || checking || !targetSquare) return false;
    const g = new Chess(current.fen);
    let san: string;
    try {
      san = g.move({ from: sourceSquare, to: targetSquare, promotion: 'q' }).san;
    } catch {
      return false;
    }
    setFen(g.fen());
    setChecking(true);
    acceptable(current, san, g.fen()).then((res) => {
      setChecking(false);
      recordReview(current, res.ok);
      if (res.ok) {
        setSolved((n) => n + 1);
        playSound('success', 0.1);
        setAnswer(res);
      } else {
        playSound('error');
        setFen(current.fen); // back to the puzzle, with the right move drawn
        setQueue((q) => [...q, current]); // failed cards come back later in this session
        setAnswer({
          ok: false,
          text: tr(`לא. שיחקת ${ltr(san)}, המהלך הנכון הוא ${ltr(current.correct)}.`, `No. You played ${san}; the right move is ${current.correct}.`),
        });
      }
    });
    return true;
  };

  const { onSquareClick, onDrop, clickStyles } = useClickToMove(
    fen,
    (color) => !!current && !answer && !checking && color === current.fen.split(' ')[1],
    (from, to) => onPieceDrop({ sourceSquare: from, targetSquare: to }),
  );
  const boardRef = useFitBoard<HTMLDivElement>();
  const panelRef = useSidePanel<HTMLElement>();
  useMoveSound(fen);

  const reveal = () => {
    if (!current || answer) return;
    recordReview(current, false);
    setQueue((q) => [...q, current]);
    setAnswer({ ok: false, text: tr(`המהלך הנכון: ${ltr(current.correct)}.`, `The right move: ${current.correct}.`) });
  };

  const next = () => {
    const i = index + 1;
    setIndex(i);
    setAnswer(null);
    setFen(queue[i]?.fen ?? new Chess().fen());
  };

  if (!current) {
    const all = loadMistakes();
    const nextDue = all.length ? Math.min(...all.map((m) => m.due)) : null;
    return (
      <div className="card drill-empty">
        <div className="empty-mark" aria-hidden>♞</div>
        <h2>
          {solved
            ? tr(`כל הכבוד! פתרת ${solved} תרגילים.`, `Well done! You solved ${solved} exercises.`)
            : tr('אין מה לחזור היום 🎉', 'Nothing to review today 🎉')}
        </h2>
        <p className="muted">
          {all.length
            ? tr(
                `יש לך ${all.length} עמדות במאגר. החזרה הבאה: ${formatDate(nextDue!)}.`,
                `You have ${all.length} positions saved. Next review: ${formatDate(nextDue!)}.`,
              )
            : tr(
                'עוד אין טעויות שמורות. שחק באימון הפתיחות או הרץ ניתוח מנוע בסקירה — כל טעות תגיע לכאן.',
                'No saved mistakes yet. Train an opening or run an engine analysis in My review — every mistake ends up here.',
              )}
        </p>
      </div>
    );
  }

  const toMove = current.fen.split(' ')[1] as 'w' | 'b';
  const arrows: Arrow[] = answer && !answer.ok ? [uciToArrow(sanToUci(current.fen, current.correct), GREEN_ARROW)] : [];
  const rep = REPERTOIRES.find((r) => r.id === current.repertoire);

  return (
    <main>
      <div className="board-wrap" dir="ltr" ref={boardRef}>
        <div className="board">
        <Chessboard
          options={{
            id: 'drill',
            position: fen,
            boardOrientation: toMove === 'w' ? 'white' : 'black',
            onPieceDrop: ({ sourceSquare, targetSquare }) => onDrop(sourceSquare, targetSquare),
            onSquareClick,
            squareStyles: clickStyles,
            arrows,
            ...BOARD_THEME,
            allowDrawingArrows: false,
            canDragPiece: ({ piece }) => !answer && !checking && piece.pieceType[0] === toMove,
          }}
        />
        </div>
      </div>
      <aside ref={panelRef}>
        <div className={checking ? 'status status-checking' : 'status status-user'}>
          <span className="status-dot" aria-hidden />
          <span className="status-text">
            {checking
              ? tr('בודק…', 'Checking…')
              : tr(`מצא את המהלך הטוב ביותר ל${toMove === 'w' ? 'לבן' : 'שחור'}`, `Find the best move for ${toMove === 'w' ? 'White' : 'Black'}`)}
          </span>
          <span className="pill">{tr(`נשארו ${queue.length - index}`, `${queue.length - index} left`)}</span>
        </div>

        <div className="muted drill-meta">
          {current.source === 'puzzle'
            ? tr('מתוך פאזל', 'From a puzzle')
            : rep
              ? tr(`מתוך האימון: ${repName(rep)}`, `From training: ${repName(rep)}`)
              : tr('מתוך משחק שלך ב-Chess.com', 'From one of your Chess.com games')}
          {current.puzzleId && (
            <>
              {' · '}
              <a href={`https://lichess.org/training/${current.puzzleId}`} target="_blank" rel="noreferrer">Lichess</a>
            </>
          )}
          {current.gameUrl && (
            <>
              {' · '}
              <a href={current.gameUrl} target="_blank" rel="noreferrer">{tr('למשחק', 'Game')}</a>
            </>
          )}
          {' · '}{current.box === 0 ? tr('עמדה חדשה', 'New position') : tr(`שלב ${current.box} מתוך ${MAX_BOX}`, `Step ${current.box} of ${MAX_BOX}`)}
        </div>
        <div className="muted">
          {current.source === 'puzzle'
            ? tr(`בפאזל ניסית ${ltr(current.played)}.`, `In the puzzle you tried ${current.played}.`)
            : tr(`באותה עמדה שיחקת בעבר ${ltr(current.played)}.`, `Last time here you played ${current.played}.`)}
        </div>

        {answer && (
          <div className={answer.ok ? 'card notice tone-ok' : 'card feedback tone-error'}>
            <strong>{answer.text}</strong>
            {!answer.ok && <p className="muted">{tr('החץ הירוק מראה את המהלך. העמדה תחזור בסוף הסבב.', 'The green arrow shows the move. This position comes back at the end of the round.')}</p>}
          </div>
        )}

        <div className="buttons">
          {answer ? (
            <button className="primary" onClick={next}>{tr('הבא', 'Next')}</button>
          ) : (
            <button className="ghost" onClick={reveal} disabled={checking}>{tr('הראה תשובה', 'Show answer')}</button>
          )}
        </div>
      </aside>
    </main>
  );
}

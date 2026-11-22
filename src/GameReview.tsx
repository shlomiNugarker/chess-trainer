import { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { GameSummary } from './chesscom';
import { Engine } from './engine';
import EvalBar from './EvalBar';
import { REPERTOIRES, repName } from './repertoire';
import { withCustom } from './customLines';
import { saveMistake } from './mistakes';
import {
  MISTAKE_CLASSES, analyzePositions, bookInfo, buildReview, loadReview, parseGame, saveReview,
  type Eval, type MoveClass, type ReviewedMove,
} from './gameAnalysis';
import { BOARD_THEME, GREEN_ARROW, ltr, pvToSan, uciToArrow } from './chessUtils';
import { useFitBoard } from './useFitBoard';
import { useSidePanel } from './useSidePanel';
import { formatDate, tr, useLang } from './i18n';


const CLASS_LABEL: Record<MoveClass, [string, string]> = {
  book: ['ספר', 'Book'],
  best: ['הטוב ביותר', 'Best'],
  good: ['טוב', 'Good'],
  inaccuracy: ['אי-דיוק', 'Inaccuracy'],
  mistake: ['טעות', 'Mistake'],
  blunder: ['בלאנדר', 'Blunder'],
};
const SYMBOL: Partial<Record<MoveClass, string>> = { inaccuracy: '?!', mistake: '?', blunder: '??' };
const SQUARE: Record<MoveClass, string> = {
  book: 'rgba(106, 167, 232, 0.45)',
  best: 'rgba(95, 179, 107, 0.5)',
  good: 'rgba(246, 246, 105, 0.45)',
  inaccuracy: 'rgba(224, 180, 76, 0.6)',
  mistake: 'rgba(230, 138, 76, 0.65)',
  blunder: 'rgba(224, 108, 95, 0.7)',
};
const classLabel = (c: MoveClass) => tr(...CLASS_LABEL[c]);
const moveName = (ply: number, san: string) => (ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : `${(ply + 1) / 2}...${san}`);
const pct = (n: number | null) => (n === null ? '—' : ltr(`${Math.round(n)}%`));

type Props = {
  game: GameSummary;
  username: string;
  active: boolean; // the tab is showing (a hidden board must not animate, and keys belong to the visible tab)
  onClose: () => void;
  onLearn: (repertoireId: string, moves: string) => void;
  onDrill: () => void;
};

/** One game, move by move: engine evaluation, a label for every move, accuracy, and where it left the lines. */
export default function GameReview({ game, username, active, onClose, onLearn, onDrill }: Props) {
  useLang();
  const parsed = useMemo(() => parseGame(game.pgn), [game.pgn]);
  const reps = useMemo(() => REPERTOIRES.map(withCustom), []);
  const book = useMemo(() => (parsed ? bookInfo(parsed.moves.map((m) => m.san), game.color, reps) : null), [parsed, game.color, reps]);
  const [evals, setEvals] = useState<(Eval | undefined)[]>(() => loadReview(game.url) ?? []);
  // not stored yet: the analysis starts at once (see the effect below)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(() => {
    const n = parseGame(game.pgn)?.fens.length;
    return n && loadReview(game.url)?.length !== n ? { done: 0, total: n } : null;
  });
  const [ply, setPly] = useState(0); // moves shown on the board (0 = the start)
  const [saved, setSaved] = useState<Set<number>>(() => new Set()); // plies sent to "My mistakes"
  const boardRef = useFitBoard<HTMLDivElement>();
  const panelRef = useSidePanel<HTMLElement>();

  // analyze the game once (a stored review opens at once)
  useEffect(() => {
    if (!parsed) return;
    if (loadReview(game.url)?.length === parsed.fens.length) return; // stored: already in state
    const engine = new Engine();
    let cancelled = false;
    void analyzePositions(engine, parsed, {
      cancelled: () => cancelled,
      onUpdate: (e, done, total) => {
        if (cancelled) return;
        setEvals(e);
        setProgress({ done, total });
      },
    }).then((e) => {
      if (cancelled || !e) return;
      saveReview(game.url, e as Eval[]);
      setEvals(e);
      setProgress(null);
      engine.terminate();
    });
    return () => {
      cancelled = true;
      engine.terminate();
    };
  }, [game.url, parsed]);

  const review = useMemo(() => (parsed ? buildReview(parsed, evals, book?.plies ?? 0) : null), [parsed, evals, book]);
  const byPly = useMemo(() => new Map((review?.moves ?? []).map((m) => [m.ply, m])), [review]);
  const total = parsed?.moves.length ?? 0;
  const go = (p: number) => setPly(Math.max(0, Math.min(total, p)));
  const myMistakes = (review?.moves ?? []).filter((m) => m.color === game.color && MISTAKE_CLASSES.includes(m.cls));
  const nextMistake = () => {
    if (!myMistakes.length) return;
    const next = myMistakes.find((m) => m.ply + 1 > ply) ?? myMistakes[0];
    go(next.ply + 1);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') setPly((p) => Math.min(total, p + 1));
      else if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(total);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, total]);

  if (!parsed || !review) {
    return (
      <div className="game-review">
        <button className="ghost" onClick={onClose}>‹ {tr('חזרה למשחקים', 'Back to games')}</button>
        <div className="notice">{tr('אי אפשר לסקור את המשחק הזה (עמדת פתיחה מיוחדת או משחק בלי מהלכים).', 'This game can’t be reviewed (a special start position, or no moves).')}</div>
      </div>
    );
  }

  const current: ReviewedMove | undefined = byPly.get(ply - 1);
  const lastMove = ply > 0 ? parsed.moves[ply - 1] : undefined;
  const fen = parsed.fens[ply];
  const white = review.white[ply];
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    const bg = current ? SQUARE[current.cls] : 'rgba(246, 246, 105, 0.45)';
    squareStyles[lastMove.from] = { background: bg };
    squareStyles[lastMove.to] = { background: bg };
  }
  const arrows = current && current.cls !== 'best' && current.cls !== 'book' && current.bestUci ? [uciToArrow(current.bestUci, GREEN_ARROW)] : [];
  const me = game.color;
  const opp: 'w' | 'b' = me === 'w' ? 'b' : 'w';
  const resultText = game.result === 'win' ? tr('ניצחון', 'Win') : game.result === 'loss' ? tr('הפסד', 'Loss') : tr('תיקו', 'Draw');
  const mistakeCount = (c: 'w' | 'b') => MISTAKE_CLASSES.map((k) => review.sides[c].counts[k]);
  const saveAll = () => {
    const next = new Set(saved);
    for (const m of myMistakes) {
      if (m.cls === 'inaccuracy') continue; // like the rest of the app: only real mistakes become drills
      saveMistake({ fen: parsed.fens[m.ply], played: m.san, correct: m.best, source: 'engine', repertoire: 'chesscom', drop: m.drop, gameUrl: game.url });
      next.add(m.ply);
    }
    setSaved(next);
  };
  const saveOne = (m: ReviewedMove) => {
    saveMistake({ fen: parsed.fens[m.ply], played: m.san, correct: m.best, source: 'engine', repertoire: 'chesscom', drop: m.drop, gameUrl: game.url });
    setSaved(new Set(saved).add(m.ply));
  };
  const realMistakes = myMistakes.filter((m) => m.cls !== 'inaccuracy');

  return (
    <div className="game-review">
      <header className="game-review-head">
        <button className="ghost" onClick={onClose}>‹ {tr('חזרה למשחקים', 'Back to games')}</button>
        <div className="game-review-title">
          <strong>
            {me === 'w' ? '♔' : '♚'} {username} ({game.myRating}) — {game.opponent} ({game.opponentRating})
          </strong>
          <span className={`pill result-${game.result}`}>{resultText}</span>
          <span className="muted">{formatDate(game.endTime)} · {game.opening}</span>
          <a href={game.url} target="_blank" rel="noreferrer" className="small-link">Chess.com ↗</a>
        </div>
      </header>

      <main>
        <div className="board-wrap" dir="ltr" ref={boardRef}>
          <EvalBar white={Number.isNaN(white) ? null : white} orientation={me === 'w' ? 'white' : 'black'} />
          <div className="board">
            <Chessboard
              options={{
                id: 'game-review',
                showAnimations: active,
                position: fen,
                boardOrientation: me === 'w' ? 'white' : 'black',
                arrows,
                squareStyles,
                ...BOARD_THEME,
                allowDragging: false,
                allowDrawingArrows: false,
              }}
            />
          </div>
        </div>

        <aside ref={panelRef}>
          {progress && (
            <div className="card review-progress">
              {tr(`מנתח את המשחק… ${progress.done}/${progress.total}`, `Analyzing the game… ${progress.done}/${progress.total}`)}
              <div className="progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            </div>
          )}

          <div className="card review-move">
            {current ? (
              <>
                <div className="review-move-head">
                  <strong dir="ltr">{moveName(current.ply, current.san)}</strong>
                  <span className={`pill cls-${current.cls}`}>{classLabel(current.cls)}{current.drop >= 2 && current.cls !== 'book' ? ` · ${ltr(`−${Math.round(current.drop)}%`)}` : ''}</span>
                </div>
                {current.cls === 'book' ? (
                  <p className="muted">{tr('מהלך מהרפרטואר שלך.', 'A move from your repertoire.')}</p>
                ) : current.cls === 'best' ? (
                  <p className="muted">{tr('המהלך של המנוע.', 'The engine’s move.')}</p>
                ) : (
                  <>
                    <p>
                      {tr('הטוב ביותר:', 'Best:')} <b>{ltr(current.best)}</b>{' '}
                      <span className="muted">{tr('(החץ הירוק)', '(the green arrow)')}</span>
                    </p>
                    {current.pv.length > 1 && (
                      <p className="muted">
                        {tr('המשך:', 'Line:')} <span dir="ltr">{pvToSan(parsed.fens[current.ply], current.pv, 6)}</span>
                      </p>
                    )}
                    {current.color === me && current.cls !== 'good' && (
                      saved.has(current.ply) ? (
                        <p className="branch-added">
                          ✓ {tr('נוסף לתרגול', 'Added to practice')} · <button className="link" onClick={onDrill}>{tr('לתרגול ›', 'Practice ›')}</button>
                        </p>
                      ) : (
                        <button className="small" onClick={() => saveOne(current)}>{tr('תרגל את העמדה הזו', 'Practice this position')}</button>
                      )
                    )}
                  </>
                )}
              </>
            ) : ply > 0 ? (
              <p className="muted">{tr('עוד מנתח את המהלך הזה…', 'Still analyzing this move…')}</p>
            ) : (
              <p className="muted">{tr('עמדת הפתיחה. עבור על המשחק עם "הבא" או בחר מהלך מהרשימה.', 'The starting position. Step through with Next, or pick a move from the list.')}</p>
            )}
          </div>

          <div className="stepper">
            <button onClick={() => go(0)} disabled={ply === 0} aria-label={tr('להתחלה', 'To the start')}>⏮</button>
            <button onClick={() => go(ply - 1)} disabled={ply === 0}>‹ {tr('הקודם', 'Previous')}</button>
            <button className="primary" onClick={() => go(ply + 1)} disabled={ply === total}>{tr('הבא', 'Next')} ›</button>
            <button onClick={() => go(total)} disabled={ply === total} aria-label={tr('לסוף', 'To the end')}>⏭</button>
          </div>
          <button className="next-mistake" onClick={nextMistake} disabled={!myMistakes.length}>
            {myMistakes.length
              ? tr(`לטעות הבאה שלי (${myMistakes.length})`, `My next mistake (${myMistakes.length})`)
              : progress ? tr('מחפש טעויות…', 'Looking for mistakes…') : tr('אין לך טעויות במשחק הזה 🎉', 'No mistakes of yours in this game 🎉')}
          </button>

          <EvalGraph white={review.white} ply={ply} marks={myMistakes} onPick={go} />

          <ol className="moves review-moves" dir="ltr">
            {Array.from({ length: Math.ceil(total / 2) }, (_, r) => (
              <li key={r}>
                <span className="move-no">{r + 1}.</span>
                {[2 * r, 2 * r + 1].filter((i) => i < total).map((i) => {
                  const m = byPly.get(i);
                  return (
                    <button key={i} className={`move${ply === i + 1 ? ' last' : ''}${m ? ` cls-${m.cls}` : ''}`} onClick={() => go(i + 1)}>
                      {parsed.moves[i].san}{m && SYMBOL[m.cls]}
                    </button>
                  );
                })}
              </li>
            ))}
          </ol>

          <section className="card review-summary">
            <h2>{tr('סיכום', 'Summary')}</h2>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>{tr('דיוק', 'Accuracy')}</th>
                  <th className="cls-inaccuracy">?!</th>
                  <th className="cls-mistake">?</th>
                  <th className="cls-blunder">??</th>
                </tr>
              </thead>
              <tbody>
                {[me, opp].map((c) => (
                  <tr key={c}>
                    <th>{c === me ? tr('אתה', 'You') : game.opponent}</th>
                    <td>{pct(review.sides[c].accuracy)}</td>
                    {mistakeCount(c).map((n, k) => <td key={k}>{n}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {game.accuracy !== undefined && (
              <p className="muted">{tr(`הדיוק שלך לפי Chess.com: ${pct(game.accuracy)} (מנוע אחר ועומק אחר, אז המספרים לא זהים).`, `Your accuracy on Chess.com: ${pct(game.accuracy)} (a different engine and depth, so the numbers differ).`)}</p>
            )}
            {book && (
              <p>
                {book.left
                  ? book.left.mine
                    ? tr(
                        `יצאת מהרפרטואר (${repName(REPERTOIRES.find((r) => r.id === book.repId)!)}) ב-${ltr(moveName(book.left.ply, parsed.moves[book.left.ply].san))} — בקו: ${ltr(book.left.expected.join(' / '))}.`,
                        `You left your repertoire (${repName(REPERTOIRES.find((r) => r.id === book.repId)!)}) with ${moveName(book.left.ply, parsed.moves[book.left.ply].san)} — the line plays ${book.left.expected.join(' / ')}.`,
                      )
                    : tr(
                        `היריב יצא מהרפרטואר שלך ב-${ltr(moveName(book.left.ply, parsed.moves[book.left.ply].san))}.`,
                        `Your opponent left your repertoire with ${moveName(book.left.ply, parsed.moves[book.left.ply].san)}.`,
                      )
                  : tr(`המשחק הלך לפי הרפרטואר ${book.plies} מהלכים (חצאי מהלך), עד סוף הקו.`, `The game followed your repertoire for ${book.plies} half-moves, to the end of the line.`)}{' '}
                {book.left && <button className="link" onClick={() => go(book.left!.ply + 1)}>{tr('הראה', 'Show')}</button>}{' '}
                <button className="link" onClick={() => onLearn(book.repId, book.lineMoves)}>{tr('פתח את הקו ב"למד" ›', 'Open the line in Learn ›')}</button>
              </p>
            )}
            {realMistakes.length > 0 && !progress && (
              realMistakes.every((m) => saved.has(m.ply)) ? (
                <p className="branch-added">✓ {tr('הטעויות נוספו לתרגול', 'Your mistakes were added to practice')} · <button className="link" onClick={onDrill}>{tr('לתרגול ›', 'Practice ›')}</button></p>
              ) : (
                <button onClick={saveAll}>{tr(`הוסף את ${realMistakes.length} הטעויות שלי לתרגול`, `Add my ${realMistakes.length} mistakes to practice`)}</button>
              )
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

/** White's win chances over the game; tap to jump to a move. The user's mistakes are marked. */
function EvalGraph({ white, ply, marks, onPick }: { white: number[]; ply: number; marks: ReviewedMove[]; onPick: (ply: number) => void }) {
  const n = white.length - 1;
  if (n < 1) return null;
  const x = (i: number) => (i / n) * 100;
  const y = (w: number) => 100 - w;
  const pts = white.map((w, i) => (Number.isNaN(w) ? null : `${x(i)},${y(w)}`)).filter(Boolean).join(' ');
  const area = pts ? `0,100 ${pts} ${x(white.findLastIndex((w) => !Number.isNaN(w)))},100` : '';
  return (
    <div className="eval-graph" dir="ltr" title={tr('סיכויי הניצחון של לבן לאורך המשחק — לחץ כדי לקפוץ', 'White’s win chances over the game — tap to jump')}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPick(Math.round(((e.clientX - r.left) / r.width) * n));
        }}
      >
        <rect x="0" y="0" width="100" height="100" className="eval-graph-black" />
        {area && <polygon points={area} className="eval-graph-white" />}
        <line x1="0" y1="50" x2="100" y2="50" className="eval-graph-mid" />
        <line x1={x(ply)} y1="0" x2={x(ply)} y2="100" className="eval-graph-now" />
      </svg>
      {marks.map((m) => (
        <span key={m.ply} className={`eval-graph-mark cls-${m.cls}`} style={{ left: `${x(m.ply + 1)}%`, top: `${y(white[m.ply + 1] ?? 50)}%` }} />
      ))}
    </div>
  );
}

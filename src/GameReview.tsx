import { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { openingName, type GameSummary } from './chesscom';
import { DRILL_DROP, Engine } from './engine';
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
import { useScrollToMove } from './useScrollToMove';
import { dialogOpen } from './useDialog';
import { formatDate, msg, tr, trKey, useLang } from './i18n';

const CLASS_LABEL: Record<MoveClass, string> = {
  book: trKey('Book'),
  best: trKey('Best'),
  good: trKey('Good'),
  inaccuracy: trKey('Inaccuracy'),
  mistake: trKey('Mistake'),
  blunder: trKey('Blunder'),
};
/** "15...Rc8 is a blunder" */
const CLASS_SENTENCE: Record<MoveClass, string> = {
  book: trKey('is a book move (your repertoire)'),
  best: trKey('is the best move'),
  good: trKey('is a good move'),
  inaccuracy: trKey('is an inaccuracy'),
  mistake: trKey('is a mistake'),
  blunder: trKey('is a blunder'),
};
const SUMMARY_ORDER: MoveClass[] = ['best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
const SQUARE: Record<MoveClass, string> = {
  book: 'rgba(106, 167, 232, 0.45)',
  best: 'rgba(95, 179, 107, 0.5)',
  good: 'rgba(150, 190, 110, 0.45)',
  inaccuracy: 'rgba(224, 180, 76, 0.6)',
  mistake: 'rgba(230, 138, 76, 0.65)',
  blunder: 'rgba(224, 108, 95, 0.7)',
};
const classLabel = (c: MoveClass) => tr(CLASS_LABEL[c]);
const moveName = (ply: number, san: string) => (ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : `${(ply + 1) / 2}...${san}`);
const pct = (n: number | null) => (n === null ? '—' : ltr(`${Math.round(n)}%`));

/** The evaluation of a position for White, the way chess sites show it: "+0.4", "−3.2", "M3", "1-0". */
function scoreText(e: Eval | undefined, fen: string): string {
  if (!e) return '…';
  const toMoveWhite = fen.split(' ')[1] === 'w';
  if (e.mate !== null) {
    if (e.mate === 0) return toMoveWhite ? '0-1' : '1-0'; // the side to move is mated
    const forWhite = toMoveWhite ? e.mate > 0 : e.mate < 0;
    return `${forWhite ? '' : '−'}M${Math.abs(e.mate)}`;
  }
  const cp = (e.cp ?? 0) * (toMoveWhite ? 1 : -1);
  const v = Math.abs(cp / 100).toFixed(1);
  return cp > 0 ? `+${v}` : cp < 0 ? `−${v}` : '0.0';
}

/** The round mark of a move class (★ best, ✓ good, a book, ?! ? ??): a colored circle, the same everywhere. */
function ClassIcon({ cls, size = 'md' }: { cls: MoveClass; size?: 'sm' | 'md' | 'lg' }) {
  const glyph =
    cls === 'book' ? (
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M2 3.2C3.6 2.6 5.6 2.6 7.4 3.6v9.6C5.6 12.3 3.6 12.3 2 12.9zM14 3.2c-1.6-.6-3.6-.6-5.4.4v9.6c1.8-.9 3.8-.9 5.4-.3z" fill="currentColor" />
      </svg>
    ) : cls === 'best' ? '★' : cls === 'good' ? '✓' : cls === 'inaccuracy' ? '?!' : cls === 'mistake' ? '?' : '??';
  return <span className={`cls-icon cls-${cls} cls-icon-${size}`} title={classLabel(cls)} aria-label={classLabel(cls)}>{glyph}</span>;
}

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
  const movesRef = useScrollToMove<HTMLOListElement>(ply);
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
      if (dialogOpen() || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
        <button className="ghost" onClick={onClose}>‹ {tr('Back to games')}</button>
        <div className="notice">{tr('This game can’t be reviewed (a special start position, or no moves).')}</div>
      </div>
    );
  }

  const current: ReviewedMove | undefined = byPly.get(ply - 1);
  const lastMove = ply > 0 ? parsed.moves[ply - 1] : undefined;
  const fen = parsed.fens[ply];
  const white = review.white[ply];
  const orientation = game.color === 'w' ? 'white' : 'black';
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    const bg = current ? SQUARE[current.cls] : 'rgba(246, 246, 105, 0.45)';
    squareStyles[lastMove.from] = { background: bg };
    squareStyles[lastMove.to] = { background: bg };
  }
  const arrows = current && current.cls !== 'best' && current.cls !== 'book' && current.bestUci ? [uciToArrow(current.bestUci, GREEN_ARROW)] : [];
  // the class mark sits on the top corner of the square the piece moved to
  const badgeAt = (() => {
    if (!lastMove || !current) return null;
    const file = lastMove.to.charCodeAt(0) - 97;
    const rank = Number(lastMove.to[1]);
    const col = orientation === 'white' ? file : 7 - file;
    const row = orientation === 'white' ? 8 - rank : rank - 1;
    return { left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%` };
  })();
  const me = game.color;
  const names = { w: me === 'w' ? username : game.opponent, b: me === 'b' ? username : game.opponent };
  const ratings = { w: me === 'w' ? game.myRating : game.opponentRating, b: me === 'b' ? game.myRating : game.opponentRating };
  const resultText = game.result === 'win' ? tr('Win') : game.result === 'loss' ? tr('Loss') : tr('Draw');
  const keyMoments = review.moves.filter((m) => MISTAKE_CLASSES.includes(m.cls));
  const save = (ms: ReviewedMove[]) => {
    const next = new Set(saved);
    for (const m of ms) {
      saveMistake({ fen: parsed.fens[m.ply], played: m.san, correct: m.best, source: 'engine', repertoire: 'chesscom', drop: m.drop, gameUrl: game.url });
      next.add(m.ply);
    }
    setSaved(next);
  };
  const realMistakes = myMistakes.filter((m) => m.drop >= DRILL_DROP); // like "My review"; a smaller one can be added by its own button
  const repLabel = book ? repName(REPERTOIRES.find((r) => r.id === book.repId)!) : '';
  const leftName = book?.left ? moveName(book.left.ply, parsed.moves[book.left.ply].san) : '';

  return (
    <div className="game-review">
      <header className="game-review-head">
        <button className="ghost" onClick={onClose} aria-label={tr('Back to games')}>‹ <span className="wide-only">{tr('Back to games')}</span></button>
        <div className="game-review-title">
          <strong className="wide-only">{tr('Game review')}</strong>
          <span className={`pill result-${game.result}`}>{resultText}</span>
          <span className="muted game-review-info">{tr('vs')} <bdi>{game.opponent}</bdi><span className="wide-only"> · {formatDate(game.endTime)} · {openingName(game.opening)}</span></span>
          <a href={game.url} target="_blank" rel="noreferrer" className="small-link">Chess.com ↗</a>
        </div>
      </header>

      <main>
        <div className="board-wrap" dir="ltr" ref={boardRef}>
          <EvalBar white={Number.isNaN(white) ? null : white} orientation={orientation} />
          <div className="board review-board">
            <Chessboard
              options={{
                id: 'game-review',
                showAnimations: active,
                position: fen,
                boardOrientation: orientation,
                arrows,
                squareStyles,
                ...BOARD_THEME,
                allowDragging: false,
                allowDrawingArrows: false,
              }}
            />
            {badgeAt && current && (
              <div className="board-badge" style={badgeAt}>
                <ClassIcon cls={current.cls} size="lg" />
              </div>
            )}
          </div>
        </div>

        <aside ref={panelRef}>
          {/* fixed height: stepping through the game never moves the buttons below; longer text scrolls inside */}
          <div className={`card coach${current ? ` cls-${current.cls}` : ''}`}>
            {progress && (
              <div className="review-progress coach-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
            <div className="coach-scroll">
            {current ? (
              <>
                <div className="coach-head">
                  <ClassIcon cls={current.cls} size="lg" />
                  <p className="coach-line">
                    <b dir="ltr">{moveName(current.ply, current.san)}</b> {tr(CLASS_SENTENCE[current.cls])}
                  </p>
                  <span className="coach-score" dir="ltr" title={tr('Evaluation (White)')}>{scoreText(evals[ply], fen)}</span>
                </div>
                {current.cls !== 'best' && current.cls !== 'book' && (
                  <div className="coach-body">
                    <p>
                      {tr('The best move was')} <b>{ltr(current.best)}</b>
                      {current.drop >= 2 && <span className="muted"> · {tr('lost')} {ltr(`${Math.round(current.drop)}%`)} {tr('of the win chances')}</span>}
                    </p>
                    {current.pv.length > 1 && (
                      <p className="muted">{tr('Line:')} <span dir="ltr">{pvToSan(parsed.fens[current.ply], current.pv, 6)}</span></p>
                    )}
                    {current.color === me && current.cls !== 'good' && (
                      saved.has(current.ply) ? (
                        <p className="branch-added">✓ {tr('Added to practice')} · <button className="link" onClick={onDrill}>{tr('Practice ›')}</button></p>
                      ) : (
                        <button className="small" onClick={() => save([current])}>{tr('Practice this position')}</button>
                      )
                    )}
                  </div>
                )}
              </>
            ) : ply > 0 ? (
              <p className="muted">{tr('Still analyzing this move…')}</p>
            ) : (
              <div className="coach-start">
                <p className="coach-line">{tr('Let’s go through the game: every move gets the engine’s verdict, and the green arrow shows the better move.')}</p>
                <div className="buttons">
                  <button className="primary" onClick={() => go(1)}>{tr('Start review')}</button>
                  {myMistakes.length > 0 && <button onClick={nextMistake}>{tr('To my first mistake')}</button>}
                </div>
              </div>
            )}
            </div>
          </div>

          <div className="stepper">
            <button onClick={() => go(0)} disabled={ply === 0} aria-label={tr('To the start')}><span className="rtl-flip" aria-hidden="true">⏮</span></button>
            <button onClick={() => go(ply - 1)} disabled={ply === 0}>‹ {tr('Previous')}</button>
            <button className="primary" onClick={() => go(ply + 1)} disabled={ply === total}>{tr('Next')} ›</button>
            <button onClick={() => go(total)} disabled={ply === total} aria-label={tr('To the end')}><span className="rtl-flip" aria-hidden="true">⏭</span></button>
          </div>
          <button className="next-mistake" onClick={nextMistake} disabled={!myMistakes.length}>
            {progress
              ? myMistakes.length
                ? tr(msg`My next mistake (${myMistakes.length}) · analyzing ${`${progress.done}/${progress.total}`}`)
                : tr(msg`Analyzing the game… ${`${progress.done}/${progress.total}`}`)
              : myMistakes.length
                ? tr(msg`My next mistake (${myMistakes.length})`)
                : tr('No mistakes of yours in this game 🎉')}
          </button>

          <EvalGraph white={review.white} ply={ply} marks={keyMoments} onPick={go} />

          <section className="card review-summary">
            <div className="rv-grid">
              <span />
              {(['w', 'b'] as const).map((c) => (
                <span key={c} className={`rv-player${c === me ? ' me' : ''}`}>
                  <span className={`rv-piece rv-piece-${c}`} aria-hidden>{c === 'w' ? '♔' : '♚'}</span>
                  <span className="rv-name" dir={c === me ? undefined : 'ltr'} title={names[c]}>{c === me ? tr('You') : names[c]}</span>
                  <span className="muted">{ratings[c]}</span>
                </span>
              ))}
              <span className="rv-label">{tr('Accuracy')}</span>
              {(['w', 'b'] as const).map((c) => (
                <span key={c} className={`rv-acc rv-acc-${c}`}>{review.sides[c].accuracy === null ? '—' : Math.round(review.sides[c].accuracy!)}</span>
              ))}
              {SUMMARY_ORDER.map((cls) => (
                <div key={cls} className="rv-row">
                  <span className="rv-label rv-cls"><ClassIcon cls={cls} size="sm" /> {classLabel(cls)}</span>
                  {(['w', 'b'] as const).map((c) => (
                    <span key={c} className={`rv-count cls-${cls}${review.sides[c].counts[cls] ? '' : ' zero'}`}>{review.sides[c].counts[cls]}</span>
                  ))}
                </div>
              ))}
            </div>
            {game.accuracy !== undefined && (
              <p className="muted">{tr(msg`Your accuracy on Chess.com: ${pct(game.accuracy)} (a different engine and depth, so the numbers differ).`)}</p>
            )}
          </section>

          <ol className="moves review-moves" dir="ltr" ref={movesRef}>
            {Array.from({ length: Math.ceil(total / 2) }, (_, r) => (
              <li key={r}>
                <span className="move-no">{r + 1}.</span>
                {[2 * r, 2 * r + 1].filter((i) => i < total).map((i) => {
                  const m = byPly.get(i);
                  return (
                    <button key={i} className={`move${ply === i + 1 ? ' last' : ''}${m ? ` cls-${m.cls}` : ''}`} onClick={() => go(i + 1)}>
                      {parsed.moves[i].san}
                      {m && MISTAKE_CLASSES.includes(m.cls) && <ClassIcon cls={m.cls} size="sm" />}
                    </button>
                  );
                })}
              </li>
            ))}
          </ol>

          {(book || (realMistakes.length > 0 && !progress)) && (
            <section className="card review-extra">
              {book && (
                <p>
                  {book.left
                    ? book.left.mine
                      ? tr(msg`You left your repertoire (${repLabel}) with ${leftName} — the line plays ${book.left.expected.join(' / ')}.`)
                      : tr(msg`Your opponent left your repertoire with ${leftName}.`)
                    : tr(msg`The game followed your repertoire for ${book.plies} half-moves, to the end of the line.`)}{' '}
                  {book.left && <button className="link" onClick={() => go(book.left!.ply + 1)}>{tr('Show')}</button>}{' '}
                  <button className="link" onClick={() => onLearn(book.repId, book.lineMoves)}>{tr('Open the line in Learn ›')}</button>
                </p>
              )}
              {realMistakes.length > 0 && !progress && (
                realMistakes.every((m) => saved.has(m.ply)) ? (
                  <p className="branch-added">✓ {tr('Your mistakes were added to practice')} · <button className="link" onClick={onDrill}>{tr('Practice ›')}</button></p>
                ) : (
                  <button onClick={() => save(realMistakes)}>
                    {realMistakes.length === 1
                      ? tr('Add my big mistake to practice')
                      : tr(msg`Add my ${realMistakes.length} big mistakes to practice`)}
                  </button>
                )
              )}
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

/** White's win chances over the game; tap to jump to a move. Key moments (both sides) are marked. */
function EvalGraph({ white, ply, marks, onPick }: { white: number[]; ply: number; marks: ReviewedMove[]; onPick: (ply: number) => void }) {
  const n = white.length - 1;
  if (n < 1) return null;
  const x = (i: number) => (i / n) * 100;
  const y = (w: number) => 100 - w;
  const pts = white.map((w, i) => (Number.isNaN(w) ? null : `${x(i)},${y(w)}`)).filter(Boolean).join(' ');
  const lastKnown = white.findLastIndex((w) => !Number.isNaN(w));
  const area = pts ? `0,100 ${pts} ${x(lastKnown)},100` : '';
  return (
    <div className="eval-graph" dir="ltr" title={tr('White’s win chances over the game — tap to jump')}>
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

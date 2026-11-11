import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { Engine, whiteWinPercent, winPercent } from './engine';
import { REPERTOIRES, buildBook, posKey } from './repertoire';
import { loadMistakes, saveMistake } from './mistakes';
import { BLUE_ARROW, GREEN_ARROW, judge, ltr, sanToUci, uciToArrow, uciToSan } from './chessUtils';
import { useStored } from './storage';
import { LEARN_UNTIL, clearLearned, learnMove, loadLearned } from './learned';
import EvalBar from './EvalBar';
import { useClickToMove } from './useClickToMove';

/** Below this win% loss a non-best move is not worth a remark. */
const MIN_REMARK_DROP = 2;

const BOOK_END_NOTICE = `סוף הקו בספר. עד מהלך ${LEARN_UNTIL} המחשב משחק את המהלכים הכי טובים, ואתה לומד את ההמשך — המהלכים הנכונים נשמרים לפעם הבאה.`;

type Mode = 'train' | 'play'; // opening training, or a regular game against the engine
type Phase = 'book' | 'free';
type Status = 'user' | 'opponent' | 'checking' | 'paused' | 'over';
type Color = 'w' | 'b';
type ColorChoice = Color | 'random';

const COLOR_CHOICES: { label: string; value: ColorChoice }[] = [
  { label: 'לבן', value: 'w' },
  { label: 'שחור', value: 'b' },
  { label: 'אקראי', value: 'random' },
];

type Feedback = {
  kind: 'book' | 'engine';
  title: string;
  text: string;
  correctUci: string; // arrow
  playedSan: string;
};

const THRESHOLDS = [
  { label: 'רגיש (אי-דיוק ומעלה)', value: 10 },
  { label: 'רגיל (טעות ומעלה)', value: 20 },
  { label: 'רק בלאנדרים', value: 30 },
];

/** A request from another screen to start training a repertoire (nonce makes repeats count). */
export type TrainRequest = { repertoireId: string; nonce: number };

export default function Trainer({ trainRequest, active = true }: { trainRequest?: TrainRequest | null; active?: boolean }) {
  const [mode, setMode] = useState<Mode>('train');
  const modeRef = useRef<Mode>('train'); // read by callbacks that must see a mode switch immediately
  const [colorChoice, setColorChoice] = useStored<ColorChoice>('color', 'w');
  const [playColor, setPlayColor] = useState<Color>('w'); // resolved color in play mode
  const [storedRepId, setRepId] = useStored('repertoire', REPERTOIRES[0].id);
  const rep = REPERTOIRES.find((r) => r.id === storedRepId) ?? REPERTOIRES[0];
  const repId = rep.id;
  const book = useMemo(() => buildBook(rep), [rep]);
  const [learnedVersion, setLearnedVersion] = useState(0); // bump to re-read the learned store
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const learned = useMemo(() => loadLearned(repId), [repId, learnedVersion]);

  const [skill, setSkill] = useStored('skill', 3);
  const [threshold, setThreshold] = useStored('threshold', 20);
  const [showEval, setShowEval] = useStored('show-eval', true);
  const [settingsOpen, setSettingsOpen] = useState(false); // phones: settings fold away to keep the board on screen
  const showEvalRef = useRef(showEval);
  showEvalRef.current = showEval;
  const [evalWhite, setEvalWhite] = useState<number | null>(null); // White's win%, null = unknown

  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [history, setHistory] = useState<Move[]>([]);
  const [phase, setPhase] = useState<Phase>('book');
  const [status, setStatus] = useState<Status>('user');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [hint, setHint] = useState<Arrow | null>(null);
  const [mistakeCount, setMistakeCount] = useState(loadMistakes().length);
  const [engineReady, setEngineReady] = useState(false);

  const opponent = useRef<Engine | null>(null);
  const coach = useRef<Engine | null>(null);
  const gameId = useRef(0); // bump to invalidate in-flight async work
  // Pre-computed coach analysis of the position where it's the user's turn
  const preAnalysis = useRef<{ key: string; promise: ReturnType<Engine['analyze']> } | null>(null);

  const userColor = mode === 'play' ? playColor : rep.userColor;

  useEffect(() => {
    opponent.current = new Engine();
    coach.current = new Engine();
    coach.current.analyze(new Chess().fen(), 'depth 1').then(() => setEngineReady(true));
    return () => {
      opponent.current?.terminate();
      coach.current?.terminate();
    };
  }, []);

  useEffect(() => {
    opponent.current?.setOption('Skill Level', skill);
  }, [skill]);

  const sync = useCallback(() => {
    const g = gameRef.current;
    setFen(g.fen());
    setHistory(g.history({ verbose: true }));
  }, []);

  const startPreAnalysis = useCallback(() => {
    const g = gameRef.current;
    // play mode has no coach; it still analyzes when the win-chance bar is shown
    if (!coach.current || g.isGameOver() || (modeRef.current === 'play' && !showEvalRef.current)) return;
    const key = g.fen();
    const promise = coach.current.analyze(key);
    preAnalysis.current = { key, promise };
    promise.then((a) => {
      if (gameRef.current.fen() === key) setEvalWhite(whiteWinPercent(a, key));
    });
  }, []);

  const finishIfOver = useCallback(() => {
    const g = gameRef.current;
    if (!g.isGameOver()) return false;
    setStatus('over');
    setNotice(
      g.isCheckmate()
        ? g.turn() === userColor ? 'מט. הפסדת — נסה שוב.' : 'מט! ניצחת.'
        : 'תיקו.',
    );
    return true;
  }, [userColor]);

  /** Opponent's turn: book reply if we're still in the line, otherwise the engine (full strength until LEARN_UNTIL). */
  const opponentMove = useCallback(
    async (currentPhase: Phase) => {
      const g = gameRef.current;
      if (finishIfOver()) return;
      const id = gameId.current;
      setStatus('opponent');

      let nextPhase = currentPhase;
      let san: string | null = null;
      if (currentPhase === 'book') {
        const replies = book.get(posKey(g.fen()));
        if (replies?.length) san = replies[Math.floor(Math.random() * replies.length)];
        else {
          nextPhase = 'free';
          setNotice(BOOK_END_NOTICE);
        }
      }

      await new Promise((r) => setTimeout(r, 350)); // let the user see their move land
      if (id !== gameId.current) return;

      if (san) {
        g.move(san);
      } else {
        // in training, the opening continues at full strength so lines repeat and can be learned
        const strong = modeRef.current === 'train' && g.moveNumber() <= LEARN_UNTIL;
        const res = await (strong ? coach.current! : opponent.current!).analyze(g.fen(), 'movetime 400');
        if (id !== gameId.current) return;
        g.move({ from: res.bestMove.slice(0, 2), to: res.bestMove.slice(2, 4), promotion: res.bestMove[4] ?? 'q' });
      }
      setPhase(nextPhase);
      sync();
      if (finishIfOver()) return;
      // Still in book but the line ends on our move? Then free play starts now.
      if (nextPhase === 'book' && !book.get(posKey(g.fen()))?.length) {
        setPhase('free');
        setNotice(BOOK_END_NOTICE);
      }
      setStatus('user');
      startPreAnalysis();
    },
    [book, finishIfOver, startPreAnalysis, sync],
  );

  const newGame = useCallback(
    ({ repertoireId = repId, mode: m = mode, color: cc = colorChoice }: { repertoireId?: string; mode?: Mode; color?: ColorChoice } = {}) => {
      gameId.current++;
      modeRef.current = m;
      gameRef.current = new Chess();
      setPhase(m === 'play' ? 'free' : 'book');
      setFeedback(null);
      setNotice('');
      setHint(null);
      setEvalWhite(null);
      sync();
      opponent.current?.newGame();
      if (m === 'play') {
        const c: Color = cc === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : cc;
        setPlayColor(c);
        if (c === 'b') opponentMove('free');
        else {
          setStatus('user');
          startPreAnalysis(); // feeds the win-chance bar
        }
        return;
      }
      const r = REPERTOIRES.find((x) => x.id === repertoireId)!;
      if (r.userColor === 'b') {
        setStatus('opponent');
        // opponentMove closes over the current book; for a repertoire switch we play the first move directly
        const first = buildBook(r).get(posKey(new Chess().fen())) ?? ['e4'];
        const id = gameId.current;
        setTimeout(() => {
          if (id !== gameId.current) return;
          gameRef.current.move(first[Math.floor(Math.random() * first.length)]);
          sync();
          setStatus('user');
          startPreAnalysis();
        }, 400);
      } else {
        setStatus('user');
        startPreAnalysis();
      }
    },
    [repId, mode, colorChoice, opponentMove, startPreAnalysis, sync],
  );

  // Start a game once the engines are up
  useEffect(() => {
    if (engineReady) newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady]);

  // "Train this opening" from the review screen
  useEffect(() => {
    if (!trainRequest) return;
    setMode('train');
    setRepId(trainRequest.repertoireId);
    if (engineReady) newGame({ mode: 'train', repertoireId: trainRequest.repertoireId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainRequest]);

  /** Validate the user's move: book check while in the line, engine check after it. */
  const checkUserMove = useCallback(
    async (fenBefore: string, move: Move) => {
      if (mode === 'play') {
        opponentMove('free'); // regular game: no book, no coach
        return;
      }
      const id = gameId.current;
      const key = posKey(fenBefore);
      const bookMoves = phase === 'book' ? book.get(key) : undefined;
      // after the book: a move learned in an earlier game is checked just like a book move
      const learnedMove = bookMoves?.length ? undefined : learned[key];
      const expected = bookMoves?.length ? bookMoves : learnedMove ? [learnedMove] : undefined;

      if (expected?.length) {
        if (expected.includes(move.san)) {
          setNotice(learnedMove ? `זכרת! ✓ ${ltr(move.san)} הוא המהלך שלמדת כאן.` : '');
          opponentMove(learnedMove ? 'free' : 'book');
          return;
        }
        const correct = expected[0];
        saveMistake({ fen: fenBefore, played: move.san, correct, source: 'book', repertoire: rep.id });
        setMistakeCount(loadMistakes().length);
        setFeedback({
          kind: 'book',
          title: learnedMove ? 'שכחת את המהלך' : 'יצאת מהקו',
          text: learnedMove
            ? `במשחק קודם למדת שכאן המהלך הטוב ביותר הוא ${ltr(correct)}. שיחקת ${ltr(move.san)}.`
            : `בקו שלך משחקים כאן ${expected.map(ltr).join(' או ')}. שיחקת ${ltr(move.san)}.`,
          correctUci: sanToUci(fenBefore, correct),
          playedSan: move.san,
        });
        setStatus('paused');
        return;
      }

      // Free play: compare coach eval before vs after the move
      setStatus('checking');
      const pre =
        preAnalysis.current?.key === fenBefore
          ? await preAnalysis.current.promise
          : await coach.current!.analyze(fenBefore);
      if (id !== gameId.current) return;

      const bestSan = uciToSan(fenBefore, pre.bestMove);
      // still in the opening: remember the best move here, so next time it is checked like the book
      if (Number(fenBefore.split(' ')[5]) <= LEARN_UNTIL && learnMove(rep.id, fenBefore, bestSan)) {
        setLearnedVersion((v) => v + 1);
      }

      if (pre.bestMove === move.from + move.to + (move.promotion ?? '')) {
        setNotice(`✓ ${ltr(move.san)} — המהלך הטוב ביותר.`);
        opponentMove('free');
        return;
      }
      const post = await coach.current!.analyze(gameRef.current.fen());
      if (id !== gameId.current) return;
      setEvalWhite(whiteWinPercent(post, gameRef.current.fen()));

      const before = winPercent(pre);
      const after = 100 - winPercent(post); // post is from the opponent's perspective
      const drop = before - after;

      if (drop >= threshold) {
        saveMistake({ fen: fenBefore, played: move.san, correct: bestSan, source: 'engine', repertoire: rep.id, drop });
        setMistakeCount(loadMistakes().length);
        setFeedback({
          kind: 'engine',
          title: `${judge(drop)}: ${ltr(move.san)}`,
          text: `סיכויי הניצחון שלך ירדו מ-${ltr(Math.round(before) + '%')} ל-${ltr(Math.round(after) + '%')}. המהלך הטוב ביותר היה ${ltr(bestSan)}.`,
          correctUci: pre.bestMove,
          playedSan: move.san,
        });
        setStatus('paused');
      } else {
        // not a mistake — but still show what the best move was, without stopping
        setNotice(
          drop >= MIN_REMARK_DROP
            ? `המהלך הטוב ביותר היה ${ltr(bestSan)} (המהלך שלך איבד ${ltr(Math.round(drop) + '%')}).`
            : `✓ ${ltr(move.san)} — מהלך טוב (הטוב ביותר: ${ltr(bestSan)}).`,
        );
        opponentMove('free');
      }
    },
    [book, learned, mode, opponentMove, phase, rep.id, threshold],
  );

  const onPieceDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (status !== 'user' || !targetSquare) return false;
    const g = gameRef.current;
    if (g.turn() !== userColor) return false;
    const fenBefore = g.fen();
    let move: Move;
    try {
      move = g.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
    } catch {
      return false;
    }
    setHint(null);
    sync();
    checkUserMove(fenBefore, move);
    return true;
  };

  const { onSquareClick, clickStyles } = useClickToMove(
    fen,
    (color) => status === 'user' && color === userColor,
    (from, to) => onPieceDrop({ sourceSquare: from, targetSquare: to }),
  );

  const retry = () => {
    gameRef.current.undo();
    setFeedback(null);
    sync();
    setStatus('user');
    startPreAnalysis();
  };

  const continueAnyway = () => {
    const wasBook = feedback?.kind === 'book';
    setFeedback(null);
    if (wasBook) setNotice('המשכת מחוץ לקו — מכאן המאמן בודק אותך עם המנוע.');
    const p: Phase = wasBook ? 'free' : phase;
    setPhase(p);
    opponentMove(p);
  };

  const takeBack = () => {
    // undo the last full move pair (opponent + user)
    if (status !== 'user' && status !== 'over') return;
    const g = gameRef.current;
    gameId.current++;
    if (g.turn() === userColor && g.history().length >= 2) { g.undo(); g.undo(); }
    else if (g.turn() !== userColor && g.history().length >= 1) g.undo();
    sync();
    setStatus('user');
    setNotice('');
    // back inside the book?
    if (mode === 'train' && book.get(posKey(g.fen()))?.length) setPhase('book');
    startPreAnalysis();
  };

  const showHint = async () => {
    if (status !== 'user') return;
    const g = gameRef.current;
    const key = posKey(g.fen());
    const bookMoves = phase === 'book' ? book.get(key) : undefined;
    const expected = bookMoves?.length ? bookMoves : mode === 'train' && learned[key] ? [learned[key]] : undefined;
    if (expected?.length) {
      setHint(uciToArrow(sanToUci(g.fen(), expected[0]), BLUE_ARROW));
      return;
    }
    const a = preAnalysis.current?.key === g.fen() ? await preAnalysis.current.promise : await coach.current!.analyze(g.fen());
    setHint(uciToArrow(a.bestMove, BLUE_ARROW));
  };

  const arrows: Arrow[] = [];
  if (feedback) arrows.push(uciToArrow(feedback.correctUci, GREEN_ARROW));
  if (hint) arrows.push(hint);

  const last = history[history.length - 1];
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (last) {
    squareStyles[last.from] = { background: 'rgba(255, 210, 0, 0.35)' };
    squareStyles[last.to] = { background: feedback ? 'rgba(230, 60, 60, 0.45)' : 'rgba(255, 210, 0, 0.45)' };
  }
  Object.assign(squareStyles, clickStyles);

  const statusText: Record<Status, string> = {
    user: 'התור שלך',
    opponent: 'המחשב חושב…',
    checking: 'המאמן בודק את המהלך…',
    paused: 'עצירה לתיקון',
    over: 'המשחק נגמר',
  };

  const movePairs: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push(`${i / 2 + 1}. ${history[i].san}${history[i + 1] ? ' ' + history[i + 1].san : ''}`);
  }

  return (
    <div>
      <header>
        <button className="settings-toggle" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>
          ⚙ {mode === 'play' ? 'משחק רגיל' : rep.name} · רמה {skill} {settingsOpen ? '▴' : '▾'}
        </button>
        <div className={settingsOpen ? 'controls open' : 'controls'}>
          <label>
            מצב
            <select
              value={mode}
              onChange={(e) => {
                const m = e.target.value as Mode;
                setMode(m);
                newGame({ mode: m });
              }}
            >
              <option value="train">אימון פתיחות</option>
              <option value="play">משחק רגיל</option>
            </select>
          </label>
          {mode === 'train' ? (
            <label>
              פתיחה
              <select
                value={repId}
                onChange={(e) => {
                  setRepId(e.target.value);
                  newGame({ repertoireId: e.target.value });
                }}
              >
                {REPERTOIRES.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              צבע
              <select
                value={colorChoice}
                onChange={(e) => {
                  const c = e.target.value as ColorChoice;
                  setColorChoice(c);
                  newGame({ color: c });
                }}
              >
                {COLOR_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>
              רמת המחשב ({skill})
              {mode === 'train' && <span className="muted"> · ממהלך {LEARN_UNTIL + 1}</span>}
            </span>
            <input type="range" min={0} max={20} value={skill} onChange={(e) => setSkill(Number(e.target.value))} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showEval} onChange={(e) => setShowEval(e.target.checked)} />
            הצג מד סיכויים
          </label>
          {mode === 'train' && (
            <label>
              מתי לעצור
              <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                {THRESHOLDS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <main>
        <div className="board-wrap" dir="ltr">
          {showEval && <EvalBar white={evalWhite} orientation={userColor === 'w' ? 'white' : 'black'} />}
          <div className="board">
          <Chessboard
            options={{
              id: 'trainer',
              showAnimations: active, // a hidden board has no size to animate with (react-chessboard throws)
              position: fen,
              boardOrientation: userColor === 'w' ? 'white' : 'black',
              onPieceDrop,
              onSquareClick,
              arrows,
              squareStyles,
              allowDrawingArrows: false,
              canDragPiece: ({ piece }) => status === 'user' && piece.pieceType[0] === userColor,
            }}
          />
          </div>
        </div>

        <aside>
          <div className={`status status-${status}`}>
            {!engineReady ? 'טוען מנוע…' : statusText[status]}
            <span className="phase">
              {mode === 'play' ? `משחק רגיל — אתה ${userColor === 'w' ? 'לבן' : 'שחור'}` : phase === 'book' ? 'בתוך הקו' : 'משחק חופשי'}
            </span>
          </div>

          {feedback && (
            <div className={`feedback feedback-${feedback.kind}`}>
              <strong>{feedback.title}</strong>
              <p>{feedback.text}</p>
              <p className="muted">החץ הירוק מראה את המהלך הנכון.</p>
              <div className="buttons">
                <button className="primary" onClick={retry}>חזור ונסה</button>
                <button onClick={continueAnyway}>המשך בכל זאת</button>
              </div>
            </div>
          )}

          {notice && !feedback && <div className="notice">{notice}</div>}

          <div className="buttons">
            <button onClick={showHint} disabled={status !== 'user'}>רמז</button>
            <button onClick={takeBack} disabled={status !== 'user' && status !== 'over'}>החזר מהלך</button>
            <button onClick={() => newGame()}>משחק חדש</button>
          </div>

          <div className="moves" dir="ltr">
            {movePairs.length ? movePairs.join('  ') : '—'}
          </div>

          {mode === 'train' && (
            <div className="muted learned">
              מהלכים שלמדת בפתיחה הזו (מעבר לספר): {Object.keys(learned).length}
              {Object.keys(learned).length > 0 && (
                <button
                  className="small"
                  onClick={() => {
                    clearLearned(repId);
                    setLearnedVersion((v) => v + 1);
                  }}
                >
                  אפס
                </button>
              )}
            </div>
          )}
          {mode === 'train' && <div className="muted">טעויות שנשמרו לחזרה: {mistakeCount}</div>}
        </aside>
      </main>
    </div>
  );
}

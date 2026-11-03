import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { Engine, winPercent } from './engine';
import { REPERTOIRES, buildBook, posKey } from './repertoire';
import { loadMistakes, saveMistake } from './mistakes';
import './App.css';

type Phase = 'book' | 'free';
type Status = 'user' | 'opponent' | 'checking' | 'paused' | 'over';

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

// keep SAN / percentages left-to-right inside Hebrew text
const ltr = (t: string | number) => `\u2066${t}\u2069`;

const judge = (drop: number) => (drop >= 30 ? 'בלאנדר' : drop >= 20 ? 'טעות' : 'אי-דיוק');

const uciToArrow = (uci: string, color: string): Arrow => ({
  startSquare: uci.slice(0, 2),
  endSquare: uci.slice(2, 4),
  color,
});

const sanToUci = (fen: string, san: string) => {
  const m = new Chess(fen).move(san);
  return m.from + m.to + (m.promotion ?? '');
};

const uciToSan = (fen: string, uci: string) => {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' }).san;
  } catch {
    return uci;
  }
};

export default function App() {
  const [repId, setRepId] = useState(REPERTOIRES[0].id);
  const rep = REPERTOIRES.find((r) => r.id === repId)!;
  const book = useMemo(() => buildBook(rep), [rep]);

  const [skill, setSkill] = useState(3);
  const [threshold, setThreshold] = useState(20);

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

  const userColor = rep.userColor;

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
    if (!coach.current || g.isGameOver()) return;
    const key = g.fen();
    preAnalysis.current = { key, promise: coach.current.analyze(key) };
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

  /** Opponent's turn: book reply if we're still in the line, otherwise the weakened engine. */
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
          setNotice('סוף הקו בספר — מכאן משחקים חופשי, והמאמן ממשיך לבדוק אותך.');
        }
      }

      await new Promise((r) => setTimeout(r, 350)); // let the user see their move land
      if (id !== gameId.current) return;

      if (san) {
        g.move(san);
      } else {
        const res = await opponent.current!.analyze(g.fen(), 'movetime 400');
        if (id !== gameId.current) return;
        g.move({ from: res.bestMove.slice(0, 2), to: res.bestMove.slice(2, 4), promotion: res.bestMove[4] ?? 'q' });
      }
      setPhase(nextPhase);
      sync();
      if (finishIfOver()) return;
      // Still in book but the line ends on our move? Then free play starts now.
      if (nextPhase === 'book' && !book.get(posKey(g.fen()))?.length) {
        setPhase('free');
        setNotice('סוף הקו בספר — מכאן משחקים חופשי, והמאמן ממשיך לבדוק אותך.');
      }
      setStatus('user');
      startPreAnalysis();
    },
    [book, finishIfOver, startPreAnalysis, sync],
  );

  const newGame = useCallback(
    (repertoireId = repId) => {
      gameId.current++;
      gameRef.current = new Chess();
      setPhase('book');
      setFeedback(null);
      setNotice('');
      setHint(null);
      sync();
      opponent.current?.newGame();
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
    [repId, startPreAnalysis, sync],
  );

  // Start a game once the engines are up
  useEffect(() => {
    if (engineReady) newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady]);

  /** Validate the user's move: book check while in the line, engine check after it. */
  const checkUserMove = useCallback(
    async (fenBefore: string, move: Move) => {
      const id = gameId.current;
      const key = posKey(fenBefore);
      const expected = phase === 'book' ? book.get(key) : undefined;

      if (expected?.length) {
        if (expected.includes(move.san)) {
          setNotice('');
          opponentMove('book');
          return;
        }
        const correct = expected[0];
        saveMistake({ fen: fenBefore, played: move.san, correct, source: 'book', repertoire: rep.id });
        setMistakeCount(loadMistakes().length);
        setFeedback({
          kind: 'book',
          title: 'יצאת מהקו',
          text: `בקו שלך משחקים כאן ${expected.map(ltr).join(' או ')}. שיחקת ${ltr(move.san)}.`,
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

      if (pre.bestMove === move.from + move.to + (move.promotion ?? '')) {
        opponentMove('free');
        return;
      }
      const post = await coach.current!.analyze(gameRef.current.fen());
      if (id !== gameId.current) return;

      const before = winPercent(pre);
      const after = 100 - winPercent(post); // post is from the opponent's perspective
      const drop = before - after;

      if (drop >= threshold) {
        const bestSan = uciToSan(fenBefore, pre.bestMove);
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
        opponentMove('free');
      }
    },
    [book, opponentMove, phase, rep.id, threshold],
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
    if (book.get(posKey(g.fen()))?.length) setPhase('book');
    startPreAnalysis();
  };

  const showHint = async () => {
    if (status !== 'user') return;
    const g = gameRef.current;
    const expected = phase === 'book' ? book.get(posKey(g.fen())) : undefined;
    if (expected?.length) {
      setHint(uciToArrow(sanToUci(g.fen(), expected[0]), 'rgba(0, 120, 255, 0.7)'));
      return;
    }
    const a = preAnalysis.current?.key === g.fen() ? await preAnalysis.current.promise : await coach.current!.analyze(g.fen());
    setHint(uciToArrow(a.bestMove, 'rgba(0, 120, 255, 0.7)'));
  };

  const arrows: Arrow[] = [];
  if (feedback) arrows.push(uciToArrow(feedback.correctUci, 'rgba(0, 160, 60, 0.85)'));
  if (hint) arrows.push(hint);

  const last = history[history.length - 1];
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (last) {
    squareStyles[last.from] = { background: 'rgba(255, 210, 0, 0.35)' };
    squareStyles[last.to] = { background: feedback ? 'rgba(230, 60, 60, 0.45)' : 'rgba(255, 210, 0, 0.45)' };
  }

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
    <div className="app" dir="rtl">
      <header>
        <h1>מאמן פתיחות</h1>
        <div className="controls">
          <label>
            פתיחה
            <select
              value={repId}
              onChange={(e) => {
                setRepId(e.target.value);
                newGame(e.target.value);
              }}
            >
              {REPERTOIRES.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            רמת המחשב ({skill})
            <input type="range" min={0} max={20} value={skill} onChange={(e) => setSkill(Number(e.target.value))} />
          </label>
          <label>
            מתי לעצור
            <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
              {THRESHOLDS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main>
        <div className="board" dir="ltr">
          <Chessboard
            options={{
              position: fen,
              boardOrientation: userColor === 'w' ? 'white' : 'black',
              onPieceDrop,
              arrows,
              squareStyles,
              allowDrawingArrows: false,
              canDragPiece: ({ piece }) => status === 'user' && piece.pieceType[0] === userColor,
            }}
          />
        </div>

        <aside>
          <div className={`status status-${status}`}>
            {!engineReady ? 'טוען מנוע…' : statusText[status]}
            <span className="phase">{phase === 'book' ? 'בתוך הקו' : 'משחק חופשי'}</span>
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

          <div className="muted">טעויות שנשמרו לחזרה: {mistakeCount}</div>
        </aside>
      </main>
    </div>
  );
}

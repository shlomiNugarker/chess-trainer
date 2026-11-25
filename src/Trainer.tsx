import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { Chessboard, type Arrow } from 'react-chessboard';
import { DROP, Engine, whiteWinPercent, winPercent } from './engine';
import { REPERTOIRES, buildBook, lineInfo, noteForNext, posKey, repName } from './repertoire';
import { useHiddenRepertoires, visibleOf } from './hiddenReps';
import { useRepertoire, withCustom } from './customLines';
import { practiceMistakes, saveMistake, useMistakeCount } from './mistakes';
import { BLUE_ARROW, BOARD_THEME, GREEN_ARROW, LAST_MOVE, WRONG_MOVE, judge, ltr, pvToSan, sanToUci, uciToArrow, uciToSan } from './chessUtils';
import { useStored } from './storage';
import { LEARN_UNTIL, clearLearned, learnMove, loadLearned } from './learned';
import EvalBar from './EvalBar';
import { useClickToMove } from './useClickToMove';
import { playSound, setSoundOn, useMoveSound, useSoundOn } from './sound';
import { useScrollToMove } from './useScrollToMove';
import { useFitBoard } from './useFitBoard';
import { useSidePanel } from './useSidePanel';
import { useDialog } from './useDialog';
import { msg, tr, useLang } from './i18n';
import { go, useNav } from './nav';
import { loadGame, saveGame } from './savedGame';

/** Below this win% loss a non-best move is not worth a remark. */
const MIN_REMARK_DROP = 2;
const LEARN_STOP_DROP = 5; // in the learning zone, below this the correction does not stop the game

const bookEndNotice = () =>
  tr(msg`End of the book line. Up to move ${LEARN_UNTIL} the computer plays the best moves and each of your moves is checked — if there is a better one, you get a correction and can try again. The moves are saved for next time.`);

type Mode = 'train' | 'play'; // opening training, or a regular game against the engine
type Phase = 'book' | 'free';
type Status = 'user' | 'opponent' | 'checking' | 'paused' | 'over';
type Color = 'w' | 'b';
type ColorChoice = Color | 'random';

const colorChoices = (): { label: string; value: ColorChoice }[] => [
  { label: tr('White'), value: 'w' },
  { label: tr('Black'), value: 'b' },
  { label: tr('Random'), value: 'random' },
];

type Feedback = {
  kind: 'book' | 'engine';
  tone: 'info' | 'warn' | 'error'; // card accent: book line (blue), could be better (amber), mistake (red)
  title: string;
  text: string;
  correctUci: string; // arrow
  playedSan: string;
  why?: string; // the line's note on the right move
};

const thresholds = () => [
  { label: tr('Sensitive (from a 10% loss)'), value: 10 },
  { label: tr('Normal (from a 20% loss)'), value: 20 },
  { label: tr('Only big ones (from a 30% loss)'), value: 30 },
];

/** Why the game is a draw: without it, a stalemate in a winning position looks like a mistake of the app. */
const drawText = (g: Chess) =>
  g.isStalemate()
    ? tr('Draw: stalemate — the side to move has no legal move and is not in check.')
    : g.isInsufficientMaterial()
      ? tr('Draw: not enough pieces are left to give checkmate.')
      : g.isThreefoldRepetition()
        ? tr('Draw: the same position came up three times.')
        : tr('Draw: 50 moves by each side without a capture or a pawn move.');

/** A request from another screen to start training a repertoire (nonce makes repeats count). */
export type TrainRequest = { repertoireId: string; nonce: number };

const practiceCount = () => practiceMistakes().length;

export default function Trainer({ trainRequest, active = true }: { trainRequest?: TrainRequest | null; active?: boolean }) {
  const [saved] = useState(loadGame); // the game a reload interrupted, continued once the engines are up
  const [mode, setMode] = useState<Mode>(saved?.mode ?? 'train');
  const modeRef = useRef<Mode>(mode); // read by callbacks that must see a mode switch immediately
  const [colorChoice, setColorChoice] = useStored<ColorChoice>('color', 'w');
  const [playColor, setPlayColor] = useState<Color>(saved?.color ?? 'w'); // resolved color in play mode
  const [storedRepId, setRepId] = useStored('repertoire', REPERTOIRES[0].id);
  const rep = useRepertoire(storedRepId); // includes the branches added from your games
  const repId = rep.id;
  const { hidden: hiddenReps } = useHiddenRepertoires(); // hidden ones leave the picker (the current one stays)
  const book = useMemo(() => buildBook(rep), [rep]);
  const [learnedVersion, setLearnedVersion] = useState(0); // bump to re-read the learned store
  const [resetAsked, setResetAsked] = useState<string | null>(null); // the repertoire whose reset waits for a "yes"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const learned = useMemo(() => loadLearned(repId), [repId, learnedVersion]);

  const [skill, setSkill] = useStored('skill', 3);
  const [threshold, setThreshold] = useStored('threshold', 20);
  const [showEval, setShowEval] = useStored('show-eval', true);
  const [showNotes, setShowNotes] = useStored('show-notes', true); // line name + why each move is played
  const lang = useLang(); // notes and line names follow the language
  const [correctAll, setCorrectAll] = useStored('correct-all', true); // learning zone: correct every worse move
  // learned positions met in this game: posKey -> remembered on the first try?
  const [remembered, setRemembered] = useState<Record<string, boolean>>({});
  // last user move that was playable but not best: lets the user go back and play the better move
  const [undoable, setUndoable] = useState<{ ply: number; bestUci: string; bestSan: string } | null>(null);
  const learnedThisGame = useRef(new Set<string>()); // just taught — answering them right is not "remembering"
  const { sheet: settingsOpen } = useNav(); // phones: settings fold away to keep the board on screen
  const setSettingsOpen = (sheet: boolean) => go({ sheet });
  const sheet = useRef<HTMLDivElement>(null);
  useDialog(sheet, settingsOpen, () => setSettingsOpen(false));
  const showEvalRef = useRef(showEval);
  showEvalRef.current = showEval;
  const [evalWhite, setEvalWhite] = useState<number | null>(null); // White's win%, null = unknown

  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  useMoveSound(fen, active);
  const soundOn = useSoundOn();
  const [history, setHistory] = useState<Move[]>([]);
  const [phase, setPhase] = useState<Phase>('book');
  const [status, setStatus] = useState<Status>('user');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [hint, setHint] = useState<Arrow | null>(null);
  const mistakeCount = useMistakeCount(practiceCount);
  const [engineReady, setEngineReady] = useState(false);

  const opponent = useRef<Engine | null>(null);
  const coach = useRef<Engine | null>(null);
  const gameId = useRef(0); // bump to invalidate in-flight async work
  /** The game moved on (new game, take back…): drop the engine work of the position before. */
  const moveOn = () => {
    gameId.current++;
    preAnalysis.current = null;
    coach.current?.cancel();
    opponent.current?.cancel();
  };
  // Pre-computed coach analysis of the position where it's the user's turn
  const preAnalysis = useRef<{ key: string; promise: ReturnType<Engine['analyze']> } | null>(null);

  const userColor = mode === 'play' ? playColor : rep.userColor;

  useEffect(() => {
    opponent.current = new Engine();
    coach.current = new Engine();
    coach.current.ready.then(() => setEngineReady(true));
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
        ? g.turn() === userColor ? tr('Checkmate. You lost — try again.') : tr('Checkmate! You won.')
        : drawText(g),
    );
    // the win-chance bar shows the result, not the estimate from before the last move
    setEvalWhite(g.isCheckmate() ? (g.turn() === 'w' ? 0 : 100) : 50);
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
          setNotice(bookEndNotice());
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
        setNotice(bookEndNotice());
      }
      setStatus('user');
      startPreAnalysis();
    },
    [book, finishIfOver, startPreAnalysis, sync],
  );

  const newGame = useCallback(
    ({ repertoireId = repId, mode: m = mode, color: cc = colorChoice }: { repertoireId?: string; mode?: Mode; color?: ColorChoice } = {}) => {
      moveOn();
      modeRef.current = m;
      gameRef.current = new Chess();
      setPhase(m === 'play' ? 'free' : 'book');
      setFeedback(null);
      setNotice('');
      setHint(null);
      setEvalWhite(null);
      setRemembered({});
      setUndoable(null);
      learnedThisGame.current = new Set();
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
      const r = withCustom(REPERTOIRES.find((x) => x.id === repertoireId)!);
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

  // An opening hidden in "Learn" leaves the trainer too: move to the first one shown. Declared before the
  // "train this opening" effect, so an explicit request from the review still wins.
  useEffect(() => {
    if (!hiddenReps.includes(storedRepId)) return;
    const next = visibleOf(hiddenReps)[0].id;
    setRepId(next);
    if (engineReady && modeRef.current === 'train') newGame({ repertoireId: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenReps]);

  /** Continues the game from before the reload; false if there is none, or it was of another opening. */
  const continueGame = () => {
    // (gameId: the user already chose something else while the engine was loading)
    if (!saved || trainRequest || gameId.current !== 0 || (saved.mode === 'train' && saved.repertoire !== repId)) return false;
    const g = saved.board;
    moveOn();
    gameRef.current = g;
    const myTurn = g.turn() === userColor;
    const p: Phase = saved.phase === 'book' && (!myTurn || book.get(posKey(g.fen()))?.length) ? 'book' : 'free';
    setPhase(p);
    setNotice(tr('Your game goes on from where you stopped.'));
    sync();
    opponent.current?.newGame();
    if (myTurn) {
      setStatus('user');
      startPreAnalysis();
    } else opponentMove(p);
    return true;
  };

  // Start a game once the engines are up
  useEffect(() => {
    if (engineReady && !continueGame()) newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady]);

  // Keep the game for a reload: after every reply and every accepted move. A move that stopped for a correction is
  // not kept, so after a reload it is played again.
  useEffect(() => {
    if (!engineReady) return;
    if (status === 'over' || !history.length) saveGame(null);
    else if (status === 'user' || status === 'opponent') saveGame({ mode, repertoire: repId, color: playColor, phase, moves: history.map((m) => m.san) });
  }, [engineReady, history, status, mode, repId, playColor, phase]);

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
        // first try at a learned position counts toward "remembered N of M" (a retry does not)
        const fresh = learnedThisGame.current.has(key);
        const tally =
          learnedMove && !fresh && !(key in remembered) ? { ...remembered, [key]: expected.includes(move.san) } : remembered;
        if (tally !== remembered) setRemembered(tally);
        if (expected.includes(move.san)) {
          const hits = Object.values(tally).filter(Boolean).length;
          const seen = Object.keys(tally).length;
          setNotice(
            !learnedMove ? ''
              : fresh
                ? tr(msg`✓ ${move.san} — correct. Next time you get here you will need to remember it.`)
                : tr(msg`You remembered! ✓ ${move.san} is the move you learned here. (${hits} of ${seen} learned positions remembered this game)`),
          );
          opponentMove(learnedMove ? 'free' : 'book');
          return;
        }
        const correct = expected[0];
        saveMistake({ fen: fenBefore, played: move.san, correct, source: 'book', repertoire: rep.id });
        playSound('error', 0.12);
        setFeedback({
          kind: 'book',
          tone: 'info',
          title: learnedMove ? tr('You forgot the move') : tr('You left the line'),
          text: learnedMove
            ? tr(msg`In an earlier game you learned that the best move here is ${correct}. You played ${move.san}.`)
            : tr(msg`Your line plays ${expected.join(` ${tr('or')} `)} here. You played ${move.san}.`),
          correctUci: sanToUci(fenBefore, correct),
          playedSan: move.san,
          why: learnedMove ? undefined : noteForNext(rep, gameRef.current.history().slice(0, -1), correct),
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
      const inLearningZone = Number(fenBefore.split(' ')[5]) <= LEARN_UNTIL;
      // still in the opening: remember the move for this position, so next time it is checked like the book
      const learn = (san: string) => {
        if (inLearningZone && learnMove(rep.id, fenBefore, san)) {
          learnedThisGame.current.add(key);
          setLearnedVersion((v) => v + 1);
        }
      };

      if (pre.bestMove === move.from + move.to + (move.promotion ?? '')) {
        learn(bestSan);
        setNotice(tr(msg`✓ ${move.san} — the best move.`));
        opponentMove('free');
        return;
      }
      const post = await coach.current!.analyze(gameRef.current.fen());
      if (id !== gameId.current) return;
      setEvalWhite(whiteWinPercent(post, gameRef.current.fen()));

      const before = winPercent(pre);
      const after = 100 - winPercent(post); // post is from the opponent's perspective
      const drop = before - after;
      // an equally good move of your own is easier to remember than the engine's
      learn(drop < MIN_REMARK_DROP ? move.san : bestSan);

      // in the learning zone every clearly worse move gets corrected, not just mistakes above the threshold:
      // a small loss shows the better move (with "go back") without stopping, a real one stops the game
      const stopAt = inLearningZone && correctAll ? LEARN_STOP_DROP : threshold;
      if (drop >= stopAt) {
        saveMistake({ fen: fenBefore, played: move.san, correct: bestSan, source: 'engine', repertoire: rep.id, drop });
        const line = pvToSan(fenBefore, pre.pv);
        playSound('error', 0.12);
        setFeedback({
          kind: 'engine',
          tone: drop >= DROP.inaccuracy ? 'error' : 'warn',
          title: drop >= DROP.inaccuracy ? `${judge(drop)}: ${ltr(move.san)}` : tr(msg`There is better: ${bestSan}`),
          text:
            tr(msg`Best move: ${bestSan} (yours lost ${Math.round(drop) + '%'}; your win chance: ${Math.round(before) + '%'} → ${Math.round(after) + '%'}).`) + (line.includes(' ') ? ` ${tr(msg`Continuation: ${line}`)}` : ''),
          correctUci: pre.bestMove,
          playedSan: move.san,
        });
        setStatus('paused');
      } else {
        // not a mistake — still show the best move without stopping, and offer to go back and play it
        setNotice(
          drop >= MIN_REMARK_DROP
            ? tr(msg`The best move was ${bestSan} (yours lost ${Math.round(drop) + '%'}).`)
            : tr(msg`✓ ${move.san} — a good move (best: ${bestSan}).`),
        );
        if (drop >= MIN_REMARK_DROP) {
          setUndoable({ ply: gameRef.current.history().length - 1, bestUci: pre.bestMove, bestSan });
        }
        opponentMove('free');
      }
    },
    [book, correctAll, learned, mode, opponentMove, phase, remembered, rep, threshold],
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
    setUndoable(null);
    sync();
    checkUserMove(fenBefore, move);
    return true;
  };

  const { onSquareClick, onDrop, clickStyles } = useClickToMove(
    fen,
    (color) => status === 'user' && color === userColor,
    (from, to) => onPieceDrop({ sourceSquare: from, targetSquare: to }),
  );
  const boardRef = useFitBoard<HTMLDivElement>();
  const panelRef = useSidePanel<HTMLElement>();
  const movesRef = useScrollToMove<HTMLOListElement>(history.length);

  const retry = () => {
    gameRef.current.undo();
    setFeedback(null);
    sync();
    setStatus('user');
    startPreAnalysis();
  };

  /** Go back to before the last (not-best) move — even if the opponent already replied — and show the better one. */
  const goBack = () => {
    if (!undoable) return;
    const g = gameRef.current;
    moveOn(); // also drops an opponent reply that may still be on its way
    while (g.history().length > undoable.ply) g.undo();
    sync();
    setHint(uciToArrow(undoable.bestUci, GREEN_ARROW));
    setNotice(tr(msg`You went back. Play ${undoable.bestSan} — the green arrow shows it.`));
    setUndoable(null);
    setStatus('user');
    startPreAnalysis();
  };

  const continueAnyway = () => {
    const wasBook = feedback?.kind === 'book';
    setFeedback(null);
    if (wasBook) setNotice(tr('You continued off the line — from here the coach checks you with the engine.'));
    const p: Phase = wasBook ? 'free' : phase;
    setPhase(p);
    opponentMove(p);
  };

  const takeBack = () => {
    // undo the last full move pair (opponent + user)
    if (status !== 'user' && status !== 'over') return;
    const g = gameRef.current;
    moveOn();
    if (g.turn() === userColor && g.history().length >= 2) { g.undo(); g.undo(); }
    else if (g.turn() !== userColor && g.history().length >= 1) g.undo();
    sync();
    setStatus('user');
    setNotice('');
    setUndoable(null);
    setHint(null);
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
    const id = gameId.current;
    const fen = g.fen();
    const a = preAnalysis.current?.key === fen ? await preAnalysis.current.promise : await coach.current!.analyze(fen);
    // the user may have moved (or taken back, or started over) while the coach was thinking
    if (gameId.current === id && gameRef.current.fen() === fen) setHint(uciToArrow(a.bestMove, BLUE_ARROW));
  };

  const arrows: Arrow[] = [];
  if (feedback) arrows.push(uciToArrow(feedback.correctUci, GREEN_ARROW));
  if (hint) arrows.push(hint);

  const last = history[history.length - 1];
  // which line you are in, and why the last moves are played (training, inside the book)
  const info = useMemo(
    () => (mode === 'train' && phase === 'book' && showNotes ? lineInfo(rep, history.map((m) => m.san)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, mode, phase, rep, showNotes, lang],
  );
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (last) {
    squareStyles[last.from] = { background: LAST_MOVE };
    squareStyles[last.to] = { background: feedback ? WRONG_MOVE : LAST_MOVE };
  }
  Object.assign(squareStyles, clickStyles);

  const statusText: Record<Status, string> = {
    user: tr('Your move', 'turn'),
    opponent: tr('Computer is thinking…'),
    checking: tr('Coach is checking your move…'),
    paused: tr('Stopped to correct'),
    over: tr('Game over'),
  };

  const lastPly = history.length - 1;
  const learnedCount = Object.keys(learned).length;
  const toggle = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      {label}
    </label>
  );

  return (
    <div className="trainer">
      <header className="trainer-header">
        <button className="settings-toggle" onClick={() => setSettingsOpen(true)} aria-expanded={settingsOpen}>
          <span aria-hidden>⚙</span> {mode === 'play' ? tr('Regular game') : repName(rep)} · {tr('Level')} {skill}
        </button>
        {settingsOpen && <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />}
        <div
          ref={sheet}
          className={settingsOpen ? 'controls open' : 'controls'}
          {...(settingsOpen && { role: 'dialog', 'aria-modal': true, 'aria-label': tr('Game settings') })}
        >
          <div className="sheet-handle" aria-hidden />
          <label>
            {tr('Mode')}
            <select
              value={mode}
              onChange={(e) => {
                const m = e.target.value as Mode;
                setMode(m);
                newGame({ mode: m });
              }}
            >
              <option value="train">{tr('Opening training')}</option>
              <option value="play">{tr('Regular game')}</option>
            </select>
          </label>
          {mode === 'train' ? (
            <label>
              {tr('Opening')}
              <select
                value={repId}
                onChange={(e) => {
                  setRepId(e.target.value);
                  newGame({ repertoireId: e.target.value });
                }}
              >
                {REPERTOIRES.filter((r) => r.id === repId || !hiddenReps.includes(r.id)).map((r) => (
                  <option key={r.id} value={r.id}>{repName(r)}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              {tr('Color')}
              <select
                value={colorChoice}
                onChange={(e) => {
                  const c = e.target.value as ColorChoice;
                  setColorChoice(c);
                  newGame({ color: c });
                }}
              >
                {colorChoices().map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>
              {tr('Computer level')} <b>{skill}</b>
              {mode === 'train' && <span className="muted"> · {tr(msg`from move ${LEARN_UNTIL + 1}`)}</span>}
            </span>
            <input type="range" min={0} max={20} value={skill} onChange={(e) => setSkill(Number(e.target.value))} />
          </label>
          {/* the basics stay in view; finer control folds away so the screen stays simple */}
          <details className="more-settings">
            <summary>{tr('More options')}</summary>
            <div className="more-settings-body">
              <div className="toggles">
                {mode === 'train' && toggle(correctAll, setCorrectAll, tr(msg`Correct every move up to move ${LEARN_UNTIL}`))}
                {mode === 'train' && toggle(showNotes, setShowNotes, tr('Show the line name and explanations'))}
                {toggle(showEval, setShowEval, tr('Show win-chance bar'))}
                {toggle(soundOn, setSoundOn, tr('Sounds'))}
              </div>
              {mode === 'train' && (
                <label>
                  {correctAll ? tr(msg`When to stop (from move ${LEARN_UNTIL + 1})`) : tr('When to stop')}
                  <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                    {thresholds().map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
          <button className="primary sheet-done" onClick={() => setSettingsOpen(false)}>{tr('Done')}</button>
        </div>
      </header>

      <main>
        <div className="board-wrap" dir="ltr" ref={boardRef}>
          {showEval && <EvalBar white={evalWhite} orientation={userColor === 'w' ? 'white' : 'black'} />}
          <div className="board">
            <Chessboard
              options={{
                id: 'trainer',
                showAnimations: active, // a hidden board has no size to animate with (react-chessboard throws)
                position: fen,
                boardOrientation: userColor === 'w' ? 'white' : 'black',
                onPieceDrop: ({ sourceSquare, targetSquare }) => onDrop(sourceSquare, targetSquare),
                onSquareClick,
                arrows,
                squareStyles,
                ...BOARD_THEME,
                allowDrawingArrows: false,
                canDragPiece: ({ piece }) => status === 'user' && piece.pieceType[0] === userColor,
              }}
            />
          </div>
        </div>

        <aside ref={panelRef}>
          <div className={`status status-${status}`}>
            <span className="status-dot" aria-hidden />
            <span className="status-text">{!engineReady ? tr('Loading engine…') : statusText[status]}</span>
            <span className="pill">
              {mode === 'play'
                ? `${tr('Regular game')} · ${userColor === 'w' ? tr('White') : tr('Black')}`
                : phase === 'book'
                  ? tr('In the line')
                  : tr('Free play')}
            </span>
          </div>

          {feedback && (
            <div className={`card feedback tone-${feedback.tone}`}>
              <strong>{feedback.title}</strong>
              <p>{feedback.text}</p>
              {feedback.why && showNotes && <p className="why"><b>{tr('Why:')}</b> {feedback.why}</p>}
              <p className="muted hint-text">{tr('The green arrow shows the right move.')}</p>
              <div className="buttons">
                <button className="primary" onClick={retry}>↩ {tr('Try again', 'go back')}</button>
                <button className="ghost" onClick={continueAnyway}>{tr('Continue anyway')}</button>
              </div>
            </div>
          )}

          {info && !feedback && (
            <div className="card line-info">
              <div className="line-info-head">
                <span aria-hidden>📖</span>
                <strong>{info.name}</strong>
                {info.others > 0 && <span className="muted">{info.others === 1 ? tr('(+1 more line from here)') : tr(msg`(${'+' + info.others} more lines from here)`)}</span>}
              </div>
              {info.notes.map((n) => (
                <p key={n.label}>
                  <span className="note-label" dir="ltr">{n.label}</span> {n.text}
                </p>
              ))}
            </div>
          )}

          {notice && !feedback && (
            <div className={`card notice${undoable ? ' tone-warn' : ''}`}>
              <p>{notice}</p>
              {undoable && (
                <div className="buttons">
                  <button className="primary" onClick={goBack}>↩ {tr('Go back and play')} {ltr(undoable.bestSan)}</button>
                </div>
              )}
            </div>
          )}

          <div className="actions">
            <button onClick={showHint} disabled={status !== 'user'}>
              <span className="icon" aria-hidden>💡</span>{tr('Hint')}
            </button>
            <button onClick={takeBack} disabled={status !== 'user' && status !== 'over'}>
              <span className="icon" aria-hidden>↶</span>{tr('Take back')}
            </button>
            <button onClick={() => newGame()}>
              <span className="icon" aria-hidden>＋</span>{tr('New game')}
            </button>
          </div>

          <ol className="moves" dir="ltr" ref={movesRef}>
            {history.length === 0 && <li className="moves-empty">—</li>}
            {history.map((m, i) =>
              i % 2 === 0 ? (
                <li key={i}>
                  <span className="move-no">{i / 2 + 1}.</span>
                  <span className={i === lastPly ? 'move last' : 'move'}>{m.san}</span>
                  <span className={i + 1 === lastPly ? 'move last' : 'move'}>{history[i + 1]?.san ?? ''}</span>
                </li>
              ) : null,
            )}
          </ol>

          {mode === 'train' && (
            <div className="stats">
              <span className="chip-stat" title={tr('Moves you learned in this opening, beyond the book')}>
                {tr('Learned')} <b>{learnedCount}</b>
                {learnedCount > 0 &&
                  (resetAsked === repId ? (
                    <>
                      {' '}
                      <button
                        className="link danger"
                        onClick={() => {
                          clearLearned(repId);
                          setLearnedVersion((v) => v + 1);
                          setResetAsked(null);
                        }}
                      >
                        {tr(msg`Yes, reset (${learnedCount})`)}
                      </button>{' '}
                      <button className="link" onClick={() => setResetAsked(null)}>{tr('Cancel')}</button>
                    </>
                  ) : (
                    <button className="link" onClick={() => setResetAsked(repId)}>{tr('Reset')}</button>
                  ))}
              </span>
              <span className="chip-stat" title={tr('Mistakes saved for review')}>
                {tr('To review')} <b>{mistakeCount}</b>
              </span>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

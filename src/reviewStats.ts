// Turns a player's games into a short, actionable review.
// Everything except analyzeGame() is pure and runs instantly on thousands of games.

import { Chess } from 'chess.js';
import type { GameSummary, TimeClass } from './chesscom.ts';
import { type Engine, winPercent } from './engine.ts';
import { tr } from './i18n.ts';

export type Score = { games: number; wins: number; draws: number; losses: number; score: number }; // score 0..100

export type OpeningRow = Score & { name: string; repertoireId?: string };

export type Overview = {
  total: Score;
  byColor: { w: Score; b: Score };
  byTimeClass: (Score & { timeClass: TimeClass; rating: number })[];
  openings: { w: OpeningRow[]; b: OpeningRow[] };
  lossReasons: { reason: string; count: number }[];
  shortLosses: number; // losses within SHORT_GAME moves
  accuracy: { avg: number; games: number } | null;
  ratingSeries: { timeClass: TimeClass; points: { t: number; r: number }[] } | null;
};

export const SHORT_GAME = 25;
export const MIN_OPENING_GAMES = 5;

// labels are functions, not constants, so they follow the current language
const REASONS: Record<string, [string, string]> = {
  checkmated: ['מט', 'Checkmate'],
  resigned: ['כניעה', 'Resigned'],
  timeout: ['נגמר הזמן', 'Out of time'],
  abandoned: ['נטישה', 'Abandoned'],
  agreed: ['הסכמה', 'Agreed'],
  repetition: ['חזרה על עמדה', 'Repetition'],
  stalemate: ['פט', 'Stalemate'],
  insufficient: ['חומר לא מספיק', 'Insufficient material'],
  timevsinsufficient: ['זמן מול חומר לא מספיק', 'Time vs. insufficient material'],
  '50move': ['חוק 50 המהלכים', '50-move rule'],
};
export const reasonLabel = (reason: string) => (REASONS[reason] ? tr(...REASONS[reason]) : reason);

const TIME_CLASSES: Record<TimeClass, [string, string]> = {
  bullet: ['בולט', 'Bullet'],
  blitz: ['בליץ', 'Blitz'],
  rapid: ['רפיד', 'Rapid'],
  daily: ['יומי', 'Daily'],
};
export const timeClassLabel = (tc: TimeClass) => tr(...TIME_CLASSES[tc]);

export function score(games: GameSummary[]): Score {
  const wins = games.filter((g) => g.result === 'win').length;
  const draws = games.filter((g) => g.result === 'draw').length;
  const losses = games.length - wins - draws;
  return { games: games.length, wins, draws, losses, score: games.length ? ((wins + draws / 2) / games.length) * 100 : 0 };
}

/** Which of our repertoires (if any) trains this opening, for the side the user played. */
export function matchRepertoire(openingFull: string, color: 'w' | 'b'): string | undefined {
  // match the opening's own name (its start), not a sub-variation: "Caro Kann Defense Two Knights Attack" is not the
  // Italian, "English Opening Caro Kann Defensive System" is not the Caro-Kann
  if (color === 'w' && /London System/.test(openingFull)) return 'london';
  if (color === 'w' && /^(Italian Game|Giuoco|Two Knights Defense)/.test(openingFull)) return 'italian';
  // the 1.e4 repertoire also answers the Scandinavian, the Sicilian (Alapin), the French and Caro-Kann (Advance), the Modern
  if (color === 'w' && /^(Scandinavian Defense|Sicilian Defense Alapin|French Defense Advance|Caro Kann Defense Advance|Modern Defense)/.test(openingFull)) return 'italian';
  if (color === 'b' && /^Caro Kann Defense/.test(openingFull)) return 'caro';
  // the Slav repertoire also has lines against the London and the Colle
  if (color === 'b' && /^(Slav Defense|Queens Gambit Declined Slav)|London System|Colle System/.test(openingFull)) return 'slav';
  return undefined;
}

function groupBy<T>(items: T[], key: (t: T) => string) {
  const map = new Map<string, T[]>();
  for (const it of items) map.set(key(it), [...(map.get(key(it)) ?? []), it]);
  return map;
}

function openingRows(games: GameSummary[], color: 'w' | 'b'): OpeningRow[] {
  const mine = games.filter((g) => g.color === color);
  return [...groupBy(mine, (g) => g.opening)]
    .map(([name, gs]) => ({
      name,
      ...score(gs),
      repertoireId: gs.map((g) => matchRepertoire(g.openingFull, color)).find(Boolean),
    }))
    .sort((a, b) => b.games - a.games);
}

export function buildOverview(games: GameSummary[]): Overview {
  const losses = games.filter((g) => g.result === 'loss');

  const byTimeClass = [...groupBy(games, (g) => g.timeClass)]
    .map(([tc, gs]) => ({ timeClass: tc as TimeClass, rating: gs[gs.length - 1].myRating, ...score(gs) }))
    .sort((a, b) => b.games - a.games);

  const reviewed = games.filter((g) => g.accuracy !== undefined);
  const main = byTimeClass[0]?.timeClass;
  const mainGames = games.filter((g) => g.timeClass === main && g.rated);

  return {
    total: score(games),
    byColor: { w: score(games.filter((g) => g.color === 'w')), b: score(games.filter((g) => g.color === 'b')) },
    byTimeClass,
    openings: { w: openingRows(games, 'w'), b: openingRows(games, 'b') },
    lossReasons: [...groupBy(losses, (g) => g.reason)]
      .map(([reason, gs]) => ({ reason, count: gs.length }))
      .sort((a, b) => b.count - a.count),
    shortLosses: losses.filter((g) => g.moveCount <= SHORT_GAME).length,
    accuracy: reviewed.length
      ? { avg: reviewed.reduce((s, g) => s + g.accuracy!, 0) / reviewed.length, games: reviewed.length }
      : null,
    ratingSeries: mainGames.length >= 2
      ? { timeClass: main, points: mainGames.map((g) => ({ t: g.endTime, r: g.myRating })) }
      : null,
  };
}

// ---------- deep (engine) analysis ----------

export type GamePhase = 'opening' | 'middlegame' | 'endgame';
export type MoveKind = 'inaccuracy' | 'mistake' | 'blunder';

const PHASES: Record<GamePhase, [string, string]> = {
  opening: ['פתיחה', 'opening'],
  middlegame: ['אמצע המשחק', 'middlegame'],
  endgame: ['סיום', 'endgame'],
};
export const phaseLabel = (p: GamePhase) => tr(...PHASES[p]);

export type GameMistake = {
  fen: string; // position before the move, user to move
  moveNumber: number;
  played: string; // SAN
  best: string; // SAN
  bestUci: string;
  drop: number; // win% lost
  kind: MoveKind;
  phase: GamePhase;
  gameUrl: string;
};

export type GameAnalysis = { url: string; userMoves: number; mistakes: GameMistake[] };

export const kindOf = (drop: number): MoveKind | null =>
  drop >= 30 ? 'blunder' : drop >= 20 ? 'mistake' : drop >= 10 ? 'inaccuracy' : null;

/** Opening up to move 12; endgame once at most 6 pieces (not kings/pawns) are left; middlegame otherwise. */
export function phaseOf(fen: string, moveNumber: number): GamePhase {
  if (moveNumber <= 12) return 'opening';
  const pieces = fen.split(' ')[0].replace(/[^nbrqNBRQ]/g, '').length;
  return pieces <= 6 ? 'endgame' : 'middlegame';
}

/** Evaluate every position of the game once and flag the user's moves that lost >= 10% win chance. */
export async function analyzeGame(
  engine: Engine,
  game: GameSummary,
  opts: { movetime?: number; cancelled?: () => boolean; onPosition?: (done: number, total: number) => void } = {},
): Promise<GameAnalysis | null> {
  const c = new Chess();
  try {
    c.loadPgn(game.pgn);
  } catch {
    return null; // unusual PGN (e.g. custom start position) — skip it
  }
  const moves = c.history({ verbose: true });
  const fens = [moves[0]?.before ?? c.fen(), ...moves.map((m) => m.after)];

  const movetime = opts.movetime ?? 100;
  const evals: Awaited<ReturnType<Engine['analyze']>>[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (opts.cancelled?.()) return null;
    evals.push(await engine.analyze(fens[i], `movetime ${movetime}`));
    opts.onPosition?.(i + 1, fens.length);
  }

  const dropAt = (i: number) => winPercent(evals[i]) - (100 - winPercent(evals[i + 1])); // user to move at i
  const mistakes: GameMistake[] = [];
  let userMoves = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.color !== game.color) continue;
    userMoves++;
    if (!kindOf(dropAt(i))) continue;
    // A fast search is noisy: confirm every suspect with a 6x longer look at both positions.
    if (opts.cancelled?.()) return null;
    evals[i] = await engine.analyze(fens[i], `movetime ${movetime * 6}`);
    evals[i + 1] = await engine.analyze(fens[i + 1], `movetime ${movetime * 6}`);
    const drop = dropAt(i);
    const kind = kindOf(drop);
    const bestUci = evals[i].bestMove;
    if (!kind || bestUci === m.from + m.to + (m.promotion ?? '')) continue;
    const moveNumber = Math.floor(i / 2) + 1;
    const best = new Chess(m.before).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] ?? 'q' }).san;
    mistakes.push({ fen: m.before, moveNumber, played: m.san, best, bestUci, drop, kind, phase: phaseOf(m.before, moveNumber), gameUrl: game.url });
  }
  return { url: game.url, userMoves, mistakes };
}

export type DeepSummary = {
  games: number;
  counts: Record<MoveKind, number>;
  byPhase: Record<GamePhase, number>; // mistakes + blunders
  worst: GameMistake[];
};

export function summarizeDeep(analyses: GameAnalysis[]): DeepSummary {
  const all = analyses.flatMap((a) => a.mistakes);
  const counts = { inaccuracy: 0, mistake: 0, blunder: 0 };
  const byPhase = { opening: 0, middlegame: 0, endgame: 0 };
  for (const m of all) {
    counts[m.kind]++;
    if (m.kind !== 'inaccuracy') byPhase[m.phase]++;
  }
  return {
    games: analyses.length,
    counts,
    byPhase,
    worst: all.filter((m) => m.kind !== 'inaccuracy').sort((a, b) => b.drop - a.drop).slice(0, 8),
  };
}

// ---------- the "3 things to improve" ----------

export type TipAction = { type: 'train'; repertoireId: string } | { type: 'drill' } | { type: 'deep' };
export type Tip = { title: string; text: string; action?: TipAction; weight: number };

const pct = (n: number) => `${Math.round(n)}%`;

export function buildTips(o: Overview, deep: DeepSummary | null): Tip[] {
  const tips: Tip[] = [];
  const losses = o.total.losses;

  const timeouts = o.lossReasons.find((r) => r.reason === 'timeout')?.count ?? 0;
  if (losses >= 10 && timeouts / losses >= 0.2) {
    tips.push({
      title: tr('השעון מפיל אותך', 'The clock is beating you'),
      text: tr(
        `${pct((timeouts / losses) * 100)} מההפסדים שלך הם על זמן. נסה משחקים ארוכים יותר (רפיד 10+5), ובעמדות פשוטות שחק מהר יותר.`,
        `${pct((timeouts / losses) * 100)} of your losses are on time. Try longer games (rapid 10+5), and play faster in simple positions.`,
      ),
      weight: (timeouts / losses) * 100,
    });
  }

  for (const color of ['w', 'b'] as const) {
    const weak = o.openings[color]
      .filter((r) => r.games >= MIN_OPENING_GAMES && r.score < o.byColor[color].score - 10)
      .sort((a, b) => a.score - b.score)[0];
    if (!weak) continue;
    const side = color === 'w' ? tr('בלבן', 'as White') : tr('בשחור', 'as Black');
    tips.push({
      title: tr(`הפתיחה החלשה ${side}: ${weak.name}`, `Your weakest opening ${side}: ${weak.name}`),
      text: weak.repertoireId
        ? tr(
            `אתה משיג רק ${pct(weak.score)} ב-${weak.games} משחקים. יש לך כאן קווים מוכנים — תתאמן עליהם.`,
            `You score only ${pct(weak.score)} in ${weak.games} games. There are ready lines for it here — train them.`,
          )
        : tr(
            `אתה משיג רק ${pct(weak.score)} ב-${weak.games} משחקים. בחר קו אחד מוכן לפתיחה הזו ולמד אותו עד מהלך 10.`,
            `You score only ${pct(weak.score)} in ${weak.games} games. Pick one ready line for this opening and learn it to move 10.`,
          ),
      action: weak.repertoireId ? { type: 'train', repertoireId: weak.repertoireId } : undefined,
      weight: o.byColor[color].score - weak.score + weak.games / 5,
    });
  }

  const gap = o.byColor.w.score - o.byColor.b.score;
  if (Math.abs(gap) >= 10 && o.byColor.w.games >= 10 && o.byColor.b.games >= 10) {
    const weakSide = gap > 0 ? tr('שחור', 'Black') : tr('לבן', 'White');
    tips.push({
      title: tr('פער גדול בין הצבעים', 'A big gap between colors'),
      text: tr(
        `עם לבן אתה משיג ${pct(o.byColor.w.score)} ועם שחור ${pct(o.byColor.b.score)}. כדאי להשקיע בפתיחות עם ${weakSide}.`,
        `As White you score ${pct(o.byColor.w.score)} and as Black ${pct(o.byColor.b.score)}. Put time into your openings with ${weakSide}.`,
      ),
      weight: Math.abs(gap),
    });
  }

  if (losses >= 10 && o.shortLosses / losses >= 0.3) {
    tips.push({
      title: tr('הפסדים מוקדמים', 'Early losses'),
      text: tr(
        `${pct((o.shortLosses / losses) * 100)} מההפסדים שלך נגמרים עד מהלך ${SHORT_GAME}. לפני כל מהלך שאל: מה היריב מאיים? והאם כל הכלים שלי מוגנים?`,
        `${pct((o.shortLosses / losses) * 100)} of your losses end by move ${SHORT_GAME}. Before every move ask: what is my opponent threatening, and are all my pieces protected?`,
      ),
      weight: (o.shortLosses / losses) * 80,
    });
  }

  if (deep && deep.games) {
    const perGame = deep.counts.blunder / deep.games;
    const [phase, n] = (Object.entries(deep.byPhase) as [GamePhase, number][]).sort((a, b) => b[1] - a[1])[0];
    if (n > 0) {
      tips.push({
        title: tr(`רוב הטעויות שלך: ב${phaseLabel(phase)}`, `Most of your mistakes: in the ${phaseLabel(phase)}`),
        text: tr(
          `ב-${deep.games} המשחקים שנותחו היו ${deep.counts.blunder} בלאנדרים (${perGame.toFixed(1)} למשחק). הן מחכות לך במסך החזרה.`,
          `The ${deep.games} analyzed games had ${deep.counts.blunder} blunders (${perGame.toFixed(1)} per game). They are waiting for you in Review.`,
        ),
        action: { type: 'drill' },
        weight: 40 + perGame * 20,
      });
    }
  } else {
    tips.push({
      title: tr('מצא את הטעויות שלך', 'Find your mistakes'),
      text: tr(
        'הרץ ניתוח מנוע על המשחקים האחרונים. כל טעות שתמצא תהפוך לתרגיל במסך החזרה.',
        'Run an engine analysis of your recent games. Every mistake it finds becomes an exercise in Review.',
      ),
      action: { type: 'deep' },
      weight: 1,
    });
  }

  return tips.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

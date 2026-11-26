// Turns a player's games into a short, actionable review.
// Everything except analyzeGame() is pure and runs instantly on thousands of games.

import { UNKNOWN, type GameSummary, type TimeClass } from './chesscom.ts';
import { DROP, type Engine } from './engine.ts';
import { uciToSan } from './chessUtils.ts';
import { analyzePositions, dropOf, loadReview, parseGame, saveReview, type Eval } from './gameAnalysis.ts';
import { msg, tr, trKey } from './i18n.ts';

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
/** A "strongest" opening needs more games than a weak one: a high score from a handful of games is mostly luck. */
export const MIN_STRONG_GAMES = 10;
/** ...and must beat the user's own average with that color by this many points. */
export const STRONG_MARGIN = 5;

/** Chess.com files games with no recognized opening as "Undefined" (and we say UNKNOWN when there is no name) — not an opening. */
const isNamed = (r: OpeningRow) => r.name !== 'Undefined' && r.name !== UNKNOWN;

/** The (up to) 3 lowest-scoring openings with enough games. */
export function weakestOpenings(rows: OpeningRow[]): OpeningRow[] {
  return rows
    .filter((r) => isNamed(r) && r.games >= MIN_OPENING_GAMES)
    .sort((a, b) => a.score - b.score || b.games - a.games)
    .slice(0, 3);
}

/** The (up to) 3 best-scoring openings with enough games that clearly beat the user's average with that color. */
export function strongestOpenings(rows: OpeningRow[], average: number): OpeningRow[] {
  return rows
    .filter((r) => isNamed(r) && r.games >= MIN_STRONG_GAMES && r.score >= average + STRONG_MARGIN)
    .sort((a, b) => b.score - a.score || b.games - a.games)
    .slice(0, 3);
}

// labels are functions, not constants, so they follow the current language
const REASONS: Record<string, string> = {
  checkmated: trKey('Checkmate'),
  resigned: trKey('Resigned'),
  timeout: trKey('Out of time'),
  abandoned: trKey('Abandoned'),
  aborted: trKey('Aborted'),
  agreed: trKey('Agreed'),
  repetition: trKey('Repetition'),
  stalemate: trKey('Stalemate'),
  insufficient: trKey('Insufficient material'),
  timevsinsufficient: trKey('Time vs. insufficient material'),
  '50move': trKey('50-move rule'),
};
export const reasonLabel = (reason: string) => (REASONS[reason] ? tr(REASONS[reason]) : reason);

const TIME_CLASSES: Record<TimeClass, string> = {
  bullet: trKey('Bullet'),
  blitz: trKey('Blitz'),
  rapid: trKey('Rapid'),
  daily: trKey('Daily'),
};
export const timeClassLabel = (tc: TimeClass) => tr(TIME_CLASSES[tc]);

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
  if (color === 'w' && /Colle System/.test(openingFull)) return 'colle';
  // 1.d4 d5 2.c4: the Queen's Gambit and the defenses it answers
  if (color === 'w' && /^(Queens Gambit|Slav Defense|Semi Slav Defense|Tarrasch Defense|Albin Countergambit|Chigorin Defense|Baltic Defense|Marshall Defense)/.test(openingFull)) return 'qg';
  if (color === 'w' && /^(Italian Game|Giuoco|Two Knights Defense|Bishops Opening)/.test(openingFull)) return 'italian';
  // 1.e4 e5 2.Nf3 with 3.Bb5, and Black's other second moves it answers (the Petrov, the Latvian)
  if (color === 'w' && /^(Ruy Lopez|Petrovs Defense|Russian Game|Latvian Opening|Latvian Gambit)/.test(openingFull)) return 'ruy';
  if (color === 'w' && /^Scotch Game/.test(openingFull)) return 'scotch';
  if (color === 'w' && /^Kings Gambit/.test(openingFull)) return 'kingsgambit';
  if (color === 'w' && /^Vienna Game/.test(openingFull)) return 'vienna';
  // the 1.e4 repertoire also answers the Scandinavian, the Sicilian (Alapin), the French and Caro-Kann (Advance), the Modern,
  // the Pirc, the Philidor, the Owen and the Nimzowitsch
  if (color === 'w' && /^(Scandinavian Defense|Sicilian Defense Alapin|French Defense Advance|Caro Kann Defense Advance|Modern Defense|Pirc Defense|Philidor Defense|Owens Defense|Nimzowitsch Defense)/.test(openingFull)) return 'italian';
  // the other Sicilians as White: the Open Sicilian (2.Nf3 and 3.d4), not the ones White plays without d4
  if (color === 'w' && /^Sicilian Defense/.test(openingFull) && !/(Closed|Smith Morra|Grand Prix|Rossolimo|Moscow|Bowdler|Wing Gambit)/.test(openingFull)) return 'opensic';
  // 1...e5 with 2...Nc6 and 3...Bc5: not the Two Knights (3...Nf6), the Petrov or the Philidor
  if (color === 'b' && !/Two Knights Defense/.test(openingFull) && /^(Italian Game|Giuoco|Evans Gambit|Ruy Lopez|Scotch Game|Four Knights Game|Ponziani Opening|Vienna Game|Bishops Opening|Kings Gambit|Center Game|Kings Pawn Opening Wayward Queen)/.test(openingFull)) return 'e5';
  if (color === 'b' && /^Scandinavian Defense/.test(openingFull)) return 'scandinavian';
  if (color === 'b' && /^Alekhine Defense/.test(openingFull)) return 'alekhine';
  if (color === 'b' && /^(Petrovs Defense|Russian Game)/.test(openingFull)) return 'petrov';
  if (color === 'b' && /^French Defense/.test(openingFull)) return 'french';
  if (color === 'b' && /^Kings Indian Defense/.test(openingFull)) return 'kid';
  if (color === 'b' && /^(English Opening|Reti Opening|Zukertort Opening)/.test(openingFull)) return 'flank';
  if (color === 'w' && /^English Opening/.test(openingFull)) return 'english';
  if (color === 'b' && /^Dutch Defense/.test(openingFull)) return 'dutch';
  if (color === 'b' && /^Pirc Defense/.test(openingFull)) return 'pirc';
  if (color === 'b' && /^Modern Defense/.test(openingFull)) return 'modern';
  if (color === 'b' && /^Caro Kann Defense/.test(openingFull)) return 'caro';
  if (color === 'b' && /^Sicilian Defense.*Najdorf/.test(openingFull)) return 'najdorf';
  if (color === 'b' && /^Sicilian Defense/.test(openingFull)) return 'sicilian';
  if (color === 'b' && /^Queens Gambit Accepted/.test(openingFull)) return 'qga';
  // the Slav repertoire also has lines against the London and the Colle
  if (color === 'b' && /^(Slav Defense|Queens Gambit Declined Slav)|London System|Colle System/.test(openingFull)) return 'slav';
  // after the Slav (its Chess.com names start with "Queens Gambit Declined Slav")
  if (color === 'b' && /^(Queens Gambit Declined|Catalan Opening)/.test(openingFull)) return 'qgd';
  if (color === 'b' && /^(Nimzo Indian Defense|Queens Indian Defense|Bogo Indian Defense)/.test(openingFull)) return 'nimzo';
  if (color === 'b' && /^Grunfeld Defense/.test(openingFull)) return 'grunfeld';
  if (color === 'b' && /^(Benko Gambit|Benoni Defense)/.test(openingFull)) return 'benko';
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

// ---------- accuracy over time ----------

export type MonthPoint = { month: string; t: number; avg: number; n: number }; // month "2026-11", t = its middle (ms)
export const MIN_MONTH_GAMES = 3; // fewer games in a month is mostly noise

/** Average accuracy per calendar month (months with too few games are left out), oldest first. */
export function accuracyByMonth(items: { t: number; acc: number }[], minGames = MIN_MONTH_GAMES): MonthPoint[] {
  const by = new Map<string, number[]>();
  for (const { t, acc } of items) {
    const d = new Date(t);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    by.set(key, [...(by.get(key) ?? []), acc]);
  }
  return [...by]
    .filter(([, accs]) => accs.length >= minGames)
    .map(([month, accs]) => {
      const [y, m] = month.split('-').map(Number);
      return { month, t: new Date(y, m - 1, 15).getTime(), avg: accs.reduce((s, a) => s + a, 0) / accs.length, n: accs.length };
    })
    .sort((a, b) => a.t - b.t);
}

/** The latest month against the average of the (up to) 3 months before it; null without enough months. */
export function accuracyTrend(points: MonthPoint[]): { last: MonthPoint; before: number; delta: number } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points.slice(-4, -1);
  const before = prev.reduce((s, p) => s + p.avg, 0) / prev.length;
  return { last, before, delta: last.avg - before };
}

// ---------- deep (engine) analysis ----------

export type GamePhase = 'opening' | 'middlegame' | 'endgame';
export type MoveKind = 'inaccuracy' | 'mistake' | 'blunder';

const PHASES: Record<GamePhase, string> = {
  opening: trKey('opening'),
  middlegame: trKey('middlegame'),
  endgame: trKey('endgame'),
};
export const phaseLabel = (p: GamePhase) => tr(PHASES[p]);

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
  drop >= DROP.blunder ? 'blunder' : drop >= DROP.mistake ? 'mistake' : drop >= DROP.inaccuracy ? 'inaccuracy' : null;

/** Opening up to move 12; endgame once at most 6 pieces (not kings/pawns) are left; middlegame otherwise. */
export function phaseOf(fen: string, moveNumber: number): GamePhase {
  if (moveNumber <= 12) return 'opening';
  const pieces = fen.split(' ')[0].replace(/[^nbrqNBRQ]/g, '').length;
  return pieces <= 6 ? 'endgame' : 'middlegame';
}

/**
 * The user's mistakes in a game, from the same analysis as the game review (by depth, so the two always agree);
 * a game that was reviewed before is not searched again.
 */
export async function analyzeGame(
  engine: Pick<Engine, 'analyze'> & Partial<Pick<Engine, 'newGame'>>,
  game: GameSummary,
  opts: { cancelled?: () => boolean; onPosition?: (done: number, total: number) => void } = {},
): Promise<GameAnalysis | null> {
  const g = parseGame(game.pgn);
  if (!g) return null; // unusual PGN (e.g. custom start position) — skip it
  const known = loadReview(game.url);
  const evals = known?.length === g.fens.length ? known : await analyzePositions(engine, g, { cancelled: opts.cancelled, onUpdate: (_, done, total) => opts.onPosition?.(done, total) });
  if (!evals) return null;
  if (evals !== known) saveReview(game.url, evals as Eval[]);

  const mistakes: GameMistake[] = [];
  let userMoves = 0;
  g.moves.forEach((m, i) => {
    if (m.color !== game.color) return;
    userMoves++;
    const drop = dropOf(evals[i]!, evals[i + 1]!);
    const kind = kindOf(drop);
    const bestUci = evals[i]!.bestMove;
    if (!kind || bestUci === m.from + m.to + (m.promotion ?? '')) return;
    const moveNumber = Math.floor(i / 2) + 1;
    mistakes.push({ fen: m.before, moveNumber, played: m.san, best: uciToSan(m.before, bestUci), bestUci, drop, kind, phase: phaseOf(m.before, moveNumber), gameUrl: game.url });
  });
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
      title: tr('The clock is beating you'),
      text: tr(msg`${pct((timeouts / losses) * 100)} of your losses are on time. Try longer games (rapid 10+5), and play faster in simple positions.`),
      weight: (timeouts / losses) * 100,
    });
  }

  for (const color of ['w', 'b'] as const) {
    const weak = o.openings[color]
      .filter((r) => r.games >= MIN_OPENING_GAMES && r.score < o.byColor[color].score - 10)
      .sort((a, b) => a.score - b.score)[0];
    if (!weak) continue;
    const side = color === 'w' ? tr('as White') : tr('as Black');
    tips.push({
      title: tr(msg`Your weakest opening ${side}: ${weak.name}`),
      text: weak.repertoireId
        ? tr(msg`You score only ${pct(weak.score)} in ${weak.games} games. There are ready lines for it here — train them.`)
        : tr(msg`You score only ${pct(weak.score)} in ${weak.games} games. Pick one ready line for this opening and learn it to move 10.`),
      action: weak.repertoireId ? { type: 'train', repertoireId: weak.repertoireId } : undefined,
      weight: o.byColor[color].score - weak.score + weak.games / 5,
    });
  }

  const gap = o.byColor.w.score - o.byColor.b.score;
  if (Math.abs(gap) >= 10 && o.byColor.w.games >= 10 && o.byColor.b.games >= 10) {
    const weakSide = gap > 0 ? tr('Black') : tr('White');
    tips.push({
      title: tr('A big gap between colors'),
      text: tr(msg`As White you score ${pct(o.byColor.w.score)} and as Black ${pct(o.byColor.b.score)}. Put time into your openings with ${weakSide}.`),
      weight: Math.abs(gap),
    });
  }

  if (losses >= 10 && o.shortLosses / losses >= 0.3) {
    tips.push({
      title: tr('Early losses'),
      text: tr(msg`${pct((o.shortLosses / losses) * 100)} of your losses end by move ${SHORT_GAME}. Before every move ask: what is my opponent threatening, and are all my pieces protected?`),
      weight: (o.shortLosses / losses) * 80,
    });
  }

  if (deep && deep.games) {
    const perGame = deep.counts.blunder / deep.games;
    const [phase, n] = (Object.entries(deep.byPhase) as [GamePhase, number][]).sort((a, b) => b[1] - a[1])[0];
    if (n > 0) {
      tips.push({
        title: tr(msg`Most of your mistakes: in the ${phaseLabel(phase)}`),
        text: tr(msg`The ${deep.games} analyzed games had ${deep.counts.blunder} blunders (${perGame.toFixed(1)} per game). They are waiting for you in Review.`),
        action: { type: 'drill' },
        weight: 40 + perGame * 20,
      });
    }
  } else {
    tips.push({
      title: tr('Find your mistakes'),
      text: tr('Run an engine analysis of your recent games. Every mistake it finds becomes an exercise in Review.'),
      action: { type: 'deep' },
      weight: 1,
    });
  }

  return tips.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

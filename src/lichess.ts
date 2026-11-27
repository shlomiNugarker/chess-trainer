// Lichess public API (https://lichess.org/api#tag/Games/operation/apiGamesUser). No auth, CORS-enabled.
// The games come as a stream (one JSON object per line, newest first) at about 20 a second, so a long history is
// slow the first time: the games already loaded are kept in the browser's Cache Storage, and the next load asks
// only for the games played since.

import { msg, tr } from './i18n.ts';
import { ChessComError as GamesError, countMoves, UNKNOWN, type GameSummary, type Result, type TimeClass } from './chesscom.ts';

type Player = { user?: { name: string; id: string }; rating?: number; aiLevel?: number; analysis?: { accuracy?: number } };
export type LichessGame = {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  winner?: 'white' | 'black';
  players: { white: Player; black: Player };
  opening?: { eco: string; name: string };
  pgn?: string;
};

const SITE = 'https://lichess.org';
/** How many games are read the first time: under half a minute at Lichess's pace (later loads add the new ones). */
export const FIRST_LOAD = 500;
/** As on Chess.com: enough for every statistic. */
const MAX_KEPT = 5000;

const noSuchUser = () => new GamesError(tr('No Lichess user with this name.'));

const SPEEDS: Record<string, TimeClass> = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'rapid', correspondence: 'daily' };
const NOT_PLAYED = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);
/** Lichess's endings in the words the review already knows (the Chess.com codes of reasonLabel). */
const ENDINGS: Record<string, string> = { mate: 'checkmated', resign: 'resigned', outoftime: 'timeout', timeout: 'abandoned', stalemate: 'stalemate', insufficientMaterialClaim: 'insufficient' };

/**
 * "Queen's Gambit Declined: Slav, Exchange" -> "Queens Gambit Declined Slav Exchange": the way Chess.com writes the
 * names, so matchRepertoire and the opening table work the same for both sites.
 */
export function chesscomStyle(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Grünfeld -> Grunfeld, Réti -> Reti
    .replace(/['’]/g, '')
    .replace(/[-:,]/g, ' ')
    .replace(/^Owen Defense/, 'Owens Defense')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeLichess(g: LichessGame, username: string): GameSummary | null {
  if (g.variant !== 'standard' || !g.pgn || NOT_PLAYED.has(g.status)) return null;
  const color = g.players.white.user?.id === username.toLowerCase() ? 'w' : 'b';
  const me = color === 'w' ? g.players.white : g.players.black;
  const opp = color === 'w' ? g.players.black : g.players.white;
  const result: Result = !g.winner ? 'draw' : (g.winner === 'white') === (color === 'w') ? 'win' : 'loss';
  const full = g.opening ? chesscomStyle(g.opening.name) : UNKNOWN;
  const family = !g.opening ? UNKNOWN : /London System/.test(full) ? 'London System' : chesscomStyle(g.opening.name.split(':')[0]);
  const ending = ENDINGS[g.status] ?? g.status;
  return {
    url: `${SITE}/${g.id}`,
    endTime: g.lastMoveAt,
    timeClass: SPEEDS[g.speed] ?? 'blitz',
    rated: g.rated,
    color,
    result,
    // as on Chess.com: how the loser lost, or how the draw came
    reason: ending,
    opponent: opp.user?.name ?? (opp.aiLevel ? `Stockfish ${opp.aiLevel}` : '?'),
    opponentRating: opp.rating ?? 0,
    myRating: me.rating ?? 0,
    opening: family,
    openingFull: full,
    moveCount: countMoves(g.pgn),
    pgn: g.pgn,
    accuracy: me.analysis?.accuracy,
  };
}

/** The user's number of games (and whether the user exists). */
async function gameCount(user: string, signal: AbortSignal): Promise<number> {
  let res: Response;
  try {
    res = await fetch(`${SITE}/api/user/${user}`, { signal });
  } catch {
    throw new GamesError(tr('Cannot reach Lichess. Check your internet connection and try again.'));
  }
  if (res.status === 404) throw noSuchUser();
  if (!res.ok) throw new GamesError(tr(msg`Lichess returned an error (${res.status}). Try again in a moment.`));
  const u = (await res.json().catch(() => null)) as { count?: { all?: number }; disabled?: boolean } | null;
  if (!u || u.disabled) throw noSuchUser();
  return u.count?.all ?? 0;
}

const CACHE = 'lichess-games-v1';
const cacheKey = (user: string) => `${SITE}/api/games/user/${user}#kept`;

type Kept = { games: GameSummary[]; since: number; older: boolean }; // older: games before the first load were not read

async function readKept(user: string): Promise<Kept> {
  try {
    const res = await (await caches.open(CACHE)).match(cacheKey(user));
    if (res) return (await res.json()) as Kept;
  } catch {
    /* no Cache Storage, or a broken entry: start over */
  }
  return { games: [], since: 0, older: false };
}

async function keep(user: string, data: Kept) {
  try {
    await (await caches.open(CACHE)).put(cacheKey(user), new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    /* not kept: the next load reads them again */
  }
}

/**
 * Load a player's standard-chess games from Lichess, oldest first: the ones kept from earlier loads, and the games
 * played since (the first time, the latest FIRST_LOAD). `partial`: older games were not read.
 */
export async function fetchLichessGames(
  username: string,
  onProgress: (fraction: number, games: number) => void,
  cancel?: AbortSignal,
): Promise<{ games: GameSummary[]; partial: boolean }> {
  const user = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(user)) throw noSuchUser();
  const stop = new AbortController();
  cancel?.addEventListener('abort', () => stop.abort());
  const total = await gameCount(user, stop.signal);
  const kept = await readKept(user);
  const want = kept.since ? Math.max(0, total - kept.games.length) : Math.min(total, FIRST_LOAD);
  onProgress(0, 0);
  const q = new URLSearchParams({ max: String(kept.since ? MAX_KEPT : FIRST_LOAD), pgnInJson: 'true', opening: 'true', accuracy: 'true', clocks: 'false', evals: 'false' });
  if (kept.since) q.set('since', String(kept.since + 1));
  let res: Response;
  try {
    res = await fetch(`${SITE}/api/games/user/${user}?${q}`, { headers: { Accept: 'application/x-ndjson' }, signal: stop.signal });
  } catch {
    if (kept.games.length && !cancel?.aborted) return { games: kept.games, partial: kept.older }; // offline: what was kept
    throw new GamesError(tr('Cannot reach Lichess. Check your internet connection and try again.'));
  }
  if (res.status === 429) throw new GamesError(tr('Lichess asks to wait a minute before loading again.'));
  if (!res.ok || !res.body) throw new GamesError(tr(msg`Lichess returned an error (${res.status}). Try again in a moment.`));
  const fresh: GameSummary[] = [];
  let since = kept.since;
  let read = 0;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  const take = (line: string) => {
    if (!line.trim()) return;
    const g = JSON.parse(line) as LichessGame;
    read++;
    since = Math.max(since, g.createdAt);
    const s = summarizeLichess(g, user);
    if (s) fresh.push(s);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parts = (rest + value).split('\n');
      rest = parts.pop() ?? '';
      parts.forEach(take);
      onProgress(want ? Math.min(1, read / want) : 1, kept.games.length + fresh.length);
    }
    take(rest);
  } catch (e) {
    stop.abort();
    if (cancel?.aborted) throw e;
    throw new GamesError(tr('Cannot reach Lichess. Check your internet connection and try again.'));
  }
  const seen = new Set(fresh.map((g) => g.url));
  const games = [...kept.games.filter((g) => !seen.has(g.url)), ...fresh].sort((a, b) => a.endTime - b.endTime).slice(-MAX_KEPT);
  const older = kept.since ? kept.older : read >= FIRST_LOAD;
  await keep(user, { games, since, older });
  return { games, partial: older };
}

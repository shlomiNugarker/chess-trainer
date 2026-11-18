// Chess.com public API (https://www.chess.com/news/view/published-data-api). No auth, CORS-enabled.
// We load every monthly archive and boil each game down to the few fields the review needs.

import { tr } from './i18n.ts';

export type Result = 'win' | 'loss' | 'draw';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';

export type GameSummary = {
  url: string;
  endTime: number; // ms
  timeClass: TimeClass;
  rated: boolean;
  color: 'w' | 'b';
  result: Result;
  reason: string; // how the game ended, chess.com code (checkmated, resigned, timeout, agreed, ...)
  opponent: string;
  opponentRating: number;
  myRating: number;
  opening: string; // family, e.g. "Italian Game"
  openingFull: string; // full chess.com name, used to match repertoires
  moveCount: number; // full moves
  pgn: string;
  accuracy?: number; // only for games reviewed on chess.com
};

type ApiPlayer = { username: string; rating: number; result: string };
type ApiGame = {
  url: string;
  pgn?: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  eco?: string;
  accuracies?: { white: number; black: number };
  white: ApiPlayer;
  black: ApiPlayer;
};

const API = 'https://api.chess.com/pub/player';
const DRAW_CODES = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export class ChessComError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new ChessComError(tr('אין חיבור ל-Chess.com. בדוק את החיבור לאינטרנט ונסה שוב.', 'Cannot reach Chess.com. Check your internet connection and try again.'));
    }
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // rate limited — back off
      continue;
    }
    if (res.status === 404) throw new ChessComError(tr('לא נמצא משתמש בשם הזה ב-Chess.com.', 'No Chess.com user with this name.'));
    if (!res.ok) throw new ChessComError(tr(`Chess.com החזיר שגיאה (${res.status}). נסה שוב בעוד רגע.`, `Chess.com returned an error (${res.status}). Try again in a moment.`));
    return res.json() as Promise<T>;
  }
}

/** "https://www.chess.com/openings/Italian-Game-Two-Knights-Defense" -> "Italian Game Two Knights Defense" */
export function openingFromEco(eco?: string): { full: string; family: string } {
  const slug = eco?.split('/openings/')[1];
  if (!slug) return { full: tr('לא ידוע', 'Unknown'), family: tr('לא ידוע', 'Unknown') };
  const words = slug.replace(/\.{3}/g, '-').split('-'); // "Gambit...5.Bf4" -> "Gambit", "5.Bf4"
  const cut = words.findIndex((w) => /\d/.test(w)); // drop the move-list tail ("3.e5", "...Nf6")
  const full = (cut === -1 ? words : words.slice(0, Math.max(cut, 1))).join(' ');
  if (/London System/.test(full)) return { full, family: 'London System' }; // chess.com files it under Queen's Pawn
  const kw = words.findIndex((w) => /^(Opening|Defense|Game|Gambit|Attack|System|Variation)$/.test(w));
  const family = (kw !== -1 && kw < 4 ? words.slice(0, kw + 1) : words.slice(0, Math.min(3, words.length))).join(' ');
  return { full, family: family.replace(/ \d.*$/, '') };
}

/** Number of full moves, read straight from the PGN move numbers (fast, no chess.js). */
export function countMoves(pgn: string): number {
  let max = 0;
  for (const m of pgn.matchAll(/(?:^|\s)(\d+)\.\s/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export function summarize(g: ApiGame, username: string): GameSummary | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const color = g.white.username.toLowerCase() === username.toLowerCase() ? 'w' : 'b';
  const me = color === 'w' ? g.white : g.black;
  const opp = color === 'w' ? g.black : g.white;
  const result: Result = me.result === 'win' ? 'win' : DRAW_CODES.has(me.result) ? 'draw' : 'loss';
  const { full, family } = openingFromEco(g.eco);
  return {
    url: g.url,
    endTime: g.end_time * 1000,
    timeClass: (['bullet', 'blitz', 'rapid', 'daily'].includes(g.time_class) ? g.time_class : 'blitz') as TimeClass,
    rated: g.rated,
    color,
    result,
    reason: result === 'win' ? opp.result : me.result,
    opponent: opp.username,
    opponentRating: opp.rating,
    myRating: me.rating,
    opening: family,
    openingFull: full,
    moveCount: countMoves(g.pgn),
    pgn: g.pgn,
    accuracy: g.accuracies ? (color === 'w' ? g.accuracies.white : g.accuracies.black) : undefined,
  };
}

// Past months never change, so their archives are kept in the browser's Cache Storage (not localStorage:
// they can be megabytes, and localStorage is synced to the cloud). Only the current month is fetched again.
const ARCHIVE_CACHE = 'chesscom-archives-v1';

async function getMonth(url: string, past: boolean): Promise<{ games: ApiGame[] }> {
  const cache = past && typeof caches !== 'undefined' ? await caches.open(ARCHIVE_CACHE).catch(() => null) : null;
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    try {
      return (await hit.json()) as { games: ApiGame[] };
    } catch {
      /* broken entry — fetch it again */
    }
  }
  const data = await getJson<{ games: ApiGame[] }>(url);
  if (cache) void cache.put(url, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
  return data;
}

/** Load all of a player's standard-chess games, oldest first. */
export async function fetchGames(
  username: string,
  onProgress: (done: number, total: number) => void,
  signal?: { cancelled: boolean },
): Promise<GameSummary[]> {
  const user = encodeURIComponent(username.trim().toLowerCase());
  const { archives } = await getJson<{ archives: string[] }>(`${API}/${user}/games/archives`);
  const perMonth: GameSummary[][] = new Array(archives.length);
  let next = 0;
  let done = 0;
  onProgress(0, archives.length);
  // a few requests in parallel: fast, but polite enough to avoid 429s
  const worker = async () => {
    while (next < archives.length && !signal?.cancelled) {
      const i = next++;
      const { games } = await getMonth(archives[i], i < archives.length - 1); // the last archive is this month
      perMonth[i] = games.map((g) => summarize(g, username)).filter((g): g is GameSummary => g !== null);
      onProgress(++done, archives.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return perMonth.flat().sort((a, b) => a.endTime - b.endTime);
}

// Engine analyses of Chess.com games, kept so the same game is never analyzed twice (and its mistakes are not
// re-added to the drill, which would reset their spaced-repetition progress). Device-only: not synced.

import type { GameAnalysis } from './reviewStats';

const KEY = 'chess-trainer:analyses';
const VERSION = 1; // bump when analyzeGame changes in a way that makes old results wrong
const MAX = 200;

type Store = { v: number; games: Record<string, GameAnalysis & { at: number }> };

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null;
    return s?.v === VERSION ? s : { v: VERSION, games: {} };
  } catch {
    return { v: VERSION, games: {} };
  }
}

export function getAnalysis(url: string): GameAnalysis | undefined {
  return read().games[url];
}

export function saveAnalysis(a: GameAnalysis) {
  const s = read();
  s.games[a.url] = { ...a, at: Date.now() };
  const urls = Object.keys(s.games);
  if (urls.length > MAX) {
    for (const u of urls.sort((x, y) => s.games[x].at - s.games[y].at).slice(0, urls.length - MAX)) delete s.games[u];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or unavailable — the analysis just isn't kept */
  }
}

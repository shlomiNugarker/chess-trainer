// Mistakes are saved locally so a later "review" mode can drill them (spaced repetition).

export type Mistake = {
  fen: string; // position before the mistake (user to move)
  played: string; // SAN
  correct: string; // SAN
  source: 'book' | 'engine';
  repertoire: string;
  drop?: number; // win% lost (engine mistakes)
  at: number; // timestamp
  // spaced-repetition fields, used from phase 2 on
  box: number;
  due: number;
};

const KEY = 'chess-trainer:mistakes';

export function loadMistakes(): Mistake[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveMistake(m: Omit<Mistake, 'at' | 'box' | 'due'>) {
  try {
    const all = loadMistakes();
    const now = Date.now();
    const existing = all.find((x) => x.fen === m.fen && x.repertoire === m.repertoire);
    if (existing) Object.assign(existing, m, { at: now, box: 0, due: now });
    else all.push({ ...m, at: now, box: 0, due: now });
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — ignore */
  }
}

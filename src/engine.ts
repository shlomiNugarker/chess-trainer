// Thin wrapper around a Stockfish Web Worker speaking UCI.
// Two instances are used by the app: a weakened "opponent" and a full-strength "coach".

export type Analysis = {
  bestMove: string; // UCI, e.g. "e2e4"
  cp: number | null; // centipawns from side-to-move perspective
  mate: number | null; // mate in N from side-to-move perspective
  pv: string[]; // principal variation in UCI, starting with bestMove
};

export class Engine {
  private worker: Worker;
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  private ready: Promise<void>;

  constructor() {
    // resolved here, not at module load, so pure helpers in this file also run under Node (scripts/)
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      this.listener?.(line);
    };
    this.ready = this.exec(['uci'], (l) => l === 'uciok').then(() =>
      this.exec(['isready'], (l) => l === 'readyok'),
    ).then(() => undefined);
  }

  /** Send commands and resolve once `done(line)` returns true. Commands are serialized. */
  private exec(cmds: string[], done: (line: string) => boolean, onLine?: (l: string) => void) {
    const run = () =>
      new Promise<void>((resolve) => {
        this.listener = (line) => {
          onLine?.(line);
          if (done(line)) {
            this.listener = null;
            resolve();
          }
        };
        cmds.forEach((c) => this.worker.postMessage(c));
      });
    const p = this.queue.then(run, run);
    this.queue = p;
    return p;
  }

  async setOption(name: string, value: string | number) {
    await this.ready;
    await this.exec([`setoption name ${name} value ${value}`, 'isready'], (l) => l === 'readyok');
  }

  async newGame() {
    await this.ready;
    await this.exec(['ucinewgame', 'isready'], (l) => l === 'readyok');
  }

  /** Search a position. `go` is e.g. "movetime 700" or "depth 14". */
  async analyze(fen: string, go = 'movetime 700'): Promise<Analysis> {
    await this.ready;
    let cp: number | null = null;
    let mate: number | null = null;
    let bestMove = '';
    let pv: string[] = [];
    await this.exec(
      [`position fen ${fen}`, `go ${go}`],
      (l) => l.startsWith('bestmove'),
      (l) => {
        if (l.startsWith('info') && l.includes(' score ') && !l.includes('lowerbound') && !l.includes('upperbound')) {
          const m = l.match(/score (cp|mate) (-?\d+)/);
          if (m) {
            if (m[1] === 'cp') { cp = Number(m[2]); mate = null; }
            else { mate = Number(m[2]); cp = null; }
          }
          const p = l.match(/ pv (.+)$/);
          if (p) pv = p[1].trim().split(/\s+/);
        }
        if (l.startsWith('bestmove')) bestMove = l.split(' ')[1];
      },
    );
    // the last full info line normally ends in bestmove's line; if not, keep just the move itself
    return { bestMove, cp, mate, pv: pv[0] === bestMove ? pv : bestMove ? [bestMove] : [] };
  }

  terminate() {
    this.worker.terminate();
  }
}

/** Lichess win% model: 0..100 for the side whose perspective the score is in. */
export function winPercent(a: Pick<Analysis, 'cp' | 'mate'>): number {
  if (a.mate !== null) return a.mate > 0 ? 100 : 0; // mate 0 = side to move is mated
  const cp = Math.max(-1000, Math.min(1000, a.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win% for White, from an analysis whose score is from the side-to-move's perspective in `fen`. */
export function whiteWinPercent(a: Pick<Analysis, 'cp' | 'mate'>, fen: string): number {
  const w = winPercent(a);
  return fen.split(' ')[1] === 'w' ? w : 100 - w;
}

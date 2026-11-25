// Thin wrapper around a Stockfish Web Worker speaking UCI.
// Two instances are used by the app: a weakened "opponent" and a full-strength "coach".

export type Analysis = {
  bestMove: string; // UCI, e.g. "e2e4"
  cp: number | null; // centipawns from side-to-move perspective
  mate: number | null; // mate in N from side-to-move perspective
  pv: string[]; // principal variation in UCI, starting with bestMove
};

/** Fired on window when an engine could not start (detail: false), and if it starts after all (true). */
export const ENGINE_STATUS = 'chess-trainer:engine-status';
/** A worker that has not answered by now may be stuck: another one is started beside it (the first may just be downloading). */
const SECOND_TRY = 8_000;
const START_TIMEOUT = 25_000;

const announce = (ok: boolean) => window.dispatchEvent(new CustomEvent(ENGINE_STATUS, { detail: ok }));

export class Engine {
  private worker: Worker | null = null; // the one that answered first
  private starting: Worker[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  /** Settles once the engine has started (cancel() does not touch it). Everything else waits for it. */
  readonly ready: Promise<void>;
  private round = 0; // cancel() starts a new one: searches of an older round are dropped
  private searching = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      let failed = 0;
      const start = () => {
        if (this.worker) return;
        // the address is resolved here, not at module load, so pure helpers in this file also run under Node (scripts/)
        const w = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
        this.starting.push(w);
        w.onerror = () => {
          failed++;
          if (this.worker) return;
          if (this.starting.length < 2) start();
          else if (failed === this.starting.length) announce(false);
        };
        w.onmessage = (e: MessageEvent) => {
          const line = typeof e.data === 'string' ? e.data : String(e.data);
          if (this.worker === w) this.listener?.(line);
          else if (!this.worker && line === 'uciok') {
            this.worker = w;
            this.starting.filter((x) => x !== w).forEach((x) => x.terminate());
            this.timers.forEach(clearTimeout);
            announce(true);
            resolve();
          }
        };
        w.postMessage('uci');
      };
      this.timers = [
        setTimeout(() => this.starting.length < 2 && start(), SECOND_TRY),
        setTimeout(() => announce(false), START_TIMEOUT), // e.g. the .wasm file did not arrive
      ];
      start();
    });
  }

  /** Send commands and resolve once `done(line)` returns true. Commands are serialized. */
  private exec(cmds: string[], done: (line: string) => boolean, onLine?: (l: string) => void, dropped?: () => boolean) {
    const run = () =>
      new Promise<void>((resolve) => {
        if (dropped?.()) return resolve();
        this.searching = !!dropped;
        this.listener = (line) => {
          onLine?.(line);
          if (done(line)) {
            this.listener = null;
            this.searching = false;
            resolve();
          }
        };
        cmds.forEach((c) => this.worker?.postMessage(c));
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

  /**
   * Forget the searches asked for so far: the one running stops now, those waiting are skipped (their promises
   * never settle). For callers that have moved on, e.g. after "take back": the next search starts at once.
   */
  cancel() {
    this.round++;
    if (this.searching) this.worker?.postMessage('stop');
  }

  /** Search a position. `go` is e.g. "movetime 700" or "depth 14". */
  async analyze(fen: string, go = 'movetime 700'): Promise<Analysis> {
    const round = this.round;
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
      () => round !== this.round,
    );
    if (round !== this.round) return new Promise(() => {});
    // the last full info line normally ends in bestmove's line; if not, keep just the move itself
    return { bestMove, cp, mate, pv: pv[0] === bestMove ? pv : bestMove ? [bestMove] : [] };
  }

  terminate() {
    this.timers.forEach(clearTimeout);
    this.starting.forEach((w) => w.terminate());
  }
}

/**
 * Win% a move loses to count as an inaccuracy / mistake / blunder (Lichess's thresholds). The one place for
 * the whole app: the trainer's feedback, "My review" and the move-by-move game review all use these.
 */
export const DROP = { inaccuracy: 10, mistake: 20, blunder: 30 } as const;

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

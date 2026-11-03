# Chess Opening Trainer

Play against the computer in your repertoire (London as White, Caro-Kann as Black).
Every time you leave the line or make a mistake, the game stops, shows the right move, and lets you **retry** or **continue**.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Structure

- `src/App.tsx` — game flow (book phase → free play, mistake detection, retry/continue)
- `src/engine.ts` — Stockfish Web Worker wrapper + Lichess win% formula
- `src/repertoire.ts` — the opening lines (edit here to change your repertoire)
- `src/mistakes.ts` — localStorage store of your mistakes (for review mode later)
- `public/engine/` — Stockfish 19 lite (WASM)
- `scripts/check-lines.ts` — verifies every repertoire line is legal:
  `node --experimental-strip-types scripts/check-lines.ts`

See `PLAN.md` for the roadmap.

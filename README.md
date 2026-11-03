# Chess Opening Trainer

Three tabs:

- **Play** — train your repertoire (London / Italian as White, Caro-Kann as Black): every time you leave the line or make a mistake, the game stops, shows the right move, and lets you **retry** or **continue**. Or play a regular game at any level and color.
- **My review** — enter a Chess.com username; get the 3 most important things to improve, results by color / time control / opening, how you lose, a rating chart, and an optional Stockfish pass over your recent games.
- **Drill** — spaced repetition (Leitner) over every mistake found in training or in your games.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Structure

- `src/App.tsx` — tab shell
- `src/Trainer.tsx` — game flow (book phase → free play, mistake detection, retry/continue; regular game mode)
- `src/Review.tsx` + `src/reviewStats.ts` — Chess.com review (UI / pure stats, tips, engine pass)
- `src/chesscom.ts` — Chess.com public API client
- `src/Drill.tsx` — spaced-repetition drill
- `src/engine.ts` — Stockfish Web Worker wrapper + Lichess win% formula
- `src/repertoire.ts` — the opening lines (edit here to change your repertoire)
- `src/mistakes.ts` — localStorage store of your mistakes + Leitner scheduling
- `public/engine/` — Stockfish 19 lite (WASM)
- `scripts/check-lines.ts` — verifies every repertoire line is legal:
  `node --experimental-strip-types scripts/check-lines.ts`
- `scripts/check-review.ts` — checks for the review logic:
  `node --experimental-strip-types scripts/check-review.ts`

See `PLAN.md` for the roadmap.

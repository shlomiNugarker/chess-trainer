# Chess Opening Trainer

Three tabs:

- **Play** — train your repertoire (London / Italian as White; Caro-Kann vs 1.e4 and the Slav vs 1.d4 as Black): every time you leave the line or make a mistake, the game stops, shows the right move, and lets you **retry** or **continue**. Or play a regular game at any level and color.
- **My review** — enter a Chess.com username; get the 3 most important things to improve, results by color / time control / opening, how you lose, a rating chart, and an optional Stockfish pass over your recent games.
- **Practice → Puzzles** — 3,600 tactics puzzles from the Lichess database (CC0) that adapt to your rating (Elo), with modes *for my level*, *from my openings* and *mates*; a missed puzzle goes to your mistakes. A daily goal of 5 puzzles with a streak of days (🔥).
- **Practice → My mistakes** — spaced repetition (Leitner) over every mistake found in training, in your games or in puzzles.
- **Sounds** — move, capture, check, "wrong move" and "well done" sounds (Web Audio, no files); mute in Play → More options.
- **Installable & offline** — add it to your phone's home screen; learning, training and drill (with the engine) work without internet.

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
- `src/Learn.tsx` — study each repertoire line step by step, "test me", progress per line
- `src/i18n.ts` — Hebrew / English: every string is written in place as `tr('עברית', 'English')`
- `src/repertoire.en.ts` — English names, ideas and move notes for the lines in `repertoire.ts`
- `src/Practice.tsx`, `src/Puzzles.tsx`, `src/puzzleData.ts` — the Practice tab, the puzzle screen, puzzle rating/selection
- `public/puzzles-v1.json` — the puzzle set, built by `scripts/build-puzzles.py` from the [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0); checked by `scripts/check-puzzles.ts`
- `src/mistakes.ts` — localStorage store of your mistakes + Leitner scheduling
- `public/engine/` — Stockfish 19 lite (WASM)
- `public/sw.js` + `public/manifest.webmanifest` — offline cache (pages network-first, files cache-first) and install info
- `scripts/check-lines.ts` — verifies every repertoire line is legal:
  `node --experimental-strip-types scripts/check-lines.ts`
- `scripts/check-review.ts` — checks for the review logic:
  `node --experimental-strip-types scripts/check-review.ts`

See `PLAN.md` for the roadmap.

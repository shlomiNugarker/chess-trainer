# Contributing

Thanks for helping! The goal of Chess Trainer is to stay **simple and easy to learn with** — small, focused changes are the easiest to accept.

## Getting started

```bash
npm install
npm run dev
```

Open an issue first for anything larger than a small fix, so we can agree on the approach.

## Before you open a pull request

All of these must pass (CI runs them too):

```bash
npm run check   # = npm run lint && npm run build && npm test (the four scripts/check-*.ts)
```

The engine in `public/engine/` is a copy of the `stockfish` package (pinned in `package.json`); when updating
it, copy `node_modules/stockfish/bin/stockfish-<version>-lite-single.{js,wasm}` there, update the file name in
`src/engine.ts` and `public/sw.js`, bump `CACHE` in `public/sw.js` (installed apps keep the engine, the icons and
the manifest until it changes) and update `THIRD_PARTY_NOTICES.md`.

Vercel runs the same command as its build (`buildCommand` in `vercel.json`), so a failing check is not deployed.

Please also try your change in the browser, on a narrow phone-sized window as well as on desktop.

For larger changes, also run the browser QA scripts in [`scripts/qa/`](scripts/qa/README.md): they play every repertoire line through the real UI and go through every screen on desktop and phone, in both languages and offline.

## Conventions

- **Two languages.** Every user-facing string is written in place as `tr('עברית', 'English')` (`src/i18n.ts`). Add both; if you don't speak Hebrew, write the English and say so in the PR — we'll add the Hebrew.
- **Repertoire lines** live in `src/repertoire.ts` (Hebrew names, ideas and notes) and `src/repertoire.en.ts` (English, keyed by the Hebrew line name). Notes are keyed by move label (`"5.c3"`, `"4...Qb6"`). The user must have exactly one move in every position across a repertoire's lines. Check every user move with Stockfish — it should not lose more than ~2% win chance — and run `check-lines`.
- **A new repertoire** goes in `REPERTOIRES` (`src/repertoire.ts`) and in `EN` (`src/repertoire.en.ts`, by its id). For the review’s per-opening table, add its Chess.com opening name to `matchRepertoire` in `src/reviewStats.ts` (with a case in `scripts/check-review.ts`). Two repertoires may answer the same position differently (say the Caro-Kann and the Sicilian against 1.e4): the review gives each game to the one it followed longest.
- **Puzzles** are rebuilt with `scripts/build-puzzles.py`. Give the new set a new file name (`puzzles-vN.json`, and update `src/puzzleData.ts` and `scripts/check-puzzles.ts`) — the service worker caches files by name, so the same name would never reach existing users.
- **Changing a line name** resets the "mastered" mark of everyone who learned it (the Hebrew name is its id), so avoid it.
- **Storage.** Saved state goes in `localStorage` under `chess-trainer:`; it is synced between devices unless listed as local in `src/syncMerge.ts`. Keep large data (archives, caches) out of it.
- Match the existing code style; no new runtime dependencies without discussing them first.

## License of contributions

By contributing you agree that your contribution is licensed under the project's license, the [GNU GPL v3.0 or later](LICENSE).

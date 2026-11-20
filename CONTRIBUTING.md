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
npm run lint
npm run build
node --experimental-strip-types scripts/check-lines.ts
node --experimental-strip-types scripts/check-review.ts
node --experimental-strip-types scripts/check-puzzles.ts
node --experimental-strip-types scripts/check-sync.ts
```

Please also try your change in the browser, on a narrow phone-sized window as well as on desktop.

## Conventions

- **Two languages.** Every user-facing string is written in place as `tr('עברית', 'English')` (`src/i18n.ts`). Add both; if you don't speak Hebrew, write the English and say so in the PR — we'll add the Hebrew.
- **Repertoire lines** live in `src/repertoire.ts` (Hebrew names, ideas and notes) and `src/repertoire.en.ts` (English, keyed by the Hebrew line name). Notes are keyed by move label (`"5.c3"`, `"4...Qb6"`). The user must have exactly one move in every position across a repertoire's lines. Check every user move with Stockfish — it should not lose more than ~2% win chance — and run `check-lines`.
- **Changing a line name** resets the "mastered" mark of everyone who learned it (the Hebrew name is its id), so avoid it.
- **Storage.** Saved state goes in `localStorage` under `chess-trainer:`; it is synced between devices unless listed as local in `src/syncMerge.ts`. Keep large data (archives, caches) out of it.
- Match the existing code style; no new runtime dependencies without discussing them first.

## License of contributions

By contributing you agree that your contribution is licensed under the project's license, the [GNU GPL v3.0 or later](LICENSE).

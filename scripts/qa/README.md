# Browser QA

End-to-end checks that drive the real app in Chromium with [Playwright for Python](https://playwright.dev/python/). They are slower than the `check-*` scripts and are not run in CI; run them before a release or after a larger change.

## Setup (once)

```bash
pip install playwright
python -m playwright install chromium
```

## Run

Build, start the preview server, then run the scripts (from the repo root):

```bash
npm run build
npx vite preview --port 4173          # in a second terminal
python scripts/qa/learn_lines.py      # "Test me" on every line of every repertoire (~15 min)
python scripts/qa/play.py             # Play: training in every repertoire, leaving the line, a regular game (~3 min)
python scripts/qa/screens.py          # Learn extras, puzzles, my mistakes, review, account, phone, offline (~3 min)
```

On Windows you can start and stop the preview server from PowerShell:

```powershell
Start-Process cmd -ArgumentList '/c','npx vite preview --port 4173'
Get-NetTCPConnection -LocalPort 4173 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

Each script prints every check, ends with a summary, and exits non-zero if a check failed or the page logged an error. Reports (`*.json`) and screenshots (`shots/`) go to `scripts/qa/out/`, which git ignores.

## Options

| Option | Scripts | Meaning |
|---|---|---|
| `--url URL` | all | the app to test (default `http://localhost:4173`; the live site works too) |
| `--only a,b` | all | a subset: repertoire ids (`london,qga`) for `learn_lines`/`play` (`play` also takes `regular`), or sections (`learn,puzzles,mistakes,review,account,phone,offline`) for `screens` |
| `--chesscom USER` | `screens` | the Chess.com account the review loads (real API calls) |
| `--account-url URL` | `screens` | a build with Firebase configured, for the account panel (default: the live site, since a local build without `.env.local` has no account panel) |

## Notes

- The lines are read from `src/repertoire.ts` on every run (`dump-lines.ts`), so new lines are tested without changes here.
- The scripts play by tapping squares (`[data-square]`), the same tap-to-move path phone users take. After starting a test, the board animates back to the start for a moment; the scripts wait for it.
- Not covered: signing in with Google and the cloud sync (check by hand, signed in, on two devices), solving a puzzle all the way, and analysing every game.

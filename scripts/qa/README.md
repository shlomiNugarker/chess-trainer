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
python scripts/qa/play.py             # Play: training in every repertoire, leaving the line, a regular game, hints and games that must not leak (~4 min)
python scripts/qa/screens.py          # Learn extras, puzzles (solved to the end), my mistakes, review, account, phone, offline (~4 min)
python scripts/qa/nav.py              # the Back button, reload, daily goal, keyboard in dialogs, a slow or missing engine (~3 min)
```

On Windows you can start and stop the preview server from PowerShell:

```powershell
Start-Process cmd -ArgumentList '/c','npx vite preview --port 4173'
Get-NetTCPConnection -LocalPort 4173 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

### Sync

Signing in, syncing between devices and `firestore.rules` run against the local Firebase emulators (Java and `firebase-tools` needed), never against the real project. The other scripts run on a build without Firebase, so they do not cover it.

```bash
firebase emulators:start --only auth,firestore --project demo-chess     # in a second terminal
export VITE_USE_EMULATORS=1 VITE_FIREBASE_API_KEY=demo VITE_FIREBASE_PROJECT_ID=demo-chess VITE_FIREBASE_APP_ID=demo
npx vite build --outDir dist-emu
npx vite preview --outDir dist-emu --port 4188                          # in a third terminal
python scripts/qa/sync.py --url http://localhost:4188                   # (~3 min; needs internet for Google's sign-in script)
```

Each script prints every check, ends with a summary, and exits non-zero if a check failed or the page logged an error. Reports (`*.json`) and screenshots (`shots/`) go to `scripts/qa/out/`, which git ignores.

## Options

| Option | Scripts | Meaning |
|---|---|---|
| `--url URL` | all | the app to test (default `http://localhost:4173`; the live site works too, except for `sync`) |
| `--only a,b` | all but `sync` | a subset: repertoire ids (`london,qga`) for `learn_lines`/`play` (`play` also takes `regular` and `states`), or sections (`learn,puzzles,mistakes,review,account,phone,touch,lang,offline`) for `screens` |
| `--chesscom USER` | `screens`, `nav` | the Chess.com account the review loads (real API calls) |
| `--account-url URL` | `screens` | a build with Firebase configured, for the account panel (default: the live site, since a local build without `.env.local` has no account panel) |

## Notes

- The lines are read from `src/repertoire.ts` on every run (`dump-lines.ts`), so new lines are tested without changes here. Puzzles are read from the newest `public/puzzles-vN.json` (`dump-puzzles.ts`): the script recognizes the puzzle on screen by its board and plays the solution — cleanly, after a hint, and after a wrong move — checking the result and the rating change.
- The scripts play by tapping squares (`[data-square]`), the same tap-to-move path phone users take. After starting a test, the board animates back to the start for a moment; the scripts wait for it.
- Not covered: signing in on Google's real pages (check by hand, on a computer and a phone), and analysing every game.

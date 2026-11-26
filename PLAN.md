# Opening trainer — work plan

**Goal:** learn an opening repertoire in depth and improve. Eight openings: as White the London, the Queen's Gambit and 1.e4 (Bishop's Opening / Italian and more); as Black against 1.e4 1...e5, the Caro-Kann or the Sicilian with ...e6, and against 1.d4 the Slav or the Queen's Gambit Accepted. Openings you don't play can be hidden. You practice by playing against the computer: at every mistake the game stops, shows the right move and lets you choose **go back and play** or **continue anyway**. Beside it there are puzzles, a review of your mistakes, and a review of your Chess.com games.

**Working rule:** every stage ends with something you play. No moving to the next stage before playing at least 3 games in the current one.

---

## Architecture (in short)

| Part | Choice | Why |
|---|---|---|
| UI | Vite + React + TypeScript | Fast, no backend |
| Rules | `chess.js` | Legal moves, FEN, undo |
| Board | `react-chessboard` v5 | Works with React 19, supports arrows and highlights |
| Engine | Stockfish 19 lite single-threaded (WASM, Web Worker) | About 2MB, needs no special headers |
| Opening book | `src/repertoire.ts`, lines in SAN merged into a map by position | Works through transpositions too, no API needed |
| Storage | localStorage (`chess-trainer:*` keys) | Enough for personal use |
| Sync (optional) | Firebase Auth (Google) + Firestore, one document per user | The same progress on phone and computer, no server |
| Offline | PWA: `public/sw.js` + `manifest.webmanifest` | Installs as an app, works without internet |

**Two "brains":**
1. **In the line:** the book is the judge. If you leave the line, the game stops.
2. **After the line:** two Stockfish instances. A weakened **opponent** (`Skill Level` 0–20) and a full-strength **coach**. The coach turns the evaluation into win chances (the Lichess formula) and stops you when they drop by more than the threshold you chose (10%, 20% or 30%). A drop is called an inaccuracy from 6%, a mistake from 12% and a blunder from 20%.

---

## Stage 1 — MVP ✅
- [x] Board, opening picker (White / Black), board turned to your color
- [x] 90 lines: London (8), Italian and 1.e4 (32: 6 Italian, 9 Bishop's Opening, 3 Scandinavian, 4 Alapin against the Sicilian, 2 Advance French, 2 Advance Caro-Kann, Modern, Pirc, Philidor, Owen, 2 Nimzowitsch), Caro-Kann (6), Sicilian with ...e6 (22), Queen's Gambit Accepted (7), Slav (15, including 7 against the London, the Colle, 2.e3 and 2.Nc3). All checked to be legal (`scripts/check-lines.ts`), and every user move checked with Stockfish (depth 20, loses no more than about 2%; the exceptions are noted in stage 4)
- [x] The opponent plays from the book, at random between the branches, and after the line moves to a weakened engine
- [x] Stops when you leave the line, with a green arrow for the right move
- [x] Stops on a mistake in free play, by the drop in win chances
- [x] Buttons: go back and play / continue anyway / hint / take back / new game
- [x] Looking back during a game: ⏮ ‹ › ⏭ above the move list (on a phone ‹ › at its ends), a tap on a move, or ← → Home End. Only the board shows the earlier position; the game goes on, the computer's reply still comes, and pieces move again after "Back to the game" or a tap on the board
- [x] A slider for the computer's level, and a choice of how sensitive the stop is
- [x] Every mistake is saved in localStorage, with fields ready for spaced repetition
- [x] A regular game at any level and color, regardless of the repertoire

**To check yourself (not done yet):** 3 games in every opening. Write down what annoys and what is missing — before adding large features.

## Stage 2 — explanations ("why") ✅
- [x] An `idea` for every line, and a one-sentence `note` for every user move (and important opponent moves), in Hebrew and in English. The keys are checked in `check-lines`
- [x] The explanations show on the Learn page, move by move
- [x] In training, inside the line: a card with the line's name ("+N more lines from here") and the explanation of the last two moves; on phones only the last one, so the buttons stay on screen (can be turned off under "More options")
- [x] When you leave the line: "Why:" with the explanation of the right move. The line is recognized through transpositions too (`lineInfo`, `noteForNext` in `src/repertoire.ts`)

## Stage 3 — reviewing mistakes (spaced repetition) ✅
- [x] "My mistakes" (in the Practice tab): takes a position from `mistakes` and asks for the right move
- [x] Leitner boxes: correct → box+1, and the next review in 1, 3, 7, 14 or 30 days. Wrong → back to box 0, and the position returns at the end of the round
- [x] A "due today" count on the tab — today's practice: up to 20 positions a day (`DAILY_REVIEWS`), oldest due first, plus the ones answered wrong today. Then "Keep going" for 20 more; the rest wait for the next days
- [x] "Remove from practice" on every position, with "Undo". The removed position stays as a mark that is newer than it, so sync removes it on the other devices too; a new mistake in the same place brings it back
- [x] For mistakes found by the engine, an alternative move that loses less than 10% win chance is accepted too
- [x] Sources: training, "Test me", the analysis of Chess.com games, and puzzles

## Stage 3.5 — review of Chess.com games ✅
- [x] Loading the games by username (public API, straight from the browser): from the latest month backwards, up to 5,000 games (a note "Based on your last N games" when there are more)
- [x] The username is kept, and the games load again by themselves when the tab is opened after a reload; without internet the last copy of the current month is used
- [x] "The 3 most important things to improve": tips from simple rules, each with an action button
- [x] Score by color, time control and opening (the 3 weakest are marked), how you lose, a rating chart
- [x] Engine analysis of the last 5/10/20 games; big mistakes go to practice
- [x] A "Train" button next to an opening that has lines in the repertoire (including the Sicilian, the Slav, the Queen's Gambit Accepted, and Black's games against the London / Colle); every game belongs to the repertoire it followed furthest
- [x] The engine's results are kept (`src/analysisCache.ts`, on the device only): shown at once, only new games are analyzed — and mistakes already in practice are not reset
- [x] Past months are kept in the browser's cache (Cache Storage, not synced) — only the current month is fetched again
- [x] Game review (22 Nov 2026): "Review my last game" or any of the last 50. Every move gets a label (book, best, good, inaccuracy, mistake, blunder — the same thresholds as everywhere in the app), with the better move as a green arrow and the engine's line; accuracy for both sides (the Lichess formula per move, the mean of the arithmetic and harmonic means); a graph of the win chances over the game (tap to jump); "my next mistake"; where the game left the repertoire, with a link to the line in Learn; "Practice this position" and "Add my big mistakes to practice". The engine runs on the device and searches by depth, not by time (depth 14 for every position, then depth 16 around every suspect move), so the same game always gets exactly the same review. The analysis is kept on the device only (`game-reviews`, 40 games) and a reviewed game opens at once (`src/GameReview.tsx`, `src/gameAnalysis.ts`, checked in `check-review` and `scripts/qa/screens.py`). A different engine and depth from Chess.com, so the numbers are not identical
- [x] "Your accuracy over time" in My review: the monthly average from two sources — games reviewed on Chess.com (only months with at least 3 games) and games reviewed here (from the reviews kept on the device) — as two lines, with a trend line (the last month against the average of the 3 before it) and a point that shows both values of a month. The time-control filter applies to it too. The charts (the rating chart too) are drawn at their real width, so the text is readable on a phone (`accuracyByMonth` / `accuracyTrend` in `src/reviewStats.ts`, checked in `check-review`)
- [x] The game review is laid out like a review on a chess site (in the app's own design, without their graphics): a round, colored mark for every kind of move (★ best, ✓ good, book, ?! ? ??) on the corner of the square the piece reached, in a "coach" card ("15...Rc8 is a blunder" with the evaluation, +4.9 / M3), in the summary (both players, White / Black accuracy boxes, and how many moves of each kind) and in the move list; a taller graph with the key moments of both sides; "Start review" at the starting position

## Stage 3.6 — learning what comes after the book ✅
- [x] A win-chance bar for both sides beside the board (can be turned off)
- [x] After every move in free play: what the best move was, without stopping (it stops only above the threshold)
- [x] Up to move 15 the computer plays at full strength, so the lines repeat
- [x] The best move in every position up to move 15 is kept ("moves you learned"), and next time it is checked like the book: "You remembered!" / "You forgot the move"
- [x] The "learning zone" (up to move 15): a move that loses 5% or more is stopped with a correction, go back / continue; a drop of 2–5% shows the better move without stopping, with "go back" (can be turned off)
- [x] The correction also shows how the engine goes on (4 half-moves), to learn the idea and not only one move
- [x] A move of yours that equals the engine's (less than 2% apart) is kept as the learned move — your own move is easier to remember
- [x] A count "remembered N of M" in the game; a position corrected in the same game does not count
- [x] A weaker move that does not stop the game (below the threshold): a "↩ Go back and play X" button — takes back the move (and the computer's answer) and shows an arrow for the better one

## The Learn page ✅
- [x] For every opening: all its lines, step by step on a board, with an arrow for the next move and arrow keys
- [x] An idea for every line and an explanation for every user move, in all 90 lines
- [x] "From here in other lines": jump to another line that passes through the same position (through transpositions too)
- [x] "Test me": you play the line yourself; a mistake is saved for review
- [x] Progress: a line passed in a test without mistakes is marked ✓, "Mastered N of M", and a suggestion for the next line to learn
- [x] A "How to learn here" card for the first visit (4 steps), which opens on the Learn tab — later the app remembers the last tab
- [x] A "Today" card: day streak 🔥, puzzles X/5, review (if any), the next line to learn / "Test me", or a training game — one tap

## Puzzles ✅ (in the Practice tab)
- [x] 3,900 puzzles from the Lichess database (CC0, `public/puzzles-v3.json`; the name changes when the content does, because the service worker caches by name; built by `scripts/build-puzzles.py`, checked in `check-puzzles`)
- [x] A personal rating (Elo), modes: for my level / from my openings (900 puzzles: 150 from each of the first six openings; none yet for 1...e5 and the Queen's Gambit) / mates
- [x] Hint (a puzzle solved with a hint counts half a point, like a draw), show solution, skip; the name of the tactic at the end ("fork", "pin"…); a puzzle you failed goes to "My mistakes"
- [x] A daily goal: 5 puzzles, and a day streak 🔥

## Sync and account ✅
- [x] Sign in with Google (optional). Without signing in everything works as before
- [x] All progress syncs between devices, merged item by item (`src/syncMerge.ts`, checked in `check-sync`) — nothing is lost even if you played on two devices
- [x] An "Account" panel: sign in / out, sync status and language
- [x] Firebase `chess-trainer-18bd8` (free), security rules: every user sees only their own document. Instructions in `docs/google-login-setup.md`

## Languages ✅
- [x] English, Hebrew and Spanish; the default follows the browser's language, and a link can choose one (`?lang=he`, `en`, `es`: it wins, is kept like a choice made in the app, and leaves the address bar; other parameters such as `utm_*` stay). Switched in the "Account" panel (or with the language button, when sync is not configured)
- [x] The code is in English (25 Nov 2026): every text is written in place, `tr('English')`, and every other language is a dictionary keyed by the English text (`src/lang/<id>.ts`), loaded only by those who chose it and kept for offline use. A text with values is written ``msg`Step ${n}` ``, so a translation can put them in another order. If a dictionary cannot load, the app is in English. `check-i18n` (in `npm run check`) fails on a missing or unused translation, or one whose values do not match
- [x] The opening lines, with their ideas and notes, are in English in `src/repertoire.ts` and in Hebrew in `src/lang/repertoire.he.ts` (by the line's `id`; checked in `check-lines`)
- [x] Spanish: the interface only. The explanations of the openings and the line names are in English and the moves use the English letters, with a note in Learn and in the account panel. No Spanish-speaking chess player has gone over the translation yet
- [ ] Later, only if there is demand: translated explanations (about 12,300 words per language, with a player going over them) and more languages. The app does not measure usage; adding that is a separate decision

## Simplicity ✅
- [x] "Play" settings: only mode, opening and level are visible; the rest is under "More options"

## Design and experience ✅
- [x] One dark color scheme (tokens in `src/index.css`), the Heebo font, a green and cream board
- [x] Cards with a color stripe by the kind of message (blue book, amber "there is better", red mistake, green correct)
- [x] Mobile: a bottom tab bar, settings in a bottom sheet, confirm buttons under the board without scrolling; tap-to-move in addition to dragging
- [x] The board's height follows the room left on the screen (no scrolling, at least 320px)
- [x] Learn on a phone: the board is sized by the room left below its top (so the first-visit guide counts), and the step buttons never sit under the tab bar; the line picker has a row of its own (checked in `screens.py --only touch`, in every language)
- [x] Sounds: move, capture, check, mistake, "well done" (Web Audio, can be muted)
- [x] PWA: installs to the home screen, works offline (including the engine and the puzzles). The logo: a check mark on a board (`public/favicon.svg`, and PNGs for the manifest, a maskable one included); the service worker's cache name changes with them (`chess-trainer-v3`), so returning users get the new icons
- [x] A suggestion to install (Learn, a small card — not a popup), only after real use: a line passed without a mistake, or puzzles on two days. "Not now" is for good; the account panel keeps a button. Chrome and Edge open the browser's dialog, an iPhone gets the steps
- [x] Deployed on Vercel (a push to main publishes)
- [x] A shared link shows a preview (Facebook, WhatsApp, X): static `og:`/`twitter:` tags in `index.html`, in Hebrew for the first posts, and `public/og-image.png` (1200×630, the logo, a Hebrew headline and the app's board), made by `scripts/make-og-image.py`. `check-i18n` allows Hebrew in those tags only
- [x] Vercel Web Analytics: anonymous page views, no cookies, only in the build Vercel makes (`VITE_ON_VERCEL`, `vite.config.ts`); `public/sw.js` leaves `/_vercel/` to the network. No other tracking
- [x] A privacy page (`src/Privacy.tsx`, in every language): from the account panel, and at `/privacy` (a rewrite in `vercel.json`; `src/nav.ts` opens it over the app, so Back closes it). Deleting the cloud copy is by a GitHub issue, as there is no delete button yet

## Stage 4 — a wider repertoire
- [x] London: the 5 lines were deepened to 11 moves, and 3 new branches: against ...c5 and ...cxd4, against ...c5 and ...Qb6, and against the Dutch (...f5). Every White move checked with Stockfish (depth 20)
- [x] Caro-Kann: the 6 lines were deepened to 11 Black moves (each checked with Stockfish). In the Two Knights: 7...Qxd4! — the d4 pawn is not defended, and Black trades queens a pawn up
- [x] Italian and Slav: all lines deepened to 11 user moves (each checked with Stockfish). In the Slav against the London the line continues like the London line from the other side; "knight to c3 first" goes on like the Quiet system; against the Colle Black takes on c4 and stays a pawn up
- [x] **All 47 lines in all four openings are 10–11 user moves long**
- [x] Branches from your games (My review → "Where your games leave your lines"): opponent moves that have no line — "Add a branch" adds Stockfish's answer (5 half-moves) to the repertoire, to Learn and to training; and places where you left the line — "Practice" (`src/deviations.ts`, `src/customLines.ts`, `src/Branches.tsx`; the branches sync between devices)
- [x] PGN import (Learn → "+ Import a line"): one game or several, or just moves; only the main line; every line is checked to be legal and not to contradict the repertoire, and is added as a ★ branch
- [x] 1.e4: 12 lines against the Scandinavian, the Sicilian (Alapin), the French and the Caro-Kann (Advance) and the Modern — the replies met most often in real games
- [x] The Italian moved to 2.Bc4 (the Bishop's Opening): 1.e4 e5 2.Bc4 Nc6 3.Nf3 reaches exactly the same positions, and the explanations did not change
- [x] 9 lines after 2.Bc4 (against 2...Nf6 the line plays 3.d3 — after 3.Nf3 Nxe4 Black is better): the 3...Nd4 trap (4.Nxe5? is the natural mistake, and 4...Qg5 wins material), ...h6, ...Nf6 with ...c6 / ...d5 / ...Bc5, ...d6, ...Bc5 and ...d6, ...c6, ...Qf6. Every move checked at depth 20; 2.Bc4 itself loses about 2.5% — that is the choice of the opening
- [x] 8 lines for the gaps left in My review: against 1...d6 (Pirc, Philidor), 1...b6 (Owen) and 1...Nc6 (Nimzowitsch, against ...d5 and against ...e5) the line plays 2.d4 and not 2.Bc4 — at depth 23, 2.Bc4 loses 30–40 centipawns there (against 1...e5 only 15). As Black: against 2.e3 (3.c4 goes into the Quiet system; 3.Bd3) and against 2.Nc3 Nf6 3.Bf4. Every move checked at depth 20
- [x] New repertoire: the Sicilian with ...e6 (Black), 22 lines. Open: Taimanov (...cxd4, ...Nc6, ...Qc7, ...a6) against 6.Be3 / 6.Be2 / 5.Nb5 / 5.Nxc6 / 5.c4; against 2.d4 Black takes at once (2...cxd4, including the Smith-Morra); ...e6 and ...d5 against 2.Bc4, 2.c3, 2.Nf3 and 3.c3 (there 4...d4), 2.Qh5, 2.Qf3, 2.d3, 2.c4. Move orders (2.Nc3 / 2.d4 cxd4 3.Nf3) go into the Taimanov. Every move checked at depth 20 (5...Qc7 loses about 2% — the main move of the Taimanov). 150 Sicilian puzzles were added to "from my openings"
- [x] 6 more lines against the London as Black: 3.Nf3 and 4.c3 go into the main line; 4.Bd3 ...Qb6 (b2 is not defended, Black takes a pawn); 4.dxc5 e6; 4.Nf3 Nc6 5.Bb5 Qa5+; 5.Bd3 Bg4. Every move checked at depth 20.
- [x] New repertoire: the Queen's Gambit Accepted (Black), 7 lines — 2...dxc4 against 2.c4, beside the Slav (2...c6); the review gives every game to the repertoire it followed furthest. Against 3.e4 (e5: 4.Nf3 / 4.d5 / 4.dxe5), 3.e3, 3.Nc3 (10...Bxb5! — ...a6 loses 7.5%), 3.Nf3, 3.Qa4+. 2...dxc4 itself loses less than 1%. Every move checked at depth 20
- [x] New repertoire: 1...e5 (Black), 19 lines, for players who answer 1.e4 with 1...e5 (26 Nov 2026, so the app is open to more players): the Italian with 3...Bc5 (Giuoco Pianissimo, c3 and d4, early castling, Four Knights), the Evans Gambit, the Ruy Lopez (Closed, d3, Exchange), the Scotch (Mieses, Four Knights, Gambit), the Spanish Four Knights, the Ponziani, the Vienna (f4, Bc4), the Bishop's Opening, the King's Gambit (3...d5), the Center Game and 2.Qh5. Every Black move checked at depth 18: none gives up 3% of the win chance or more (most less than 2%; 3...d5 in the King's Gambit 2.4%). My review's "Train" button finds it for Black's games in these openings (not the Two Knights, which is 3...Nf6)
- [x] New repertoire: the Queen's Gambit (White), 17 lines after 1.d4 d5 2.c4: the Declined with the Exchange (4.cxd5 — against 5...c6, 5...Be7 and the 5...Nbd7 trap), against 3...Be7 (5.Bf4), the Tarrasch (g3 and Bg2 against the isolated pawn) and 3...Bb4; the Slav (5.a4, e3, Bxc4 and e4), the Semi-Slav, 4...a6 (c5) and an early 3...dxc4; the Accepted with 3.e4 (against ...e5, ...Nf6 and ...c5); the Albin, the Chigorin, the Baltic and the Marshall (which meet in one position). Every White move checked at depth 18: none gives up more than 2.1%, and in every position all lines play the same move. My review's "Train" button finds it for White's games in these openings
- [x] 150 puzzles from the Queen's Gambit Accepted in "from my openings" (`public/puzzles-v3.json`, 3,900 puzzles)
- [x] Hiding openings (Learn → ⚙): a hidden opening leaves the pickers in Learn and in training, without deleting progress; at least one always stays; synced between devices (`src/hiddenReps.ts`)

## Stage 5 — polish
- [x] Statistics for every line (tap "Mastered N of M" in Learn): the share of tests without mistakes, and the move you missed most (in training or in tests) — a tap opens the line right there (`src/lineStats.ts`; a `misses` counter for every position in `mistakes`)
- [x] Strengths in My review: a "Your strengths" card with the best opening of each color, and a green ★ on the 3 strongest in the opening tables (beside the 3 weakest in red, ▾). A "strong" opening needs at least 10 games and 5 points above your average with that color; games with no recognized opening ("Undefined") do not count. The table also shows a marked opening that is not among the 8 most common (`strongestOpenings` / `weakestOpenings` in `src/reviewStats.ts`, checked in `check-review`)
- [x] The side panel scrolls inside: on a wide screen (board and panel side by side) the panel beside the board in Learn, Play, the puzzles and My mistakes is as tall as the room left on the screen (the same measure as the board, `--fit-h` on `<main>`), no less than 320px, and scrolls inside — the page does not. `scrollbar-gutter: stable` in the panel and the page, so the width does not jump when a scrollbar appears. A feedback card that appears while the panel is scrolled down is brought into view (`src/useSidePanel.ts`). On phones and tablets (panel below the board) nothing changed
- [x] Phone (25 Nov 2026, after a check in Chrome's mobile mode with a signed-in account): a hidden opening also leaves My mistakes and every count (`practiceMistakes`, `src/mistakes.ts`; nothing is deleted, and the empty screen says how many positions wait in hidden openings); the count in the bottom bar is beside the icon and not on it; everything tapped is 44px tall on phones and touch screens; in a game review the header is one line and the board adapts, so the whole coach card shows without scrolling (667px and up, without browser bars). Checked in `screens.py --only touch`
- [x] Fixes after free play in Chrome (25 Nov 2026): "Reset" beside "Learned" asks first, and sync does not bring the moves back (`RESET_MARK` in `src/syncMerge.ts`); the move list follows the game on desktop and in a game review too; in "Test me" the red marks where you played by mistake; moves inside right-to-left text are not reversed (`isolateMoves`); an impossible Chess.com username gets "no such user" and not "no connection"; the font of the "Starting position" heading
- [x] A draw in Play says why (stalemate, repetition, 50 moves, insufficient material), and the win-chance bar shows the result at the end of a game (25 Nov 2026). Promotion and every way a game ends are checked in `nav.py --only ends,computer,drag`
- [x] The Back button closes a panel, leaves a game review or returns to the tab before, instead of leaving the app (`src/nav.ts`, in the browser's history); a game in Play continues after a reload or after closing, for up to 24 hours (`src/savedGame.ts`, on the device only); the daily goal counts puzzles that were solved (also with a hint or after a mistake), not "Show solution"
- [x] An engine that does not answer within 8 seconds is started again beside the first one (25 Nov 2026)
- [x] Full code review (23 Nov 2026: logic and security, interface, infrastructure). Fixed:
  - Sync: writing the same value is no longer a change (before, a device that was behind became "newer" just by opening the app and overwrote settings saved on another device); a removed ★ branch does not come back from the other device (a removal mark, `removed`); cancelling sign-in on a phone no longer leaves the button on "Signing in…"; a request to reload is not lost when a sync is already running; an error when signing out is handled
  - Completing the sync fix (24 Nov 2026; the first one was partial): `useStored` no longer saves the default on load. Before, a new device marked 10 defaults as changes and, on the first sign-in, overwrote the settings in the cloud with them (also the Chess.com username, with an empty field). On a device's first sync the settings in the cloud win (`asNewDevice` in `src/syncMerge.ts`; progress is still merged item by item) — so a device opened before the fix does not overwrite either. If the Firebase file did not load, another tap on sign-in loads the page again (Chrome does not download a failed module twice); returning from Google's page to a page the browser kept as it was frees the button. Checked in `scripts/qa/sync.py` (several devices against the Firebase emulators); the checks of these bugs failed before the fix. The other browser checks run on a build without Firebase, so they do not run the sync code
  - One account at a time (25 Nov 2026): when another Google account signs in on the same device, the previous one's data is kept aside on the device (`chess-trainer:aside:<uid>`, not synced) and comes back when it signs in again; before, it was merged into the new account and uploaded to its cloud. Language and sound stay (they belong to the device). No room to keep it aside — no switch and no sync. What was done before the first sign-in joins the account (`cloud-owner`, `switchOwner` in `src/cloud.ts`)
  - Two devices that sync at the same moment no longer overwrite each other: read-merge-write in a transaction (`mergeDoc` in `src/firebase.ts`); a change on the device during a sync is kept
  - Checks that fail on the old code: a Chess.com month saved midway (`check-review`), state that must not leak between positions and screens in Play (`play.py --only states`), one engine in a game review (`screens.py`)
  - Chess.com: a month saved midway no longer stays incomplete — a copy is final only if it was saved after the month ended (`chesscom-archives-v2` cache)
  - Offline: the service worker kept only what `index.html` links to and deleted the Firebase file, which loads later, at every visit; now it keeps all the files of the version by Vite's `asset-manifest.json`
  - Play: a hint that arrives after you moved is not drawn on another position; "Take back" removes the hint arrow; hiding an opening in Learn does not reset a regular game; the "To review" count follows changes on other screens
  - A game review stops the engine analysis of My review (two engines at once slowed both)
  - The class thresholds are defined in one place, `DROP` in `src/engine.ts`, instead of four
  - Accessibility: ⏮ ⏭ are mirrored in right-to-left languages like ‹ ›; a label for the ⚙ button in Learn
  - Infrastructure: `npm test` and `npm run check` (in CI and in the docs instead of four commands); `engines` (Node 24, as in CI and on Vercel); `stockfish` moved to devDependencies at an exact version (the engine itself is a copy in `public/engine`); the libraries are in a file of their own (`vendor`, kept in the cache between versions; no more 500kB warning); security headers in `vercel.json`; `check-lines` also fails on a translation of a line that does not exist
  - Left as it is on purpose: no CSP (Google, Firestore, Chess.com and the fonts would have to be listed and maintained); when signing out the data stays on the device (the app works without an account too), and whoever uses the device without signing in sees it; splitting the large components (`Trainer.tsx`, `Learn.tsx`, `Review.tsx`) and shared interface components (move list, stepper) — worth doing when touching them

## Where things stand and what is next
- New address (22 Nov 2026): https://opening-trainer-app.vercel.app — another domain of the same Vercel project; the old address (chess-trainer-seven-pink.vercel.app) still works. Sign-in runs on the address the page was opened from (`src/cloudConfig.ts`), so every address must be allowed in three places: Firebase Auth, the API key (website restrictions) and the OAuth client — see the end of `docs/google-login-setup.md`. Progress is kept per address: on a new one you sign in with Google once and it loads from the cloud
- Link previews (26 Nov 2026): checked in Facebook's Sharing Debugger — the picture, the Hebrew title and the description show; only the optional `fb:app_id` is missing. `og:url` is the Hebrew link (`/?lang=he`), as Facebook sends a click on the preview to it; for posts in English it would be the plain address. A link can choose the language and keep `utm_*`: `/?lang=he&utm_source=facebook`
- A domain of our own (not yet): `src/cloudConfig.ts` runs sign-in on the page's own host only for `*.vercel.app`, so it must include the new host; then the three places in `docs/google-login-setup.md` ("Adding another address"), `og:url`/`og:image` in `index.html` and a new scrape, and a redirect from the vercel.app addresses. Progress saved without signing in stays at the old address (localStorage is per origin); only users who signed in with Google keep it
- My review shows, for every opening, where your games leave your lines; what is left there is usually a habit rather than a missing line, and it is practiced with "Practice"
- After 3–4 weeks of games: load My review again and choose the next stage by what it shows
- Checked on the live site (Playwright): training games in the Sicilian and the Queen's Gambit Accepted, "Test me", puzzles, the review, hiding openings, English on a phone. Syncing hidden openings was checked too (22 Nov 2026, in Chrome with a signed-in Google user): the change reached the cloud within seconds, and after it was deleted from the device it came back from the cloud and the page reloaded
- The browser checks are scripts in the repository: `scripts/qa/` (Python + Playwright; see `scripts/qa/README.md`). `learn_lines.py` — "Test me" on every line; `play.py` — the Play screen; `nav.py` — Back, reload, how games end, dragging, keyboard, the engine; `screens.py` — the other screens, phone, languages and offline; `sync.py` — sign-in, sync and the Firestore rules, against the emulators. Every script ends with passed / failed, and the reports and screenshots go to `scripts/qa/out` (not in git). The lines are read from `src/repertoire.ts` at every run, so new lines are checked by themselves. They do not run in CI (about 35 minutes together): once at the end of a day, or after a large change

---

## Findings of the code review

Fixed (25 Nov 2026):
- [x] Code that fails a check is not deployed: Vercel runs `npm run check` as its build command (`buildCommand` in `vercel.json`). Node 24 everywhere
- [x] Sync: above 1MB (the Firestore limit) nothing is written and a message says so; no room to keep an account aside — a message that explains; a change is always newer than the one it replaces, also when the device's clock is behind
- [x] `firestore.rules`: `updatedAt` is checked too (a number); the rules are checked in `scripts/qa/sync.py`. The new rules were published in the Firebase console (25 Nov 2026, 16:53)
- [x] Scripts are type-checked (`tsconfig.scripts.json`); `npm audit` is clean (`overrides` for `@grpc/grpc-js`, which is not in the built files)
- [x] Engine: searches that are no longer needed are stopped (`Engine.cancel`); an engine that did not load — a message with "Try again"
- [x] My review analyzes like the game review (by depth, and it uses a kept review), so they agree; old analyses stayed as they were, because analyzing again would reset the reviews in My mistakes. A position between two mistakes is searched once; the kept reviews are read once
- [x] Chess.com: an invalid answer gets an ordinary message; cancelling or a failure stops all the requests
- [x] Keyboard in dialogs (`src/useDialog.ts`): the focus moves in, stays and returns, Escape closes, and the arrows do not move what is behind; chips with `aria-pressed`; weak openings are also marked with ▾; a chart whose values are all equal; the progress of the analysis does not redraw the whole page
- [x] `PREFIX` and `writeStored` in one place; `RECENT_GAMES`; an `id` for every line, so a rename does not lose progress; the sign-in guide uses the new address; `id`, `lang` and `dir` in the manifest

Left:
- [ ] A device that was signed out before 25 Nov 2026 does not know whose data it has: if another account signs in there first, it is merged into it once. There is no way to know afterwards; opening the app once while signed in to the right account prevents it
- [ ] No Dependabot (automatic dependency updates): it opens PRs in the repository, so it is the owner's decision

## Known issues / open decisions
- [x] Class thresholds 6/12/20% (25 Nov 2026; before 10/20/30), by a comparison with Chess.com (`DROP` in `src/engine.ts`). Only mistakes from 20% go to practice in bulk (`DRILL_DROP`), as before; when the coach stops in Play did not change. Old analyses of My review kept the old classes. To check on another game the owner reviews on Chess.com, one that took no part in choosing the thresholds
  - Move-by-move comparison (25 Nov 2026): two games, 112 moves after the book, 28 of them marked on Chess.com (inaccuracy, mistake, miss or blunder). With 10/20/30 the app marks 21 of them, none superfluous, and gives the same name to 9 of 22 (without misses); with 6/12/20 — 26, one or two superfluous, and 18 of 22; with 5/10/20 — 26, 4–6 superfluous, and 18 of 22. Two moves marked there are a drop of less than 2% here (the engines differ). The sample is small, and the thresholds were chosen on the same games
  - Stability: the same game gives exactly the same result in a game review and in My review (3 games, 4 runs). Before, My review did not clear the engine between games and gave other results; now `analyzePositions` clears it. Kept reviews are computed again (`VERSION` 3). A change in the order of the searches moves borderline moves by 1 to 5 points
  - Accuracy: in 8 games (16 scores) the average difference from Chess.com is 10 points, in both directions (mean -1), and the correlation is 0.68. The app's scores are more extreme
- Promotion is always to a queen (enough for openings; in puzzles an underpromotion counts by its squares)
- In a decided position (+10) the coach hardly stops. That is on purpose: a 1% drop is not a mistake
- License: the project is open, GPL-3.0-or-later (like Stockfish, which comes with it). The libraries and the data are listed in `THIRD_PARTY_NOTICES.md`

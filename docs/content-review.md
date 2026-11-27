# Content review

Every idea and note of every repertoire, in English and Hebrew, was reviewed before launch (27 Nov 2026): wrong board facts (pins, threats, "connects the rooks", castling that never happens, doubled pawns that are not), notes that do not match their move, English and Hebrew that say different things, unnatural Hebrew, chess terms (one Hebrew word for a pawn and one for a file everywhere), typos — and evaluations, which must match the engine: under 0.30 is about equal, 0.30–0.70 a slight edge, 0.70–1.50 better, above 1.50 much better. Board facts were checked on the position (chess.js), evaluations with the bundled Stockfish 19.

Clear mistakes were fixed directly. Only real judgement calls the engine does not settle are left for the owner, under **Open questions** in each repertoire.

## The questions of the first round — resolved

The 14 judgement calls of the first round (commit 9a03bb8) were decided by the engine rule above:

1. **london / `vs-c5-and-cxd4`, move 11.Bb5** — was “White is better in this queenless position.”, now “White has a tiny edge in this queenless position.” (Stockfish: +0.24, under 0.30 is about equal.)
2. **london / `vs-c5-and-qb6`, move 4.Nc3** — was “if 4...Qxb2?, then 5.Nb5! threatens Nc7+ and Black’s queen is in danger.”, now “if 4...Qxb2, then 5.Nb5 threatens Nc7+, and Black has to find 5...Nd5 to hold the balance.” (Stockfish: after 5.Nb5, 5...Nd5 is 0.00 (6.Rb1 Qa2 7.Ra1 Qb2 repeats).)
3. **italian / `bishops-opening-the-nd4-trap`, name** — was “Bishop’s Opening: the ...Nd4 trap”, now “Italian Game: the ...Nd4 trap” (1.e4 e5 2.Bc4 Nc6 3.Nf3 Nd4 is the Italian Game (the Blackburne Shilling Gambit), reached through the Bishop’s Opening.)
3. **italian / `bishops-opening-vs-h6`, name** — was “Bishop’s Opening vs ...h6”, now “Italian Game vs 3...h6” (1.e4 e5 2.Bc4 Nc6 3.Nf3 h6 is an Italian Game position.)
4. **italian / `bishops-opening-the-nd4-trap`, move 10.Qg3** — was “The queen drops back and stays facing Black’s king.”, now “The queen steps away from the bishop and stays on the kingside, hitting the g4 bishop and c7.” (On g3 the g4 bishop blocks the way to g8; the queen attacks the bishop (defended by the f6 knight) and c7.)
5. **italian / `two-knights-vs-h6`, move 11.Ba4** — was “The bishop stays on the a4-e8 diagonal and keeps the pressure.”, now “The bishop steps back to a4, out of reach of the a5 knight (on b3 or c4 the knight would trade it off).” (Black has castled: nothing to press on a4-e8; the point is to avoid ...Nxb3 or ...Nxc4.)
6. **italian / `sicilian-alapin-vs-nc6`, idea** — was “Black’s king is stuck in the center, and White’s rook lands on the open d-file at once.”, now “the queens come off, but Black’s king is still in the center and White’s rook lands on the open d-file at once. The game is about level.” (Stockfish: about +0.23 at the end; the queens come off on move 10 and Black castles long soon after.)
7. **italian / `french-advance-vs-qb6`, move 11.Nxe5** — was “Take with the knight: it is excellent on e5, and the d4 pawn stays strong.”, now “Take with the knight: it is excellent on e5. If Black trades it, the d4 pawn comes to e5, and White keeps a slight edge.” (Stockfish: 11...Nxe5 12.dxe5, +0.56 for White.)
8. **ruy / `zaitsev`, idea** — was “After ...Nb8 White opens the center with dxe5, when the e4 pawn is well defended.”, now “After ...Nb8 White opens the center with dxe5 and keeps a slight edge.” (e4 is attacked twice and defended once; Stockfish: dxe5 is best, about +0.5.)
9. **ruy / `philidor`, move 11.Qxe5** — was “Takes back. Black’s pieces are tied up.”, now “Takes back. White has a slight edge, though Black develops with ...Bd6, hitting the queen.” (Stockfish: about +0.7 for White; 11...Bd6 comes with tempo.)
10. **sicilian / `against-2nf3-and-3e5`, move 11...Ne7** — was “Develops, reaching a comfortable endgame.”, now “Develops: Black is a clean pawn up in the endgame, with a slight edge.” (Stockfish: -0.63 for White; 6 pawns against 5, the same pieces.)
11. **sicilian / `open-taimanov-vs-6be3`, move 11...Qc5** — was “The queen is safe, and Black is a pawn up.”, now “The queen is safe and Black is a pawn up, but White’s lead in development gives White a slight edge.” (Stockfish d20: +0.31 for White after 11...Qc5.)
12. **sicilian / `open-vs-5nxc6`, move 11...a5** — was “threatens ...a4.”, now “prepares ...a4.” (...a4 hits nothing concrete in this position.)
13. **sicilian / `against-2qh5`, move 11.Bg5** — was “White pins the f6 knight.”, now “White puts pressure on the f6 knight.” (Only the defended e7 bishop stands behind the knight; Bg5 and Qh4 press on f6.)
14. **najdorf / `vs-f4`, move 11...Qd8** — was “The queen goes back; e5 is weak.”, now “The queen goes back; the position is level.” (Stockfish: 0.07.)

## Every repertoire

### London System (White) (`london`, 8 lines)

Reviewed in the first round (9a03bb8): 33 fixes.

No open questions.

### Italian Game & 1.e4 (White) (`italian`, 32 lines)

Reviewed in the first round (9a03bb8): 65 fixes.

No open questions.

### Ruy Lopez (White) (`ruy`, 18 lines)

Reviewed in the first round (9a03bb8): 66 fixes.

No open questions.

### Scotch Game (White) (`scotch`, 13 lines)

Reviewed in the second round: 16 fixes.

No open questions.

### King’s Gambit (White) (`kingsgambit`, 13 lines)

Reviewed in the second round: 32 fixes.

**Open questions:**

- **`g5`, move 10.exd5** — now “Takes.”  
  Question: Keep 10.exd5, or switch to 10.Ne3 (engine PV ...dxe4 hxg3, about -0.4), which keeps the knight away from ...Bxg4?  
  Suggestion: Switch to 10.Ne3 if the line is re-recorded; otherwise keep it with the corrected 11.cxd4 note.
- **`declined-qh4`, move 10.h4** — now “Gains space and takes g5 from the black queen.”  
  Question: Keep 10.h4 Qf6 11.Qxg3, or take on g3 at once with 10.Qxg3?  
  Suggestion: 10.Qxg3 is simpler and scores higher; consider it if the line is re-recorded.

### Vienna Game (White) (`vienna`, 8 lines)

Reviewed in the second round: 21 fixes.

No open questions.

### Open Sicilian (White) (`opensic`, 16 lines)

Reviewed in the second round: 31 fixes.

No open questions.

### English Opening (White) (`english`, 14 lines)

Reviewed in the second round: 22 fixes.

No open questions.

### Colle System (White) (`colle`, 13 lines)

Reviewed in the second round: 17 fixes.

No open questions.

### Queen's Gambit (White) (`qg`, 17 lines)

Reviewed in the second round: 74 fixes.

No open questions.

### Catalan (White) (`catalan`, 13 lines)

Reviewed in the second round: 8 fixes.

No open questions.

### Trompowsky Attack (White) (`trompowsky`, 10 lines)

Reviewed in the second round: 32 fixes.

No open questions.

### 1...e5: Italian, Ruy Lopez & more (Black) (`e5`, 19 lines)

Reviewed in the second round: 38 fixes.

No open questions.

### Alekhine Defense (Black) (`alekhine`, 12 lines)

Reviewed in the second round: 8 fixes.

No open questions.

### Petrov Defense (Black) (`petrov`, 14 lines)

Reviewed in the second round: 17 fixes.

No open questions.

### Scandinavian Defense (Black) (`scandinavian`, 9 lines)

Reviewed in the second round: 34 fixes.

**Open questions:**

- **`qa5-vs-bd2`, idea** — now “After Bd2 the queen is in a discovered-attack line, so it goes to b6, hitting b2 and d4. Black castles short while White goes long.”  
  Question: Keep this line as it is (a clear White edge by move 9), or change Black’s play earlier (e.g. 7...e6 / 8...Bb4 order) so the line ends closer to equal?  
  Suggestion: Check earlier alternatives with the engine (from 5...Qb6 onward); if none is close to equal, keep the line and add a short note that White is better here.

### French Defense (Black) (`french`, 12 lines)

Reviewed in the second round: 19 fixes.

No open questions.

### Pirc Defense (Black) (`pirc`, 11 lines)

Reviewed in the second round: 3 fixes.

**Open questions:**

- **`vs-nf3`, move 8...Bg4** — now “Hits the f3 knight, which guards d4 and e5.”  
  Question: Keep 8...Bg4 (and the bishop-for-knight plan the idea describes), or switch to 8...Qb6, which the engine rates about 0.3 better?  
  Suggestion: Consider 8...Qb6 (engine PV: 9.h4 Bh6 10.Qxh6 Ng4 11.Qd2 h5), or keep Bg4 and accept that White ends clearly better.

### Modern Defense (Black) (`modern`, 11 lines)

Reviewed in the second round: 12 fixes.

No open questions.

### Caro-Kann (Black) (`caro`, 6 lines)

Reviewed in the first round (9a03bb8): 9 fixes.

No open questions.

### Sicilian with ...e6 (Black) (`sicilian`, 22 lines)

Reviewed in the first round (9a03bb8): 58 fixes.

No open questions.

### Sicilian Najdorf (Black) (`najdorf`, 18 lines)

Reviewed in the first round (9a03bb8): 22 fixes.

No open questions.

### King's Indian Defense (Black) (`kid`, 12 lines)

Reviewed in the second round: 5 fixes.

No open questions.

### vs 1.c4 and 1.Nf3 (Black) (`flank`, 13 lines)

Reviewed in the second round: 34 fixes.

No open questions.

### Nimzo-Indian & Queen’s Indian (Black) (`nimzo`, 16 lines)

Reviewed in the second round: 28 fixes.

No open questions.

### Grünfeld Defense (Black) (`grunfeld`, 14 lines)

Reviewed in the second round: 23 fixes.

No open questions.

### Queen's Gambit Declined (Black) (`qgd`, 9 lines)

Reviewed in the second round: 11 fixes.

No open questions.

### Benko Gambit (Black) (`benko`, 16 lines)

Reviewed in the second round: 28 fixes.

No open questions.

### Dutch Defense (Black) (`dutch`, 6 lines)

Reviewed in the second round: 11 fixes.

No open questions.

### Slav Defense (Black) (`slav`, 15 lines)

Reviewed in the second round: 57 fixes.

**Open questions:**

- **`knight-to-c3-first`, idea** — now “White develops the b1 knight first. Black plays exactly the same moves — and reaches the position of the quiet system (a transposition). Nothing new to learn.”  
  Question: Should this line cover 5.cxd5 cxd5 6.Qb3 (the engine's top choice after 4...Bf5), or keep 'Nothing new to learn'?  
  Suggestion: Either add a short line 5.cxd5 cxd5 6.Qb3 Bc8, or soften to 'Almost nothing new to learn' and mention 5.cxd5 with 6.Qb3.

### Queen’s Gambit Accepted (Black) (`qga`, 7 lines)

Reviewed in the second round: 31 fixes.

No open questions.

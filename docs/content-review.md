# Content review — open questions

A review of every idea and note, in English and Hebrew, of the five most popular repertoires (London, Italian, Ruy Lopez, the Sicilian with ...e6 and the Najdorf, Caro-Kann) before launch, 27 Nov 2026. Board facts were checked on the position (chess.js) and evaluations with the bundled Stockfish 19.

253 clear mistakes were fixed directly (wrong board facts, notes that did not match their move, English and Hebrew that said different things, unnatural Hebrew, inconsistent terms (two different Hebrew words for a file), typos).

Below are the chess judgement calls that were **not** changed — for the owner to decide. Scores are from the side to move unless said otherwise.

## London System (`london`)

- **`vs-c5-and-cxd4`, move 11.Bb5** (English): “White is better in this queenless position.”  
  Stockfish d18 after 11.Bb5: about +0.24 for White, a small edge. 'White is a little more comfortable' would be more accurate than 'better'.

- **`vs-c5-and-qb6`, move 4.Nc3** (English): “Black’s queen is in danger”  
  After 4...Qxb2 5.Nb5 Stockfish d18 gives 5...Nd5! at 0.00 (6.Rb1 Qa2 7.Ra1 Qb2 repeats). The queen is harassed but not lost, so '4...Qxb2?' and 'in danger' overstate it; the same goes for the idea paragraph's framing.

## Italian Game & 1.e4 (`italian`)

- **`bishops-opening-the-nd4-trap`, name** (English): “Bishop’s Opening: the ...Nd4 trap”  
  1.e4 e5 2.Bc4 Nc6 3.Nf3 Nd4 is the Italian Game (the Blackburne Shilling Gambit) reached by a Bishop's Opening move order, not a Bishop's Opening proper. The same applies to 'bishops-opening-vs-h6' (2.Bc4 Nc6 3.Nf3 h6). The owner may still prefer the label for grouping.

- **`bishops-opening-the-nd4-trap`, move 10.Qg3** (English): “stays facing Black’s king”  
  On g3 the queen is blocked from g8 by Black's own Bg4 and the g7 pawn, so 'facing the king' is loose; it mostly eyes the g4 bishop and the kingside. Engine: White is about +1.15 after 7.exd5, so 'a pawn up' holds.

- **`two-knights-vs-h6`, move 11.Ba4** (English): “keeps the pressure”  
  Black has castled and c6/d7/e8 are empty, so the bishop on a4-e8 presses nothing in particular. It is mainly kept out of ...Nxb3 range.

- **`sicilian-alapin-vs-nc6`, idea** (English): “Black’s king is stuck in the center”  
  The queens come off on move 10, so a king in the center matters little; Stockfish d18 rates the final position about +0.23 for White and has Black castle long soon after. The compensation comes from activity, not from the king.

- **`french-advance-vs-qb6`, move 11.Nxe5** (English): “and the d4 pawn stays strong”  
  Stockfish d18 answers 11...Nxe5 12.dxe5, so the d4 pawn is exchanged off to e5 at once; White is still a bit better (+0.56).

## Ruy Lopez (`ruy`)

- **`zaitsev`, idea** (English): “when the e4 pawn is well defended”  
  After 10...Nb8 the e4 pawn is attacked twice (Nf6, Bb7) and defended once (Re1); in the engine PV after 11.dxe5 dxe5 12.Qxd8 Bxd8 13.Nxe5 Black does take on e4. dxe5 is engine-best (+0.5), but "well defended" is overstated. Hebrew idea says the same.

- **`philidor`, move 11.Qxe5** (English): “Black’s pieces are tied up.”  
  Engine gives White about +0.7, but Black answers 11...Bd6 with tempo on the queen and develops freely; "tied up" is overstated (Hebrew says the same).

## Sicilian with ...e6 (`sicilian`)

- **`against-2nf3-and-3e5`, move 11...Ne7** (English): “reaching a comfortable endgame”  
  Understated: in the final position Black is a clean pawn up (6 pawns vs 5, same pieces). Stockfish d16: -0.63 for White. The note/idea could say so.

- **`open-taimanov-vs-6be3`, move 11...Qc5** (English): “Black is a pawn up”  
  Materially true, but Stockfish d16 gives White +0.30 after 11...Qc5 (lead in development, Black king in the center), so the note may suggest Black is doing better than it is.

- **`open-vs-5nxc6`, move 11...a5** (English): “threatens ...a4”  
  ...a4 does not threaten anything concrete here (nothing on b3); "prepares ...a4" would be more accurate.

- **`against-2qh5`, move 11.Bg5** (English): “White pins the f6 knight.”  
  The knight is pinned only to the defended e7 bishop (Qd8 behind it); it is more pressure on f6 (Bg5 + Qh4) than a real pin.

## Sicilian Najdorf (`najdorf`)

- **`vs-f4`, move 11...Qd8** (English): “e5 is weak.”  
  Stockfish d16 gives 0.07 (equal) here; the e5 pawn is not easy to attack and Black still has to deal with Bxd7+. "Weak" may be overstated.

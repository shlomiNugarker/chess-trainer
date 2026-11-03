import { Chess } from 'chess.js';

// A repertoire is a set of lines (SAN, from the initial position).
// Lines are merged into a position-keyed book, so transpositions just work.

export type Repertoire = {
  id: string;
  name: string;
  userColor: 'w' | 'b';
  lines: { name: string; moves: string }[];
};

export const REPERTOIRES: Repertoire[] = [
  {
    id: 'london',
    name: 'מערכת לונדון (לבן)',
    userColor: 'w',
    lines: [
      { name: 'ראשי מול ...d5 ו-...c5', moves: 'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3' },
      { name: 'מול ...Nf6 ו-...e6', moves: 'd4 Nf6 Bf4 e6 e3 c5 c3 Nc6 Nd2 d5 Ngf3 Bd6 Bg3 O-O Bd3' },
      { name: 'מול ...Qb6 מוקדם', moves: 'd4 d5 Bf4 c5 e3 Nc6 c3 Qb6 Qb3 e6 Nd2 Nf6 Ngf3' },
      { name: 'מול מבנה הודי-מלכותי', moves: 'd4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5 c3' },
      { name: 'מול ...Bf5', moves: 'd4 d5 Bf4 Bf5 e3 e6 c4 Nf6 Nc3 Bb4 Qb3' },
    ],
  },
  {
    id: 'caro',
    name: 'קארו-קאן (שחור)',
    userColor: 'b',
    lines: [
      { name: 'קלאסי', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6' },
      { name: 'קלאסי דרך Nd2', moves: 'e4 c6 d4 d5 Nd2 dxe4 Nxe4 Bf5 Ng3 Bg6 Nf3 Nd7' },
      { name: 'שיטת ההתקדמות', moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 Nd7 O-O Ne7 Nbd2 h6' },
      { name: 'שיטת ההחלפה', moves: 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7 Nd2 e6 Ngf3 Bd6' },
      { name: 'פנוב', moves: 'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Bb4 cxd5 Nxd5 Qc2 Nc6' },
      { name: 'שני הפרשים', moves: 'e4 c6 Nf3 d5 Nc3 Bg4 h3 Bxf3 Qxf3 e6 d4 dxe4 Nxe4 Nd7 c3 Ngf6 Bd3' },
    ],
  },
];

/** Position key: board, side, castling, en-passant (ignores move counters). */
export const posKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

export type Book = Map<string, string[]>; // posKey -> SAN moves seen in repertoire

export function buildBook(rep: Repertoire): Book {
  const book: Book = new Map();
  for (const line of rep.lines) {
    const c = new Chess();
    for (const san of line.moves.split(/\s+/)) {
      const key = posKey(c.fen());
      const m = c.move(san); // throws on an illegal line -> caught by the check script
      const list = book.get(key) ?? [];
      if (!list.includes(m.san)) list.push(m.san);
      book.set(key, list);
    }
  }
  return book;
}

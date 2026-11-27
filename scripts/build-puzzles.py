"""Builds public/puzzles-v3.json from the Lichess puzzle database (CC0, https://database.lichess.org/#puzzles).

usage: python scripts/build-puzzles.py path/to/lichess_db_puzzle.csv.zst public/puzzles-v3.json
needs: pip install zstandard

Keeps well-tested, popular puzzles spread evenly over the rating range, plus extra puzzles from games
in the app's repertoire openings. Output rows: [id, fen, "uci uci ...", rating, "theme theme", "openingId openingId"].
"""
import csv, io, json, sys
import zstandard

SRC, OUT = sys.argv[1], sys.argv[2]

LOW, HIGH, STEP = 500, 2500, 100
PER_BUCKET = 150
MAX_MATES_PER_BUCKET = 45  # enough for the "mates" mode without crowding out other tactics
PER_OPENING = 100
OLD_OPENINGS = {'london', 'italian', 'caro', 'slav', 'sicilian', 'qga'}  # had 150 each before; keep them
# Lichess opening tag (family or variation) -> the repertoires whose games reach it. A puzzle can belong to several
# (the Italian Game is in the White 1.e4 repertoire and in Black's 1...e5).
OPENINGS = {
    'London_System': 'london', 'Queens_Pawn_Game_London_System': 'london', 'Queens_Pawn_Game_Accelerated_London_System': 'london',
    'Indian_Defense_London_System': 'london',
    'Italian_Game': 'italian e5', 'Bishops_Opening': 'italian e5', 'Ruy_Lopez': 'ruy e5', 'Scotch_Game': 'scotch e5',
    'Kings_Gambit': 'kingsgambit e5', 'Kings_Gambit_Accepted': 'kingsgambit e5', 'Kings_Gambit_Declined': 'kingsgambit e5',
    'Vienna_Game': 'vienna e5', 'Vienna_Gambit_with_Max_Lange_Defense': 'vienna e5',
    'Four_Knights_Game': 'e5', 'Ponziani_Opening': 'e5', 'Center_Game': 'e5',
    'Russian_Game': 'petrov ruy scotch', 'Petrovs_Defense': 'petrov ruy scotch',
    'Philidor_Defense': 'ruy scotch', 'Latvian_Gambit': 'ruy scotch', 'Latvian_Gambit_Accepted': 'ruy scotch',
    'Sicilian_Defense': 'sicilian opensic', 'Scandinavian_Defense': 'scandinavian', 'French_Defense': 'french',
    'Caro-Kann_Defense': 'caro', 'Alekhine_Defense': 'alekhine', 'Pirc_Defense': 'pirc', 'Modern_Defense': 'modern',
    'English_Opening': 'english flank', 'Zukertort_Opening': 'flank', 'Reti_Opening': 'flank',
    'Queens_Pawn_Game_Colle_System': 'colle', 'Colle_System': 'colle', 'Trompowsky_Attack': 'trompowsky',
    'Queens_Gambit_Declined': 'qgd qg', 'Tarrasch_Defense': 'qg', 'Catalan_Opening': 'catalan qgd',
    'Slav_Defense': 'slav qg', 'Semi-Slav_Defense': 'slav qg', 'Queens_Gambit_Accepted': 'qga qg',
    'Kings_Indian_Defense': 'kid', 'Nimzo-Indian_Defense': 'nimzo', 'Queens_Indian_Defense': 'nimzo',
    'Grunfeld_Defense': 'grunfeld', 'Benko_Gambit': 'benko', 'Benko_Gambit_Accepted': 'benko',
    'Benko_Gambit_Declined': 'benko', 'Benoni_Defense': 'benko', 'Dutch_Defense': 'dutch',
}
REPS = sorted({x for v in OPENINGS.values() for x in v.split()} | {'najdorf'})
QUOTA = {o: 150 if o in OLD_OPENINGS else PER_OPENING for o in REPS}


def reps_of(tags):
    out = []
    for t in tags:
        for x in OPENINGS.get(t, '').split():
            if x not in out:
                out.append(x)
    if 'Sicilian_Defense_Najdorf_Variation' in tags:  # a Najdorf is not the ...e6 Sicilian
        out = [x for x in out if x != 'sicilian'] + ['najdorf']
    return out


# only themes the app names (src/puzzles.ts); the rest would just be bytes
THEMES = {
    'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'hangingPiece', 'sacrifice', 'deflection',
    'attraction', 'backRankMate', 'mateIn1', 'mateIn2', 'mateIn3', 'mate', 'promotion', 'trappedPiece',
    'kingsideAttack', 'endgame', 'clearance', 'interference', 'quietMove', 'defensiveMove', 'smotheredMate',
    'zugzwang', 'exposedKing', 'capturingDefender', 'xRayAttack', 'intermezzo', 'advancedPawn',
}


def good(r):
    try:
        rating, dev, pop, plays = int(r['Rating']), int(r['RatingDeviation']), int(r['Popularity']), int(r['NbPlays'])
    except ValueError:
        return False
    user_moves = len(r['Moves'].split()) // 2
    return LOW <= rating < HIGH and dev <= 90 and pop >= 85 and plays >= 500 and 1 <= user_moves <= 6


def row(r):
    themes = r['Themes'].split()
    opening = ' '.join(reps_of(r['OpeningTags'].split()))
    return [r['PuzzleId'], r['FEN'], r['Moves'], int(r['Rating']), ' '.join(t for t in themes if t in THEMES), opening]


buckets = {b: [] for b in range(LOW, HIGH, STEP)}
mates = {b: 0 for b in buckets}
by_opening = {o: 0 for o in REPS}
from_openings = []
seen = 0
with open(SRC, 'rb') as f:
    reader = csv.DictReader(io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding='utf-8'))
    for r in reader:
        seen += 1
        if not good(r):
            continue
        out = row(r)
        mine = out[5].split()
        if any(by_opening[o] < QUOTA[o] for o in mine) and 700 <= out[3] <= 2100:
            from_openings.append(out)
            for o in mine:
                by_opening[o] += 1
            continue
        b = LOW + (out[3] - LOW) // STEP * STEP
        is_mate = 'mate' in r['Themes'].split()
        if len(buckets[b]) >= PER_BUCKET or (is_mate and mates[b] >= MAX_MATES_PER_BUCKET):
            if all(len(v) >= PER_BUCKET for v in buckets.values()) and all(by_opening[o] >= QUOTA[o] for o in REPS):
                break
            continue
        buckets[b].append(out)
        mates[b] += is_mate

rows = [p for b in buckets.values() for p in b] + from_openings
rows.sort(key=lambda p: p[3])
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(rows, f, separators=(',', ':'))
print(f'read {seen} puzzles, kept {len(rows)}')
print('per bucket:', {b: len(v) for b, v in buckets.items()})
print('per opening:', by_opening)

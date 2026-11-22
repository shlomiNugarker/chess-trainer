"""Builds public/puzzles-v2.json from the Lichess puzzle database (CC0, https://database.lichess.org/#puzzles).

usage: python scripts/build-puzzles.py path/to/lichess_db_puzzle.csv.zst public/puzzles-v2.json
needs: pip install zstandard

Keeps well-tested, popular puzzles spread evenly over the rating range, plus extra puzzles from games
in the app's repertoire openings. Output rows: [id, fen, "uci uci ...", rating, "theme theme", "openingId"].
"""
import csv, io, json, sys
import zstandard

SRC, OUT = sys.argv[1], sys.argv[2]

LOW, HIGH, STEP = 500, 2500, 100
PER_BUCKET = 150
MAX_MATES_PER_BUCKET = 45  # enough for the "mates" mode without crowding out other tactics
PER_OPENING = 150
OPENINGS = {'London_System': 'london', 'Italian_Game': 'italian', 'Caro-Kann_Defense': 'caro', 'Slav_Defense': 'slav', 'Sicilian_Defense': 'sicilian'}
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
    opening = next((OPENINGS[t] for t in r['OpeningTags'].split() if t in OPENINGS), '')
    return [r['PuzzleId'], r['FEN'], r['Moves'], int(r['Rating']), ' '.join(t for t in themes if t in THEMES), opening]


buckets = {b: [] for b in range(LOW, HIGH, STEP)}
mates = {b: 0 for b in buckets}
by_opening = {o: [] for o in OPENINGS.values()}
seen = 0
with open(SRC, 'rb') as f:
    reader = csv.DictReader(io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding='utf-8'))
    for r in reader:
        seen += 1
        if not good(r):
            continue
        out = row(r)
        if out[5] and len(by_opening[out[5]]) < PER_OPENING and 700 <= out[3] <= 2100:
            by_opening[out[5]].append(out)
            continue
        b = LOW + (out[3] - LOW) // STEP * STEP
        is_mate = 'mate' in r['Themes'].split()
        if len(buckets[b]) >= PER_BUCKET or (is_mate and mates[b] >= MAX_MATES_PER_BUCKET):
            if all(len(v) >= PER_BUCKET for v in buckets.values()) and all(len(v) >= PER_OPENING for v in by_opening.values()):
                break
            continue
        buckets[b].append(out)
        mates[b] += is_mate

rows = [p for b in buckets.values() for p in b] + [p for o in by_opening.values() for p in o]
rows.sort(key=lambda p: p[3])
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(rows, f, separators=(',', ':'))
print(f'read {seen} puzzles, kept {len(rows)}')
print('per bucket:', {b: len(v) for b, v in buckets.items()})
print('per opening:', {o: len(v) for o, v in by_opening.items()})

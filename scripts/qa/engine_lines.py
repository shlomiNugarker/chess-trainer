"""QA of the content: every move the user plays in every line, against the app's own Stockfish (in the browser).
A move fails when it loses more than --limit of the winning chances to the engine's choice, and a line fails when it
ends more than --end pawns against the user — unless scripts/qa/engine-known.json lists it as checked and kept.
Results are cached in out/engine-cache.json by position, move and depth, so after a change only new positions are searched.
    python scripts/qa/engine_lines.py [--url URL] [--only london,qga] [--depth 16] [--limit 5] [--end 0.7] [--fresh]
The whole repertoire at depth 16 takes about 30 minutes the first time. A finding at depth 16 is worth a second look at
a deeper depth before changing a line: the engine sometimes prefers another move only until it sees further."""
import json, math, subprocess, time
from playwright.sync_api import sync_playwright
from common import OUT, ROOT, Report, args


def extra(p):
    p.add_argument('--depth', type=int, default=16, help='search depth (default 16)')
    p.add_argument('--limit', type=float, default=5.0, help='the most winning chance (in %%) a move may lose (default 5)')
    p.add_argument('--end', type=float, default=0.7, help='how many pawns a line may end against the user (default 0.7)')
    p.add_argument('--fresh', action='store_true', help='ignore the cache')


a = args('Every move of every line against Stockfish.', extra)
r = Report('engine_lines')
KNOWN = json.loads((ROOT / 'scripts/qa/engine-known.json').read_text(encoding='utf-8'))
CACHE_FILE = OUT / 'engine-cache.json'
cache = {} if a.fresh or not CACHE_FILE.exists() else json.loads(CACHE_FILE.read_text(encoding='utf-8'))
raw = subprocess.run(['node', '--experimental-strip-types', str(ROOT / 'scripts/qa/dump-positions.ts')],
                     cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout
lines = [l for l in json.loads(raw) if not a.only or l['rep'] in a.only]

# one engine for the whole run; 'searchmoves' searches the book move alone
JS = r"""async ([fen, depth, only]) => {
  if (!window.qaEngine) {
    window.qaEngine = new Worker('/engine/stockfish-19-lite-single.js');
    window.qaAsk = (cmd, done) => new Promise((res) => {
      const out = [];
      window.qaEngine.onmessage = (e) => { const l = String(e.data); out.push(l); if (done(l)) res(out); };
      window.qaEngine.postMessage(cmd);
    });
    await window.qaAsk('uci', (l) => l === 'uciok');
  }
  await window.qaAsk('isready', (l) => l === 'readyok');
  window.qaEngine.postMessage('position fen ' + fen);
  const out = await window.qaAsk('go depth ' + depth + (only ? ' searchmoves ' + only : ''), (l) => l.startsWith('bestmove'));
  const info = out.filter((l) => l.startsWith('info') && l.includes(' score ')).pop() || '';
  const m = info.match(/score (cp|mate) (-?\d+)/);
  const cp = !m ? 0 : m[1] === 'cp' ? +m[2] : +m[2] > 0 ? 10000 : -10000;
  return { cp, best: out[out.length - 1].split(' ')[1] };
}"""


def win(cp):  # winning chance in % for the side to move (the formula of Lichess, as in src/engine.ts)
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    r.watch(pg, 'engine')
    pg.goto(a.url)
    pg.wait_for_selector('.tabs', timeout=60000)

    def search(fen, only=''):
        key = f'{a.depth}|{fen}|{only}'
        if key not in cache: cache[key] = pg.evaluate(JS, [fen, a.depth, only])
        return cache[key]

    t0, last = time.time(), None
    try:
        for n, l in enumerate(lines):
            name = f"{l['rep']}/{l['line']}"
            if l['rep'] != last:
                r.note(f"# {l['rep']} (line {n + 1} of {len(lines)}, {time.time() - t0:.0f}s)")
                last = l['rep']
            worst = (0.0, '')
            for m in l['moves'][2:]:  # the first two moves of a line are the opening itself
                top = search(m['fen'])
                if top['best'] == m['uci']: continue
                got = search(m['fen'], m['uci'])
                loss = win(top['cp']) - win(got['cp'])
                if loss > a.limit and f"{name} {m['san']}" in KNOWN['moves']: continue
                if loss > worst[0]:
                    worst = (loss, f"{m['san']} {got['cp'] / 100:+.2f}, the engine's {top['best']} {top['cp'] / 100:+.2f} (for the side to move)")
            r.check(worst[0] <= a.limit, f'{name}: no move loses more than {a.limit:g}%', f'{worst[0]:.1f}% {worst[1]}' if worst[0] > a.limit else '')
            end = search(l['end'])
            for_user = end['cp'] if l['end'].split()[1] == l['user'] else -end['cp']
            r.check(for_user >= -a.end * 100 or name in KNOWN['ends'], f'{name}: ends at most {a.end:g} against the user', f'{for_user / 100:+.2f}')
            if n % 20 == 19: CACHE_FILE.write_text(json.dumps(cache), encoding='utf-8')
    finally:
        CACHE_FILE.write_text(json.dumps(cache), encoding='utf-8')
        b.close()
r.done()

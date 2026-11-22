"""QA: the Play screen (English, desktop) — opening training in every repertoire (the book, then the coach),
leaving the line, and a regular game (hint, take back, new game).

    python scripts/qa/play.py [--url URL] [--only sicilian,qga]
"""
import time
from playwright.sync_api import sync_playwright
from common import Report, args, lines, wait_until

a = args('Play screen QA')
r = Report('play')
data = lines()
START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

PLACEMENT_JS = """() => {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = '', empty = 0;
    for (const f of 'abcdefgh') {
      const p = document.querySelector(`.trainer [data-square="${f}${r}"] [data-piece]`)?.getAttribute('data-piece');
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p[0] === 'w' ? p[1].toUpperCase() : p[1].toLowerCase();
    }
    rows.push(row + (empty || ''));
  }
  return rows.join('/');
}"""
OWN_JS = """(c) => [...document.querySelectorAll('.trainer [data-square] [data-piece]')]
  .filter(e => e.getAttribute('data-piece')[0] === c).map(e => e.closest('[data-square]').getAttribute('data-square'))"""
TARGETS_JS = """() => [...document.querySelectorAll('.trainer [data-square]')]
  .filter(e => e.outerHTML.includes('radial-gradient')).map(e => e.getAttribute('data-square'))"""


def status(pg): return pg.locator('.trainer .status-text').inner_text().strip()
def placement(pg): return pg.evaluate(PLACEMENT_JS)
def feedback(pg): return pg.locator('.trainer .card.feedback').count() > 0


def settle(pg, after_user, timeout=40):
    """Wait until the app is done with the user's move: the opponent replied, or it stopped / the game ended."""
    t = time.time()
    while time.time() - t < timeout:
        s = status(pg)
        if 'Stopped' in s or 'Game over' in s: return s
        if 'Your move' in s and placement(pg) != after_user: return s
        time.sleep(0.25)
    return 'TIMEOUT(' + status(pg) + ')'


def move(pg, u):
    before = placement(pg)
    pg.click(f'.trainer [data-square="{u[:2]}"]'); pg.click(f'.trainer [data-square="{u[2:4]}"]')
    wait_until(lambda: placement(pg) != before, 5, 0.1)
    after = placement(pg)
    return 'NOT PLAYED' if after == before else settle(pg, after)


def any_legal(pg, color):
    """Plays the first legal move found (using the tap-to-move target dots)."""
    for sq in pg.evaluate(OWN_JS, color):
        pg.click(f'.trainer [data-square="{sq}"]')
        t = pg.evaluate(TARGETS_JS)
        pg.click(f'.trainer [data-square="{sq}"]')  # deselect
        if t: return sq + t[0], move(pg, sq + t[0])
    return None, 'no legal move'


def first_turn(pg, color):
    """After a new game: the user's first turn (as Black, once the engine has moved)."""
    return wait_until(lambda: 'Your move' in status(pg) and (placement(pg) == START) == (color == 'w'), 40)


def settings(pg, mode=None, rep=None, color=None):
    if pg.locator('.settings-toggle').is_visible(): pg.click('.settings-toggle')  # phone: a bottom sheet
    sels = pg.locator('.controls select')
    if mode: sels.nth(0).select_option(mode)
    if rep: sels.nth(1).select_option(rep)
    if color: sels.nth(1).select_option(color)
    if pg.locator('.sheet-done').is_visible(): pg.click('.sheet-done')


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(locale='en-US', viewport={'width': 1280, 'height': 900})
    r.watch(pg, 'play')
    pg.goto(a.url)
    pg.wait_for_selector('.tabs', timeout=60000)
    pg.click('.tabs .tab:has-text("Play")')
    pg.wait_for_selector('.trainer .status-text')

    for rep in data:
        if a.only and rep['id'] not in a.only: continue
        c, rid = rep['color'], rep['id']
        try:
            settings(pg, mode='train', rep=rid)
            if not r.check(first_turn(pg, c), f'{rid}: first turn'): continue
            plies, s = 0, 'Your move'
            while plies < 40 and 'Your move' in s and not feedback(pg):
                u = rep['book'].get(placement(pg))
                if not u: break
                s = move(pg, u); plies += 1
            r.check('Your move' in s and not feedback(pg) and plies >= 4, f'{rid}: book moves accepted', f'({plies} moves, status {s})')
            # after the book: some legal move; the coach must answer (go on, warn, or stop to correct)
            mv, s = any_legal(pg, c)
            r.check(any(x in s for x in ['Your move', 'Stopped', 'Game over']), f'{rid}: coach answered {mv}', f'-> {s}')
            for label in ['Go back and play', 'Try again']:
                btn = pg.locator(f'.trainer button:has-text("{label}")')
                if btn.count():
                    btn.first.click(); time.sleep(0.8)
                    r.check('Your move' in status(pg) and not feedback(pg), f'{rid}: "{label}" restores the position')
                    break
        except Exception as e:
            r.check(False, f'{rid}: training', str(e).splitlines()[0][:200]); r.shot(pg, f'play-{rid}')

    if not a.only or 'sicilian' in a.only:
        try:  # leaving the line on purpose: 1.e4 a6 in the Sicilian
            settings(pg, mode='train', rep='sicilian'); first_turn(pg, 'b')
            s = move(pg, 'a7a6')
            txt = pg.locator('.trainer .card.feedback').inner_text() if feedback(pg) else ''
            r.check('You left the line' in txt and 'c5' in txt, 'leaving the line is caught', f'({s})')
            pg.click('.trainer button:has-text("Try again")'); time.sleep(0.8)
            r.check('Your move' in status(pg) and not feedback(pg), '"Try again" takes the move back')
            move(pg, 'a7a6')
            pg.click('.trainer button:has-text("Continue anyway")')
            after_a6 = 'rnbqkbnr/1ppppppp/p7/8/4P3/8/PPPP1PPP/RNBQKBNR'
            r.check(wait_until(lambda: 'Your move' in status(pg) and placement(pg).startswith('rnbqkbnr/1ppppppp/p7')
                               and placement(pg) != after_a6, 40),
                    '"Continue anyway" keeps the move and the engine replies')
        except Exception as e:
            r.check(False, 'leaving the line', str(e).splitlines()[0][:200]); r.shot(pg, 'play-deviation')

    if not a.only or 'regular' in a.only:
        try:
            settings(pg, mode='play', color='w')
            r.check(first_turn(pg, 'w'), 'regular game as White starts')
            for _ in range(4):
                mv, s = any_legal(pg, 'w')
                r.check(any(x in s for x in ['Your move', 'Game over']), f'regular: engine answers {mv}', f'-> {s}')
            pg.click('.trainer button:has-text("Hint")'); time.sleep(2)
            r.check(pg.locator('.trainer svg line, .trainer svg path').count() > 0, 'hint draws an arrow')
            before = placement(pg)
            pg.click('.trainer button:has-text("Take back")'); time.sleep(0.8)
            r.check(placement(pg) != before and 'Your move' in status(pg), 'take back')
            pg.click('.trainer button:has-text("New game")')
            r.check(first_turn(pg, 'w'), 'new game')
            settings(pg, mode='play', color='b')
            r.check(first_turn(pg, 'b'), 'regular game as Black: the engine opens')
        except Exception as e:
            r.check(False, 'regular game', str(e).splitlines()[0][:200]); r.shot(pg, 'play-regular')
    b.close()
r.done()

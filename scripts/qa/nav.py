"""QA: the Back button, a game that survives a reload, and what counts for the daily goal (English, phone, ~2 min).

    python scripts/qa/nav.py [--url URL] [--only back,reload,goal]
"""
import json, time
from playwright.sync_api import sync_playwright
from common import Report, args

a = args('Back button and reload QA', lambda p: p.add_argument('--chesscom', default='shlomin1231', help='Chess.com username for the review'))
r = Report('nav')


def wait(ms): pg.wait_for_timeout(ms)
def cur(): return pg.evaluate("document.querySelector('.tabs [aria-selected=true] .tab-label').innerText")
def tab(i): pg.locator('.tabs [role=tab]').nth(i).click(); wait(250)
def back(): pg.go_back(); wait(500)
def moves(): return [x for x in pg.locator('.trainer .moves .move').all_inner_texts() if x]
def turn(): pg.wait_for_function("document.querySelector('.trainer .status-text').innerText === 'Your move'", timeout=20000); wait(600)
def reload(): pg.reload(); pg.wait_for_selector('.trainer')


def mine(u):
    pg.click(f'.trainer [data-square="{u[:2]}"]'); pg.click(f'.trainer [data-square="{u[2:]}"]')
    pg.wait_for_function("document.querySelector('.trainer .status-text').innerText !== 'Your move'", timeout=5000)


def settings(*pairs):
    pg.click('.settings-toggle'); wait(200)
    for i, v in pairs: pg.locator('.trainer .controls select').nth(i).select_option(v); wait(300)
    pg.click('.sheet-done'); wait(1200)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(locale='en-US', viewport={'width': 390, 'height': 844})
    pg = ctx.new_page()
    r.watch(pg, 'nav')
    pg.goto('about:blank'); pg.goto(a.url); pg.wait_for_selector('.tabs')

    if not a.only or 'back' in a.only:
        size = pg.evaluate('history.length')
        tab(0); tab(3); back()
        r.check(cur() == 'Play', 'Back goes to the tab before', cur())
        back()
        r.check(cur() == 'Learn', 'and to the first one', cur())
        for _ in range(6): tab(0); tab(1)
        wait(400)
        grown = pg.evaluate('history.length') - size
        r.check(grown <= 3 and cur() == 'Learn', 'going back and forth between two tabs does not grow the history', f'+{grown}')
        pg.evaluate("() => { const t = document.querySelectorAll('.tabs [role=tab]'); [0, 1, 3, 2, 0].forEach((i) => t[i].click()); }")
        wait(800)
        r.check(cur() == 'Play', 'five taps at once end on the last', cur())
        pg.click('.settings-toggle'); wait(300); back()
        r.check(pg.locator('.controls.open').count() == 0 and cur() == 'Play', 'Back closes the settings sheet')
        pg.click('.settings-toggle'); wait(250); pg.click('.sheet-done'); wait(400); back()
        r.check(cur() != 'Play' and pg.locator('.controls.open').count() == 0, 'a sheet closed by its button does not come back', cur())
        tab(2); pg.fill('.review input', a.chesscom); pg.locator('.review button.primary').first.click()
        pg.wait_for_selector('.recent-game', timeout=180000)
        pg.locator('.recent-game').first.click(); pg.wait_for_selector('.game-review'); wait(300); back()
        r.check(pg.locator('.recent-game').count() > 0 and cur() == 'My review', 'Back leaves a game review to the list')
        pg.go_forward(); wait(600)
        r.check(pg.locator('.game-review').count() == 1, 'Forward opens it again')
        tab(1); back()
        r.check(cur() == 'My review' and pg.locator('.game-review').count() == 1, 'from another tab, Back returns to the game review')
        pg.locator('.game-review-head button').click(); wait(500)
        r.check(pg.locator('.recent-game').count() > 0, 'the review has its own way back')
        pg.locator('.recent-game').nth(1).click(); pg.wait_for_selector('.game-review')
        pg.reload(); pg.wait_for_selector('.tabs'); wait(800)
        r.check(cur() == 'My review' and pg.locator('.game-review').count() == 0, 'reload in a review: the tab stays', cur())
        back()
        r.check(pg.locator('.tabs').count() == 1, 'Back after a reload stays in the app', cur())

    if not a.only or 'reload' in a.only:
        tab(0); wait(1500)
        for color, u1, u2 in (('w', 'e2e4', 'd2d3'), ('b', 'e7e6', 'a7a6')):
            settings((0, 'play'), (1, color)); pg.click('.trainer button:has-text("New game")'); wait(800)
            turn(); mine(u1); turn(); mine(u2); turn()
            before = moves(); reload(); turn()
            corner = pg.evaluate("document.querySelector('.trainer [data-square]').dataset.square")
            r.check(moves() == before and pg.locator('.trainer .controls select').first.input_value() == 'play' and corner == ('a8' if color == 'w' else 'h1'),
                    f'regular game as {color}: goes on after a reload', f'{before} -> {moves()}')
            r.check(pg.locator('.trainer .notice').count() == 1, 'and says so')
            pg.click('.trainer button:has-text("Take back")'); wait(800)
            r.check(len(moves()) == len(before) - 2, 'take back works in it', str(moves()))
            mine(u2); wait(80); reload(); turn()
            r.check(len(moves()) == len(before), "reload during the computer's turn: it answers", str(moves()))
        settings((0, 'train')); settings((1, 'italian')); turn(); mine('e2e4'); turn()
        before, pill = moves(), pg.inner_text('.trainer .status .pill')
        mine('a2a3')
        pg.wait_for_function("document.querySelector('.trainer .status-text').innerText === 'Stopped to correct'", timeout=20000)
        reload(); turn()
        r.check(moves() == before and pg.inner_text('.trainer .status .pill') == pill, 'training: a reload at a correction goes back to before the wrong move, still in the line', f'{moves()} {pill}')
        pg.click('.trainer button:has-text("New game")'); turn(); reload(); turn()
        r.check(moves() == [], 'a new game is not undone by a reload', str(moves()))
        now = pg.evaluate('Date.now()')
        for label, game in (('broken', {'moves': ['e4', 'zz'], 'at': now}), ('day-old', {'moves': ['e4', 'e5'], 'at': now - 90_000_000}), ('finished', {'moves': ['f3', 'e5', 'g4', 'Qh4#'], 'at': now})):
            pg.evaluate('g => localStorage.setItem("chess-trainer:game", g)', json.dumps({'mode': 'play', 'repertoire': 'italian', 'color': 'w', 'phase': 'free', **game}))
            reload(); turn()
            r.check(moves() == [] and pg.locator('.trainer .controls select').first.input_value() == 'train', f'a {label} saved game starts a new one', str(moves()))

    if not a.only or 'goal' in a.only:
        tab(3); pg.wait_for_selector('.daily-pill'); wait(2500)
        goal = lambda: pg.inner_text('.daily-pill')
        before = goal()
        pg.click('button:has-text("Show solution")'); pg.wait_for_selector('button:has-text("Next puzzle")'); wait(2500)
        r.check(goal() == before, 'a shown solution does not count for the daily goal', f'{before} -> {goal()}')
    b.close()
r.done()

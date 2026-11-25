"""QA: the Back button, a game that survives a reload, the daily goal, the keyboard in dialogs, and the engine
when it is slow or cannot load (English, ~3 min).

    python scripts/qa/nav.py [--url URL] [--only back,reload,ends,computer,goal,keys,engine]
"""
import json, subprocess, time
from playwright.sync_api import sync_playwright
from common import ROOT, Report, args

a = args('Back button and reload QA', lambda p: (p.add_argument('--chesscom', default='shlomin1231', help='Chess.com username for the review'),
                                                     p.add_argument('--channel', default='', help="'chrome': the installed Chrome instead of Playwright's Chromium")))
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
    b = p.chromium.launch(channel=a.channel or None)
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
            for _ in range(20):
                if len(moves()) == len(before): break
                wait(250)
            turn()
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

    if not a.only or 'ends' in a.only:
        # a game that stands one move before its end (put in the place of a saved game), and the move is played
        raw = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(ROOT / 'scripts/qa/dump-ends.ts')], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout
        why = {'stalemate': 'stalemate', 'threefold repetition': 'three times', 'the 50-move rule': '50 moves', 'not enough material': 'not enough'}
        cases = json.loads(raw)
        r.check(len(cases) == 7, 'seven games to finish', str(list(cases)))
        tab(0); wait(500)
        for name, c in cases.items():
            # as if the app was closed in this game
            pg.evaluate('g => { localStorage.setItem("chess-trainer:screen", JSON.stringify("play")); localStorage.setItem("chess-trainer:game", g); }',
                        json.dumps({'mode': 'play', 'repertoire': 'italian', 'color': c['color'], 'phase': 'free', 'moves': c['moves'].split(), 'at': pg.evaluate('Date.now()')}))
            reload(); turn()
            n = len(moves())
            pg.click(f'.trainer [data-square="{c["play"][0]}"]'); wait(250); pg.click(f'.trainer [data-square="{c["play"][1]}"]'); wait(700)
            r.check(len(moves()) > n and moves()[n] == c['san'], f'{name}: {c["san"]} is played', str(moves()[n:]))
            if name in why:
                wait(1200)
                notice = ' '.join(pg.locator('.trainer .notice').all_inner_texts())
                bar = pg.evaluate("[...document.querySelectorAll('.trainer .evalbar-label')].map(e => e.innerText.match(/\\d+/)?.[0])")
                r.check(pg.inner_text('.trainer .status-text') == 'Game over' and why[name] in notice, f'{name}: the game is over, and why', notice)
                r.check(bar == ['50', '50'], f'{name}: the win-chance bar is even', str(bar))
                r.check(pg.evaluate("localStorage.getItem('chess-trainer:game')") == 'null', f'{name}: a finished game is not continued later')
                pg.click('.trainer button:has-text("Take back")'); wait(900)
                r.check(len(moves()) == n and pg.inner_text('.trainer .status-text') == 'Your move' and not pg.locator('.trainer .notice').count(), f'{name}: take back goes on from before it')
            else:
                turn()
                r.check(len(moves()) == n + 2, f'{name}: the computer answers', str(moves()[n:]))
                pg.click('.trainer button:has-text("Take back")'); wait(900)
                piece = pg.evaluate("s => document.querySelector(`.trainer [data-square=${s}] [data-piece]`)?.dataset.piece", c['play'][0])
                r.check(len(moves()) == n and piece == c['color'] + 'P', f'{name}: take back gives the pawn back', str(piece))
        pg.evaluate('g => localStorage.setItem("chess-trainer:game", g)', json.dumps({'mode': 'play', 'repertoire': 'italian', 'color': 'w', 'phase': 'free', 'moves': 'e4 e5 Qh5 Nc6 Bc4 Nf6'.split(), 'at': pg.evaluate('Date.now()')}))
        reload(); turn(); pg.click('.trainer [data-square="h5"]'); wait(250); pg.click('.trainer [data-square="f7"]'); wait(1800)
        bar = pg.evaluate("[...document.querySelectorAll('.trainer .evalbar-label')].map(e => e.innerText.match(/\\d+/)?.[0])")
        r.check('You won' in ' '.join(pg.locator('.trainer .notice').all_inner_texts()) and bar == ['0', '100'], 'checkmate by the user: won, and the bar is full', f"{pg.locator('.trainer .notice').all_inner_texts()} {bar}")
        pg.evaluate("localStorage.removeItem('chess-trainer:game')"); reload(); turn()

    if not a.only or 'computer' in a.only:
        # the computer makes the last move: in computer-ends.json it is the computer's turn, and every legal move of it
        # ends the game that way (found by random play); for the stalemate, which is too rare, its answer is given
        cases = json.loads((ROOT / 'scripts/qa/computer-ends.json').read_text(encoding='utf-8'))
        for name, c in cases.items():
            c6 = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900}, service_workers='block'); pg = c6.new_page(); r.watch(pg, 'computer')
            if 'engine' in c:
                pg.add_init_script("{ const post = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, ...x) { if (m === 'go movetime 400') setTimeout(() => this.onmessage({ data: 'bestmove %s' }), 100); else post.call(this, m, ...x); }; }" % c['engine'])
            pg.goto(a.url); pg.wait_for_selector('.tabs')
            n = len(c['moves'].split())
            pg.evaluate('g => { localStorage.setItem("chess-trainer:screen", JSON.stringify("play")); localStorage.setItem("chess-trainer:skill", "20"); localStorage.setItem("chess-trainer:game", g); }',
                        json.dumps({'mode': 'play', 'repertoire': 'italian', 'color': c['color'], 'phase': 'free', 'moves': c['moves'].split(), 'at': pg.evaluate('Date.now()')}))
            reload()
            for _ in range(80):
                if len(moves()) > n: break
                wait(250)
            wait(1500)
            last = moves()[n] if len(moves()) > n else ''
            state, notice = pg.inner_text('.trainer .status-text'), ' '.join(pg.locator('.trainer .notice').all_inner_texts())
            if 'promotion' in name:
                q = last[last.find('=') - 2:last.find('=')] if '=' in last else ''
                piece = pg.evaluate("s => s && document.querySelector(`.trainer [data-square=${s}] [data-piece]`)?.dataset.piece", q)
                r.check(q and piece == ('b' if c['color'] == 'w' else 'w') + last[last.find('=') + 1] and state == 'Your move', f'the computer, {name}: {last}', f'{piece} {state}')
                own = [x for x in pg.evaluate("c => [...document.querySelectorAll('.trainer [data-square] [data-piece]')].filter(e => e.dataset.piece[0] === c).map(e => e.closest('[data-square]').dataset.square)", c['color'])]
                for sq in own:
                    pg.click(f'.trainer [data-square="{sq}"]'); dots = pg.evaluate("[...document.querySelectorAll('.trainer [data-square]')].filter(e => e.outerHTML.includes('radial-gradient')).map(e => e.dataset.square)")
                    if dots: pg.click(f'.trainer [data-square="{dots[0]}"]'); break
                    pg.click(f'.trainer [data-square="{sq}"]')
                wait(700); turn()
                r.check(len(moves()) >= n + 3, f'the computer, {name}: the game goes on', str(moves()[n:]))
            else:
                bar = pg.evaluate("[...document.querySelectorAll('.trainer .evalbar-label')].map(e => e.innerText.match(/\\d+/)?.[0])")
                view = pg.evaluate("(() => { const l = document.querySelector('.trainer .moves'), x = l.querySelector('.move.last').getBoundingClientRect(), y = l.getBoundingClientRect(); return x.top >= y.top - 1 && x.bottom <= y.bottom + 1; })()")
                why = {'stalemate': 'stalemate', 'threefold repetition': 'three times', 'the 50-move rule': '50 moves', 'not enough material': 'not enough', 'checkmate': 'You lost'}[name]
                r.check(state == 'Game over' and why in notice and bar == (['100', '0'] if name == 'checkmate' else ['50', '50']) and view, f'the computer, {name}: {last} ends the game', f'{state} | {notice} | {bar} | last move in view {view}')
                pg.click('.trainer button:has-text("Take back")'); wait(1000)
                r.check(pg.inner_text('.trainer .status-text') == 'Your move' and len(moves()) == n - 1 and not pg.locator('.trainer .notice').count(), f'the computer, {name}: take back goes on from your move', f"{pg.inner_text('.trainer .status-text')} {len(moves())} of {n}")
            c6.close()
        pg = ctx.pages[0]

    if not a.only or 'goal' in a.only:
        tab(3); pg.wait_for_selector('.daily-pill'); wait(2500)
        goal = lambda: pg.inner_text('.daily-pill')
        before = goal()
        pg.click('button:has-text("Show solution")'); pg.wait_for_selector('button:has-text("Next puzzle")'); wait(2500)
        r.check(goal() == before, 'a shown solution does not count for the daily goal', f'{before} -> {goal()}')
    if not a.only or 'keys' in a.only:
        # keyboard in the settings sheet and the account panel
        inside = lambda sel: pg.evaluate('s => document.querySelector(s).contains(document.activeElement)', sel)
        dialogs = [('settings sheet', 0, '.settings-toggle', '.controls')]
        if pg.locator('.account-tab').count(): dialogs.append(('account panel', 1, '.account-tab', '.account-panel'))
        for name, i, opener, sel in dialogs:
            tab(i); wait(500); pg.focus(opener); pg.keyboard.press('Enter'); wait(400)
            r.check(inside(sel) and pg.locator(f'{sel}[role=dialog][aria-modal=true]').count() == 1, f'{name}: the focus moves into it')
            stays = True
            for k in ['Tab'] * 14 + ['Shift+Tab'] * 16:
                pg.keyboard.press(k); stays = stays and inside(sel)
            r.check(stays, f'{name}: Tab stays inside')
            if i == 1:
                at = pg.inner_text('.learn-move-head'); pg.keyboard.press('ArrowRight'); wait(200)
                r.check(pg.inner_text('.learn-move-head') == at, f'{name}: arrow keys do not step the line behind it')
            pg.keyboard.press('Escape'); wait(500)
            r.check(not pg.locator('[aria-modal=true]').count() and pg.evaluate('s => document.activeElement === document.querySelector(s)', opener), f'{name}: Escape closes it and the focus is back')
        tab(1); pg.keyboard.press('ArrowRight'); wait(300)
        r.check('1.' in pg.inner_text('.learn-move-head'), 'arrow keys step the line when nothing is open', pg.inner_text('.learn-move-head')[:20])
        roles = pg.evaluate("[...document.querySelectorAll('[role=tablist]')].map(l => [...l.children].every(c => c.getAttribute('role') === 'tab'))")
        r.check(all(roles) and pg.locator('.learn-header .chip[aria-pressed=true]').count() == 1, 'every tab list holds only tabs; the chosen chip says so', str(roles))

    if not a.only or 'engine' in a.only:
        # searches that are not needed any more do not hold up the next one (a coach that takes 4 seconds)
        c2 = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900}); pg = c2.new_page(); r.watch(pg, 'engine')
        pg.add_init_script("{ const post = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, ...x) { return post.call(this, m === 'go movetime 700' ? 'go movetime 4000' : m, ...x); }; }")
        pg.goto(a.url); pg.wait_for_selector('.tabs'); tab(0); wait(1500)
        pg.locator('.trainer .controls select').first.select_option('play'); wait(800); turn()
        for u in ('e2e4', 'd2d3', 'g1f3'): mine(u); turn()
        for _ in range(3): pg.click('.trainer button:has-text("Take back")'); wait(150)
        t = time.time(); pg.click('.trainer button:has-text("Hint")')
        pg.wait_for_function("[...document.querySelectorAll('.trainer svg')].some(s => s.outerHTML.includes('106, 167, 232'))", timeout=40000)
        took = time.time() - t
        r.check(took < 6, 'the hint after three quick take backs waits for one search, not four', f'{took:.1f}s')
        mine('e2e4'); turn()
        r.check(len(moves()) == 2, 'and the game goes on', str(moves()))
        c2.close()
        # choosing things while the engine is still loading
        c4 = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900}, service_workers='block'); pg = c4.new_page(); r.watch(pg, 'early')
        pg.add_init_script("{ const post = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, ...x) { if (m !== 'uci') return post.call(this, m, ...x); setTimeout(() => post.call(this, m, ...x), 4000); }; }")
        pg.goto(a.url); pg.wait_for_selector('.tabs'); tab(0)
        loading = pg.inner_text('.trainer .status-text')
        sel = pg.locator('.trainer .controls select')
        sel.nth(1).select_option('caro'); sel.nth(1).select_option('italian'); sel.first.select_option('play'); sel.nth(1).select_option('b')
        try:
            turn(); ok = len(moves()) == 1 and sel.first.input_value() == 'play' and pg.evaluate("document.querySelector('.trainer [data-square]').dataset.square") == 'h1'
        except Exception:
            ok = False
        r.check('Loading' in loading and ok, 'settings chosen before the engine has loaded are kept, and the game starts', f"{loading} -> {pg.inner_text('.trainer .status-text')} {moves()}")
        c4.close()
        # a worker that never answers: another one takes over, and only one is left of each engine
        for stuck, label in ((2, 'both engines of Play are stuck'), (1, 'one engine of Play is stuck')):
            c5 = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900}, service_workers='block'); pg = c5.new_page(); r.watch(pg, 'stuck')
            pg.add_init_script("{ let n = 0; const post = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, ...x) { if (m === 'uci' && ++n <= %d) return; return post.call(this, m, ...x); }; }" % stuck)
            t = time.time(); pg.goto(a.url); pg.wait_for_selector('.tabs'); tab(0)
            try:
                turn(); took = time.time() - t; wait(1500)
                ok = not pg.locator('.engine-failed').count() and len(pg.workers) == 2
            except Exception:
                ok, took = False, 0
            pg.locator('.trainer .controls select').first.select_option('play'); wait(800)
            try:
                turn(); mine('e2e4'); turn(); played = len(moves()) == 2
            except Exception:
                played = False
            r.check(ok and played, f'{label}: another worker takes over', f'{took:.0f}s, {len(pg.workers)} workers, played {played}')
            c5.close()
        # the engine cannot load
        c3 = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900}, service_workers='block'); pg = c3.new_page()
        c3.route('**/engine/*.js', lambda route: route.abort())
        pg.goto(a.url); pg.wait_for_selector('.tabs'); wait(2500)
        r.check(pg.locator('.engine-failed').count() == 1, 'the engine cannot load: the app says so')
        c3.unroute('**/engine/*.js'); pg.click('.engine-failed button'); pg.wait_for_selector('.tabs'); tab(0); turn()
        r.check(pg.locator('.engine-failed').count() == 0, 'and trying again works')
        c3.close()
    b.close()
r.done()

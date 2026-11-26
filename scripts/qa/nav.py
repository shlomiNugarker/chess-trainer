"""QA: the Back button, a game that survives a reload, the daily goal, the keyboard in dialogs, and the engine
when it is slow or cannot load (English, ~3 min).

    python scripts/qa/nav.py [--url URL] [--only back,reload,ends,computer,drag,history,goal,keys,engine]
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
from common import ROOT, Report, args

a = args('Back button and reload QA', lambda p: (p.add_argument('--chesscom', default=os.environ.get('CHESSCOM_USER', ''), help='Chess.com username for the review (or CHESSCOM_USER)'),
                                                     p.add_argument('--channel', default='', help="'chrome': the installed Chrome instead of Playwright's Chromium")))
# the Chess.com account the review loads: given by whoever runs the checks, never written in the repository
if not a.chesscom and (not a.only or {'back'} & set(a.only)):
    sys.exit('Set the Chess.com username for the review: --chesscom USER, or the CHESSCOM_USER environment variable.')
r = Report('nav')


def wait(ms): pg.wait_for_timeout(ms)
def cur(): return pg.evaluate("document.querySelector('.tabs [aria-selected=true] .tab-label').innerText")
TABS = ['play', 'learn', 'review', 'drill']  # numbered this way, whatever their order on screen
def tab(i): pg.locator(f'.tabs [data-tab={TABS[i]}]').click(); wait(250)
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
        pg.evaluate("() => { ['play', 'learn', 'drill', 'review', 'play'].forEach((id) => document.querySelector(`.tabs [data-tab=${id}]`).click()); }")
        wait(800)
        r.check(cur() == 'Play', 'five taps at once end on the last', cur())
        pg.click('.settings-toggle'); wait(300); back()
        r.check(pg.locator('.controls.open').count() == 0 and cur() == 'Play', 'Back closes the settings sheet')
        pg.click('.settings-toggle'); wait(250); pg.click('.sheet-done'); wait(400); back()
        r.check(cur() != 'Play' and pg.locator('.controls.open').count() == 0, 'a sheet closed by its button does not come back', cur())
        tab(2); pg.fill('.review input', a.chesscom); pg.locator('.review button.primary').first.click()
        pg.wait_for_selector('.recent-game', timeout=180000)
        pg.locator('.recent-game').first.click(); pg.wait_for_selector('.game-review'); wait(300); back()
        r.check(pg.locator('.recent-game').count() > 0 and cur() == 'My games', 'Back leaves a game review to the list')
        pg.go_forward(); wait(600)
        r.check(pg.locator('.game-review').count() == 1, 'Forward opens it again')
        tab(1); back()
        r.check(cur() == 'My games' and pg.locator('.game-review').count() == 1, 'from another tab, Back returns to the game review')
        pg.locator('.game-review-head button').click(); wait(500)
        r.check(pg.locator('.recent-game').count() > 0, 'the review has its own way back')
        pg.locator('.recent-game').nth(1).click(); pg.wait_for_selector('.game-review')
        pg.reload(); pg.wait_for_selector('.tabs'); wait(800)
        r.check(cur() == 'My games' and pg.locator('.game-review').count() == 0, 'reload in a review: the tab stays', cur())
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

    if not a.only or 'drag' in a.only:
        # promotion by dragging: with the mouse, and with a finger on a phone (touch events of the browser itself)
        raw = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(ROOT / 'scripts/qa/dump-ends.ts')], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout
        cases = {k: v for k, v in json.loads(raw).items() if 'promotion' in k}
        for how, options in (('mouse', {'viewport': {'width': 1280, 'height': 900}}), ('finger', {'viewport': {'width': 390, 'height': 844}, 'has_touch': True, 'is_mobile': True})):
            c7 = b.new_context(locale='en-US', service_workers='block', **options); pg = c7.new_page(); r.watch(pg, how)
            cdp = c7.new_cdp_session(pg)
            def center(sq):
                box = pg.locator(f'.trainer [data-square="{sq}"]').bounding_box()
                return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            def drag(sq1, sq2):
                (x1, y1), (x2, y2) = center(sq1), center(sq2)
                path = [(x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12) for i in range(13)]
                if how == 'mouse':
                    pg.mouse.move(x1, y1); pg.mouse.down()
                    for x, y in path: pg.mouse.move(x, y); wait(15)
                    wait(80); pg.mouse.up()
                else:
                    touch = lambda t, p: cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': p[0], 'y': p[1]}] if p else []})
                    touch('touchStart', path[0])
                    for p_ in path[1:]: touch('touchMove', p_); wait(15)
                    wait(80); touch('touchEnd', None)
                wait(600)
            piece = lambda sq: pg.evaluate("s => document.querySelector(`.trainer [data-square=${s}] [data-piece]`)?.dataset.piece ?? ''", sq)
            pg.goto(a.url); pg.wait_for_selector('.tabs')
            for name, c in cases.items():
                pg.evaluate('g => { localStorage.setItem("chess-trainer:screen", JSON.stringify("play")); localStorage.setItem("chess-trainer:game", g); }',
                            json.dumps({'mode': 'play', 'repertoire': 'italian', 'color': c['color'], 'phase': 'free', 'moves': c['moves'].split(), 'at': pg.evaluate('Date.now()')}))
                reload(); turn()
                n, (p1, p2), pawn = len(moves()), c['play'], c['color'] + 'P'
                # a page that can scroll both ways, or "it does not scroll" would say nothing; the fonts are here, and the
                # browser does not move the page by itself when something above changes its height (scroll anchoring)
                pg.evaluate("async () => { document.documentElement.style.overflowAnchor = 'none'; await document.fonts.ready; document.body.style.minHeight = '2400px'; scrollTo(0, 24); }"); wait(200)
                top = pg.evaluate('scrollY')
                drag(p1, 'e4' if c['color'] == 'b' else 'e5')
                r.check(len(moves()) == n and piece(p1) == pawn, f'{how}, {name}: dropped on a square it cannot reach, the pawn goes back', f'{moves()[n:]} {piece(p1)}')
                drag(p1, p2)
                played = moves()[n] if len(moves()) > n else ''
                r.check(played == c['san'] and piece(p1) != pawn, f'{how}, {name}: dragged to {p2}: {c["san"]}', f'{played} {piece(p2)}')
                r.check(pg.evaluate('scrollY') == top == 24, f'{how}, {name}: the page does not scroll with the drag', f"{top} -> {pg.evaluate('scrollY')}")
                turn()
                r.check(len(moves()) == n + 2, f'{how}, {name}: the computer answers', str(moves()[n:]))
                pg.locator('.trainer button', has_text='Take back').click(); wait(900)
                r.check(piece(p1) == pawn and len(moves()) == n, f'{how}, {name}: take back gives the pawn back')
                tapped = p1; pg.click(f'.trainer [data-square="{tapped}"]'); wait(250); pg.click(f'.trainer [data-square="{p2}"]'); wait(700)
                r.check(len(moves()) > n and moves()[n] == c['san'], f'{how}, {name}: and tapping still works after a drag', str(moves()[n:]))
                turn()  # or the computer's answer would be saved over the next game
            if how == 'finger':
                # the same movement from an empty square does scroll: the check above means something
                drag('d5', 'd2')
                r.check(pg.evaluate('scrollY') != 24, 'finger: a drag that does not start on a piece scrolls the page', str(pg.evaluate('scrollY')))
                # the board library tries to cancel the end of a touch that is scrolling; Chrome says so and goes on
                r.errors = [e for e in r.errors if not (e.startswith('[finger]') and 'attempt to cancel a touchend' in e)]
            c7.close()
        pg = ctx.pages[0]

    if not a.only or 'history' in a.only:
        # looking back and forward through a game: the board shows an earlier position, the game itself does not change
        GAME = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']
        for how, options in (('desktop', {'viewport': {'width': 1280, 'height': 900}}), ('phone', {'viewport': {'width': 390, 'height': 664}, 'has_touch': True, 'is_mobile': True})):
            c8 = b.new_context(locale='en-US', service_workers='block', **options); pg = c8.new_page(); r.watch(pg, f'history-{how}')
            pg.goto(a.url); pg.wait_for_selector('.tabs')
            pg.evaluate('g => { localStorage.setItem("chess-trainer:screen", JSON.stringify("play")); localStorage.setItem("chess-trainer:game", g); }',
                        json.dumps({'mode': 'play', 'repertoire': 'italian', 'color': 'w', 'phase': 'free', 'moves': GAME, 'at': pg.evaluate('Date.now()')}))
            reload(); turn()
            board = lambda: pg.evaluate("[...document.querySelectorAll('.trainer [data-square] [data-piece]')].map(e => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join()")
            live = board()
            press = (lambda k: pg.keyboard.press(k)) if how == 'desktop' else None
            pg.click('.trainer .nav-prev'); pg.click('.trainer .nav-prev'); wait(400)
            r.check('Nc6' in pg.inner_text('.trainer .status') and 'c4wB' not in board() and 'c5bB' not in board() and 'c6bN' in board(),
                    f'{how}: two steps back show the position after 2...Nc6', pg.inner_text('.trainer .status'))
            r.check(len(moves()) == 6 and pg.inner_text('.trainer .moves .move.last') == 'Nc6', f'{how}: the game is not changed, and the list marks the move looked at')
            pg.locator('.trainer .moves button.move', has_text='Nf3').click(); wait(300)
            r.check('Nf3' in pg.inner_text('.trainer .status') and 'f3wN' in board() and 'c6bN' not in board(), f'{how}: a tap on a move in the list shows it')
            pg.click('.trainer [data-square="d2"]'); wait(400)
            r.check(board() == live and pg.locator('.trainer .viewing').count() == 0, f'{how}: a tap on the board goes back to the game')
            if how == 'desktop':
                pg.keyboard.press('ArrowLeft'); pg.keyboard.press('ArrowLeft'); pg.keyboard.press('ArrowLeft'); wait(300)
                r.check('2.Nf3' in pg.inner_text('.trainer .status'), 'desktop: the arrow keys step back, one move each', pg.inner_text('.trainer .status'))
                pg.keyboard.press('Home'); wait(300)
                r.check(pg.evaluate("document.querySelectorAll('.trainer [data-square] [data-piece]').length") == 32 and 'start' in pg.inner_text('.trainer .status'), 'desktop: Home shows the start')
                pg.keyboard.press('End'); wait(300)
                r.check(board() == live, 'desktop: End goes back to the game')
                pg.keyboard.press('ArrowLeft'); wait(300)
                pg.click('.trainer [data-square="d2"]'); pg.click('.trainer [data-square="d3"]'); wait(400)
                r.check(len(moves()) == 6, 'desktop: no move can be played while looking back')
                pg.keyboard.press('End'); wait(300)
            # a move of the game, and take back while looking back
            mine('d2d3'); turn()
            r.check(len(moves()) == 8, f'{how}: the game goes on', str(moves()))
            pg.click('.trainer .nav-prev'); wait(300)
            pg.click('.trainer button:has-text("Take back")'); wait(800)
            r.check(len(moves()) == 6 and pg.locator('.trainer .viewing').count() == 0 and board() == live, f'{how}: Take back while looking back: back to the game, one move less')
            if how == 'phone':
                small = pg.evaluate("[...document.querySelectorAll('.trainer button')].filter(e => e.offsetParent && !e.disabled && e.getBoundingClientRect().height < 43.5).map(e => e.className)")
                r.check(not small and pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 0, 'phone: ‹ › and the moves are big enough for a finger, no sideways scroll', str(small))
                nav = pg.evaluate("[...document.querySelectorAll('.trainer .moves-bar > *, .trainer .moves-nav > *')].filter(e => e.offsetParent).map(e => e.className.split(' ')[0] + ':' + Math.round(e.getBoundingClientRect().top))")
                r.check(len({x.split(':')[1] for x in nav if x.split(':')[0] in ('nav-prev', 'moves', 'nav-next')}) == 1, 'phone: ‹ and › are in the row of the moves', str(nav))
            r.shot(pg, f'history-{how}')
            c8.close()
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
        pg.click('.opening-btn')
        r.check(all(roles) and pg.locator('.pick-sheet .sheet-row[aria-current=true]').count() == 1, 'every tab list holds only tabs; the opening list marks the one studied', str(roles))
        pg.keyboard.press('Escape'); wait(300)

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

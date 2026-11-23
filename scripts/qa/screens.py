"""QA: Learn extras, Practice (puzzles, my mistakes), My review, account and language, phone layouts, offline.

    python scripts/qa/screens.py [--url URL] [--only learn,puzzles,mistakes,review,account,phone,offline]
                                 [--chesscom USER] [--account-url URL]

The review section loads real games from Chess.com; the account panel needs a build with Firebase configured,
so by default it is checked on the live site.
"""
import json, time
from playwright.sync_api import sync_playwright
from common import LIVE, Report, args, hscroll, lines, puzzles_by_board, wait_until


def extra(p):
    p.add_argument('--chesscom', default='shlomin1231', help='Chess.com username for the review')
    p.add_argument('--account-url', default=LIVE, help='a build with Firebase configured, for the account panel')


a = args('Screens QA', extra)
r = Report('screens')
data = lines()
SICILIAN = next(x for x in data if x['id'] == 'sicilian')
PUZZLES = puzzles_by_board()


def open_page(b, tag, locale, w, h, url=None):
    ctx = b.new_context(locale=locale, viewport={'width': w, 'height': h})
    pg = ctx.new_page()
    r.watch(pg, tag)
    pg.goto(url or a.url)
    pg.wait_for_selector('.tabs', timeout=60000)
    return ctx, pg


def tab(pg, i):
    pg.locator('.tabs .tab:not(.lang-switch):not(.account-tab)').nth(i).click(); time.sleep(0.6)


def text(pg, sel):
    loc = pg.locator(sel)
    return loc.first.inner_text().replace('\n', ' ') if loc.count() else ''


def status(pg): return text(pg, '.status-text:visible')


def section(name):
    def deco(fn):
        def run(*x):
            if a.only and name not in a.only: return
            r.note(f'--- {name}')
            try: fn(*x)
            except Exception as e:
                r.check(False, f'{name}: crashed', str(e).splitlines()[0][:220]); r.shot(x[0] if hasattr(x[0], 'screenshot') else None, f'screens-{name}')
        return run
    return deco


def tour(pg, tag):
    for t in range(4):
        tab(pg, t); time.sleep(1.5)
        got = pg.locator('button:has-text("Got it"), button:has-text("הבנתי")')
        if got.count(): got.first.click()
        r.shot(pg, f'{tag}-tab{t}')
        r.check(hscroll(pg) <= 0, f'{tag}: tab {t} ({text(pg, ".tab.active")}) has no horizontal scroll')


@section('learn')
def learn(pg):
    chips = lambda: pg.locator('.learn-header .chips button.chip:not(.manage-chip)').count()
    pg.click('.tabs .tab:has-text("Learn")')
    if pg.locator('button:has-text("Got it")').count(): pg.click('button:has-text("Got it")')
    pg.locator('.learn-header .chips button.chip:not(.manage-chip)').nth(0).click()
    for _ in range(3): pg.click('.stepper button:has-text("Next")')
    r.check('2.Bf4' in text(pg, '.learn-move-head'), 'stepper: three times Next shows 2.Bf4')
    pg.click('.stepper button[aria-label="To the end"]')
    r.check('End of the line.' in pg.locator('.learn').inner_text(), 'stepper: to the end')
    pg.click('.stepper button[aria-label="To the start"]')
    # per-line stats
    pg.click('.progress-pill'); time.sleep(0.3)
    r.check(pg.locator('.line-stats-name').count() == len(data[0]['lines']), 'line stats list every line')
    pg.locator('.line-stats-name').nth(2).click(); time.sleep(0.3)
    r.check(pg.locator('select[aria-label="Line"]').input_value() == '2', 'a line in the stats opens it')
    pg.click('.progress-pill')
    # hide / show openings
    before = chips()
    pg.click('.manage-chip'); rows = pg.locator('.manage-row input[type="checkbox"]')
    rows.nth(0).uncheck(); rows.nth(2).uncheck()
    r.check(chips() == before - 2, 'hiding two openings removes their chips')
    pg.click('.tabs .tab:has-text("Play")')
    opts = pg.locator('.controls select').nth(1).locator('option').all_inner_texts()
    r.check(len(opts) == before - 2, 'hidden openings leave the Play picker', str(opts))
    pg.click('.tabs .tab:has-text("Learn")')
    if not pg.locator('.manage-card').count(): pg.click('.manage-chip')
    rows = pg.locator('.manage-row input[type="checkbox"]')
    for i in range(rows.count() - 1): rows.nth(i).uncheck()
    r.check(chips() == 1 and rows.nth(rows.count() - 1).is_disabled(), 'the last shown opening cannot be hidden')
    for i in range(rows.count()): rows.nth(i).check()
    r.check(chips() == before, 'all openings shown again')
    pg.click('.manage-chip')
    # PGN import: a new opponent move in the London (2...a6), a contradicting one, then remove the branch
    pg.locator('.learn-header .chips button.chip:not(.manage-chip)').nth(0).click()
    n_lines = pg.locator('select[aria-label="Line"] option').count()
    pg.click('.import-link'); pg.fill('.import-card textarea', '1. d4 d5 2. Bf4 a6 3. e3 Nf6 4. Nf3')
    pg.click('.import-card button.primary'); time.sleep(0.5)
    opts = pg.locator('select[aria-label="Line"] option').all_inner_texts()
    star = [i for i, o in enumerate(opts) if '★' in o]
    r.check(len(opts) == n_lines + 1 and star, 'PGN import adds a ★ branch', text(pg, '.import-results'))
    pg.fill('.import-card textarea', '1. d4 d5 2. c4')
    pg.click('.import-card button.primary'); time.sleep(0.5)
    r.check('2.Bf4' in text(pg, '.import-results'), 'an import that contradicts the repertoire is refused', text(pg, '.import-results'))
    if star:
        pg.select_option('select[aria-label="Line"]', index=star[0])
        pg.click('.remove-branch'); time.sleep(0.5)
        r.check(pg.locator('select[aria-label="Line"] option').count() == n_lines, 'the branch can be removed')
    pg.click('.import-link')


@section('puzzles')
def puzzles(pg):
    pg.click('.tabs .tab:has-text("Practice")'); pg.click('.segmented button:has-text("Puzzles")')
    pg.wait_for_selector('.puzzle-rating', timeout=20000)
    r.check('Rating' in text(pg, '.puzzle-rating'), 'puzzle rating shown')
    pg.click('button:visible:has-text("Hint")'); time.sleep(0.5)
    pg.click('button:visible:has-text("Show solution")')
    r.check(wait_until(lambda: pg.locator('button:visible:has-text("Next puzzle")').count() > 0, 15), 'show solution, then "Next puzzle"', status(pg))
    pg.click('button:visible:has-text("Next puzzle")'); time.sleep(1)
    for m in ['From my openings', 'Mates', 'For my level']:
        pg.click(f'.puzzle-header .chips button:has-text("{m}")'); time.sleep(1.5)
        r.check('Find the best move' in status(pg) and not pg.locator('.drill-empty').count(), f'puzzle mode "{m}" loads', status(pg))
    pg.click('button:visible:has-text("Skip")'); time.sleep(1)
    r.check('Find the best move' in status(pg), 'skip loads another puzzle')
    # solving all the way: clean, after a hint, after a wrong move, and in the other two modes
    rating = lambda: int(''.join(ch for ch in text(pg, '.puzzle-rating') if ch.isdigit()) or 0)
    solved = lambda: int(text(pg, '.puzzle-stats').split()[1])
    solved0 = solved()
    for mode, how, want in [('For my level', 'clean', 'Solved ✓'), ('For my level', 'hint', 'half credit'),
                            ('For my level', 'wrong', 'with help'), ('From my openings', 'clean', 'Solved ✓'),
                            ('Mates', 'clean', 'Solved ✓')]:
        pg.click(f'.puzzle-header .chips button:has-text("{mode}")'); time.sleep(1.5)
        before = rating()
        res = solve_puzzle(pg, how)
        after = rating()
        r.check(want in res, f'puzzle solved to the end ({mode}, {how})', f'-> "{res}", rating {before} -> {after}')
        if how == 'clean': r.check(after > before, f'  a clean solve raises the rating ({mode})')
        if how == 'wrong': r.check(after < before, '  a solve after a wrong move lowers the rating')
        pg.click('button:visible:has-text("Next puzzle")'); time.sleep(1)
    r.check(solved() >= solved0 + 3, 'puzzle stats count the solves', f'{solved0} -> {solved()} ({text(pg, ".puzzle-stats")})')


PUZZLE_BOARD_JS = """() => {
  const board = [...document.querySelectorAll('.board')].find(b => b.offsetParent !== null);
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = '', empty = 0;
    for (const f of 'abcdefgh') {
      const p = board.querySelector(`[data-square="${f}${r}"] [data-piece]`)?.getAttribute('data-piece');
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p[0] === 'w' ? p[1].toUpperCase() : p[1].toLowerCase();
    }
    rows.push(row + (empty || ''));
  }
  return rows.join('/');
}"""
DOTS_JS = """() => [...document.querySelectorAll('[data-square]')].filter(e => e.offsetParent !== null && e.outerHTML.includes('radial-gradient')).map(e => e.dataset.square)"""


def solve_puzzle(pg, how='clean'):
    """Recognizes the puzzle on the board (puzzles-vN.json) and plays its solution; returns the final status."""
    board = lambda: pg.evaluate(PUZZLE_BOARD_JS)
    tap = lambda sq: pg.click(f'[data-square="{sq}"]:visible')
    if not wait_until(lambda: 'Find the best move' in status(pg), 15): return 'never got to solve: ' + status(pg)
    p = PUZZLES.get(board())
    if not p: return 'puzzle not recognized'
    if how == 'hint':
        pg.click('button:visible:has-text("Hint")'); time.sleep(0.3)
    if how == 'wrong':  # a legal move that is not the solution, then "try again"
        sol = p['moves'][0]
        me = 'w' if 'White' in status(pg) else 'b'
        own = pg.evaluate("(c) => [...document.querySelectorAll('[data-square] [data-piece]')].filter(e => e.offsetParent !== null && e.dataset.piece[0] === c).map(e => e.closest('[data-square]').dataset.square)", me)
        for sq in own:
            tap(sq); dots = [d for d in pg.evaluate(DOTS_JS) if sq + d != sol[:4]]
            if dots: tap(dots[0]); break
            tap(sq)
        time.sleep(1)
        if pg.locator('button:visible:has-text("Try again")').count(): pg.click('button:visible:has-text("Try again")')
        wait_until(lambda: 'Find the best move' in status(pg), 10)
    for i, u in enumerate(p['moves']):
        if i % 2: continue  # the opponent's replies
        before = board()
        tap(u[:2]); tap(u[2:4])
        if i + 1 < len(p['moves']):
            wait_until(lambda: board() != before, 5, 0.1)
            mine = board()
            wait_until(lambda: board() != mine and 'Find the best move' in status(pg), 10)
    wait_until(lambda: 'Solved' in status(pg), 10)
    return status(pg)


@section('mistakes')
def mistakes(pg):
    # a mistake in training (Sicilian: 1.e4 a6) is saved, then drilled in "My mistakes"
    pg.click('.tabs .tab:has-text("Play")')
    sel = pg.locator('.controls select')
    sel.nth(0).select_option('train'); sel.nth(1).select_option('sicilian')
    wait_until(lambda: 'Your move' in text(pg, '.trainer .status-text') and pg.locator('.trainer [data-square="e4"] [data-piece]').count() > 0, 40)
    time.sleep(0.5)
    pg.click('.trainer [data-square="a7"]'); pg.click('.trainer [data-square="a6"]'); time.sleep(1)
    pg.click('.trainer button:has-text("Try again")')
    pg.click('.tabs .tab:has-text("Practice")'); pg.click('.segmented button:has-text("My mistakes")'); time.sleep(1)
    r.check('Sicilian' in text(pg, '.drill-meta'), 'the training mistake is in "My mistakes"', text(pg, '.drill-meta'))
    pg.click('[data-square="h7"]:visible'); pg.click('[data-square="h6"]:visible'); time.sleep(1.5)
    r.check('c5' in text(pg, '.card.feedback'), 'a wrong answer shows the right move', text(pg, '.card.feedback'))
    pg.locator('button:visible:has-text("Next")').first.click(); time.sleep(1)
    pg.click('[data-square="c7"]:visible'); pg.click('[data-square="c5"]:visible'); time.sleep(1.5)
    r.check('Correct!' in pg.locator('body').inner_text(), 'the position comes back, and the right answer is "Correct!"')


@section('review')
def review(pg):
    pg.click('.tabs .tab:has-text("My review")')
    pg.fill('.review input', a.chesscom); pg.click('.review button:has-text("Load games")')
    t = time.time()
    pg.wait_for_selector('.review .tile-value', timeout=180000)
    wait_until(lambda: not pg.locator('.review .progress').count(), 240, 1)
    r.check(True, f'review loaded in {time.time() - t:.0f}s', text(pg, '.review .tile'))
    txt = pg.locator('.review').inner_text()
    for h in ['Your openings as White', 'Your openings as Black', 'How you lose', 'By time control', 'Where your games leave your lines']:
        r.check(h in txt, f'review section "{h}"')
    acc = text(pg, '.accuracy-card')
    r.check('Your accuracy over time' in acc and pg.locator('.accuracy-card .acc-chesscom .dot').count() >= 2, 'accuracy over time: Chess.com months on the chart', acc[:120])
    r.check(pg.evaluate("[...document.querySelectorAll('.chart svg')].every(s => Math.abs(Number(s.getAttribute('viewBox').split(' ')[2]) - s.getBoundingClientRect().width) < 2)"), 'charts are drawn at their real width')
    strengths = text(pg, '.strengths')
    r.check('Your strengths' in strengths and 'As White' in strengths and 'As Black' in strengths, 'the strengths card', strengths[:160])
    r.check(pg.locator('.opening.strong').count() > 0 or 'No opening stands out' in strengths, 'strongest openings marked in the tables',
            f'{pg.locator(".opening.strong").count()} marked')
    r.shot(pg, 'review')
    chips = pg.locator('.review .chips button')
    if chips.count() > 1:
        all_games = text(pg, '.review .tile')
        chips.nth(1).click(); time.sleep(1)
        r.check(text(pg, '.review .tile') != all_games, f'time-control filter "{chips.nth(1).inner_text()}"', text(pg, '.review .tile'))
        chips.nth(0).click(); time.sleep(1)
    add = pg.locator('.branches-card button:has-text("Add a branch")')
    if add.count():
        add.first.click()
        pg.wait_for_selector('.branch-added', timeout=60000)
        added = text(pg, '.branch-added')
        r.check('Branch added' in added, 'add a branch (Stockfish answer)', added[:120])
        pg.locator('.branch-added button, .branch-added a').first.click(); time.sleep(1)
        r.check('★' in text(pg, 'select[aria-label="Line"] option:checked'), '"Learn it" opens the new branch in Learn')
        pg.click('.tabs .tab:has-text("My review")')
    pr = pg.locator('.branches-card button:has-text("Practice")')
    if pr.count():
        pr.first.click(); time.sleep(1)
        r.check(pg.locator('.branches-card button:has-text("Added")').count() > 0, '"Practice" saves the spot for drilling')
    an = pg.locator('.review button:has-text("Analyze")')
    if an.count():
        an.first.click()
        r.check(wait_until(lambda: pg.locator('.review .deep').count() > 0 and 'per game' in text(pg, '.review .deep'), 60), 'engine analysis shows results')
        if pg.locator('.review button:has-text("Stop")').count(): pg.click('.review button:has-text("Stop")')
    r.check(hscroll(pg) <= 0, 'review has no horizontal scroll')
    # one game, move by move
    r.check(pg.locator('.recent-game').count() >= 5, 'game review: the latest games are listed')
    pg.click('.recent-games-head button.primary')
    pg.wait_for_selector('.game-review', timeout=10000)
    t = time.time()
    done = wait_until(lambda: not pg.locator('.review-progress').count(), 300, 1)
    r.check(done, f'game review: the last game is analyzed ({time.time() - t:.0f}s)')
    summary = text(pg, '.review-summary')
    r.check('Accuracy' in summary and pg.locator('.rv-acc').count() == 2 and pg.locator('.rv-count').count() == 12, 'game review: accuracy boxes and the count of every move class for both players', summary[:120])
    moves = pg.locator('.review-moves button.move').count()
    r.check(moves > 0 and pg.locator('.review-moves button.move[class*="cls-"]').count() == moves, 'game review: every move has a label', f'{moves} moves')
    # stepping through the game never moves the buttons (the coach card has one fixed height)
    pg.keyboard.press('Home'); time.sleep(0.2)
    tops = set()
    for _ in range(min(moves, 30)):
        pg.locator('.stepper button.primary').click()
        tops.add(round(pg.locator('.stepper').bounding_box()['y']))
    r.check(len(tops) == 1, 'game review: the buttons stay in place while stepping through the moves', f'{len(tops)} different positions')
    pg.keyboard.press('End'); time.sleep(0.3)
    r.check(pg.locator('.review-moves button.move.last').count() == 1, 'game review: End jumps to the last move')
    nm = pg.locator('.next-mistake')
    if not nm.is_disabled():
        nm.click(); time.sleep(0.4)
        card = text(pg, '.coach')
        r.check(any(k in card for k in ['an inaccuracy', 'a mistake', 'a blunder']) and 'The best move was' in card and pg.locator('.board-badge .cls-icon').count() == 1, 'game review: "my next mistake" shows the verdict, the better move and the mark on the board', card[:100])
        badge = lambda: int(text(pg, '.tabs .tab:has-text("Practice") .badge') or 0)
        b0 = badge()
        btn = pg.locator('.coach button:has-text("Practice this position")')
        if btn.count():
            btn.click(); time.sleep(0.4)
            r.check(badge() == b0 + 1 or 'Added to practice' in text(pg, '.coach'), 'game review: "practice this position" saves it')
    box = pg.locator('.eval-graph').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.25, box['y'] + box['height'] / 2); time.sleep(0.3)
    r.check(pg.locator('.review-moves button.move.last').count() == 1, 'game review: the graph jumps to a move')
    r.check(hscroll(pg) <= 0, 'game review: no horizontal scroll')
    r.shot(pg, 'game-review')
    pg.click('.game-review-head button')
    r.check(pg.wait_for_selector('.recent-games', timeout=5000) is not None and pg.locator('.recent-game .pill').count() >= 1, 'game review: back to the list, the game is marked reviewed')
    r.check(pg.locator('.accuracy-card .acc-own .dot').count() >= 1, 'accuracy over time: the game reviewed here shows on the chart')
    pg.locator('.recent-game').first.click()
    r.check(pg.wait_for_selector('.review-summary', timeout=5000) is not None and not pg.locator('.review-progress').count(), 'game review: a reviewed game opens at once')
    pg.click('.game-review-head button')
    pg.reload(); pg.click('.tabs .tab:has-text("My review")')
    r.check(wait_until(lambda: pg.locator('.review .tile-value').count() > 0, 60), 'the review reloads by itself after a page reload')


@section('account')
def account(b):
    ctx, pg = open_page(b, 'account', 'en-US', 1280, 900, a.account_url)
    pg.click('.tabs .account-tab'); pg.wait_for_selector('.account-panel')
    txt = pg.locator('.account-panel').inner_text()
    r.check('Sign in with Google' in txt or 'Sign out' in txt, 'account panel: Google sign-in')
    r.check('Licenses' in txt, 'account panel: licenses link')
    pg.locator('.account-panel .chips button').nth(0).click(); time.sleep(0.5)
    r.check(pg.evaluate('document.documentElement.dir') == 'rtl' and 'מאמן שחמט' in pg.locator('body').inner_text(), 'language: Hebrew, right to left')
    pg.locator('.account-panel .chips button').nth(1).click(); time.sleep(0.5)
    r.check(pg.evaluate('document.documentElement.dir') == 'ltr', 'language: English, left to right')
    pg.click('.account-panel button[aria-label="Close"]'); time.sleep(0.3)
    r.check(pg.locator('.account-panel').count() == 0, 'account panel closes')
    ctx.close()


@section('phone')
def phone(b):
    line = SICILIAN['lines'][0]['uci']
    for tag, locale in [('phone-he', 'he-IL'), ('phone-en', 'en-US')]:
        ctx, pg = open_page(b, tag, locale, 390, 844)
        r.check(pg.evaluate('document.documentElement.dir') == ('rtl' if locale == 'he-IL' else 'ltr'), f'{tag}: page direction')
        tour(pg, tag)
        tab(pg, 0); pg.click('.settings-toggle'); time.sleep(0.4)
        r.check(pg.locator('.controls.open').count() == 1 and hscroll(pg) <= 0, f'{tag}: Play settings sheet')
        r.shot(pg, f'{tag}-sheet')
        pg.click('.sheet-done'); time.sleep(0.3)
        tab(pg, 1); pg.locator('.learn-header .chips button.chip:not(.manage-chip)').nth(data.index(SICILIAN)).click()
        pg.locator('.actions button').filter(has_text='🎯').first.click(); time.sleep(0.8)
        try:
            for k, u in enumerate(line):
                if k % 2 != 1: continue
                pg.wait_for_selector(f'.pill:has-text("{k}/{len(line)}")', timeout=8000)
                pg.click(f'.learn .board [data-square="{u[:2]}"]'); pg.click(f'.learn .board [data-square="{u[2:4]}"]')
            pg.wait_for_selector('.card.notice.tone-ok', timeout=8000)
            ok = True
        except Exception:
            ok = False
        r.check(ok and hscroll(pg) <= 0, f'{tag}: "Test me" on a Sicilian line by tapping')
        r.shot(pg, f'{tag}-learn-done')
        ctx.close()


@section('offline')
def offline(b):
    ctx, pg = open_page(b, 'offline', 'en-US', 1280, 900)
    pg.evaluate('navigator.serviceWorker ? navigator.serviceWorker.ready.then(() => true) : false')
    tab(pg, 3); pg.click('.segmented button:has-text("Puzzles")'); pg.wait_for_selector('.puzzle-rating', timeout=20000)
    tab(pg, 0); time.sleep(5)  # let the engine load (and get cached)
    pg.reload(); pg.wait_for_selector('.tabs'); time.sleep(2)
    ctx.set_offline(True)
    pg.reload()
    r.check(pg.wait_for_selector('.tabs', timeout=15000) is not None, 'offline: the app loads')
    tab(pg, 0)
    sel = pg.locator('.controls select'); sel.nth(0).select_option('play'); sel.nth(1).select_option('w')
    wait_until(lambda: 'Your move' in text(pg, '.trainer .status-text'), 30)
    pg.click('.trainer [data-square="e2"]'); pg.click('.trainer [data-square="e4"]')
    black = "[...document.querySelectorAll('.trainer [data-square] [data-piece]')].filter(e => e.getAttribute('data-piece')[0]==='b').map(e => e.closest('[data-square]').dataset.square).sort().join()"
    r.check(wait_until(lambda: 'Your move' in text(pg, '.trainer .status-text') and pg.evaluate(black) != 'a7,a8,b7,b8,c7,c8,d7,d8,e7,e8,f7,f8,g7,g8,h7,h8', 30),
            'offline: the engine answers 1.e4')
    tab(pg, 3); pg.click('.segmented button:has-text("Puzzles")'); time.sleep(3)
    r.check(pg.locator('.puzzle-rating').count() == 1 and pg.locator('.board [data-piece]').count() > 0, 'offline: puzzles')
    tab(pg, 1)
    r.check(pg.locator('.learn-header .chips button.chip').count() > 1, 'offline: Learn')
    ctx.close()


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = open_page(b, 'desktop-en', 'en-US', 1280, 900)
    if not a.only: tour(pg, 'desktop-en')
    learn(pg); mistakes(pg); puzzles(pg); review(pg)  # mistakes first: the puzzle section adds its own
    ctx.close()
    account(b); phone(b); offline(b)
    b.close()
r.done()

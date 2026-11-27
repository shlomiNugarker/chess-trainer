"""QA: Learn extras, Practice (puzzles, my mistakes), My review, account and language, phone layouts, offline.

    python scripts/qa/screens.py [--url URL] [--only learn,puzzles,mistakes,review,account,refresh,share,lichess,a11y,phone,touch,lang,offline]
                                 [--chesscom USER] [--account-url URL]

The review section loads real games from Chess.com; the account panel needs a build with Firebase configured,
so by default it is checked on the live site.
"""
import json, os, pathlib, re, sys, time
from playwright.sync_api import sync_playwright
from common import (LIVE, SHOTS, Report, args, close_sheet, current_line, hscroll, line_names, lines, manage_openings, open_opening, pick_line,
                    puzzles_by_board, shown_openings, wait_until)


def extra(p):
    p.add_argument('--chesscom', default=os.environ.get('CHESSCOM_USER', ''), help='Chess.com username for the review (or CHESSCOM_USER)')
    p.add_argument('--account-url', default=LIVE, help='a build with Firebase configured, for the account panel')


a = args('Screens QA', extra)
# the Chess.com account the review loads: given by whoever runs the checks, never written in the repository
if not a.chesscom and (not a.only or {'review', 'touch', 'lang'} & set(a.only)):
    sys.exit('Set the Chess.com username for the review: --chesscom USER, or the CHESSCOM_USER environment variable.')
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


TABS = ['play', 'learn', 'review', 'drill']  # the scripts number the tabs this way, whatever their order on screen


def pick_lang(pg, lang):
    """The language is chosen in the account / settings panel (the last item of the tab bar)."""
    pg.click('.account-tab'); pg.click(f'.account-panel .chip[lang={lang}]'); pg.keyboard.press('Escape'); time.sleep(0.3)


def tab(pg, i):
    pg.locator(f'.tabs [data-tab={TABS[i]}]').click(); time.sleep(0.6)


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
        got = pg.locator('button:has-text("Got it"), button:has-text("\u05d4\u05d1\u05e0\u05ea\u05d9")')
        if got.count(): got.first.click()
        r.shot(pg, f'{tag}-tab{t}')
        r.check(hscroll(pg) <= 0, f'{tag}: tab {t} ({text(pg, ".tab.active")}) has no horizontal scroll')


@section('learn')
def learn(pg):
    london = data[0]['id']
    pg.click('.tabs .tab:has-text("Learn")')
    if pg.locator('button:has-text("Got it")').count(): pg.click('button:has-text("Got it")')
    open_opening(pg, london)
    r.check(pg.locator('.pick-sheet').count() == 0 and pg.locator('.line-btn .picker-btn-meta').inner_text().endswith(f"/{len(data[0]['lines'])}"), 'a row of the opening list opens it and closes the list')
    for _ in range(3): pg.click('.stepper button:has-text("Next")')
    r.check('2.Bf4' in text(pg, '.learn-move-head'), 'stepper: three times Next shows 2.Bf4')
    pg.click('.stepper button[aria-label="To the end"]')
    r.check('End of the line.' in pg.locator('.learn').inner_text(), 'stepper: to the end')
    pg.click('.stepper button[aria-label="To the start"]')
    # the line list: every line with its test record; a tap opens the line
    r.check(len(line_names(pg)) == len(data[0]['lines']), 'the line list has every line')
    pg.click('.line-btn')
    r.check(pg.locator('.pick-sheet .sheet-row .sheet-row-meta').count() == len(data[0]['lines']), 'and the test record of each')
    pg.locator('.pick-sheet .sheet-row').nth(2).click(); time.sleep(0.3)
    r.check(current_line(pg) == 2 and pg.locator('.pick-sheet').count() == 0, 'a line in the list opens it')
    # hide / show openings
    before = shown_openings(pg)
    r.check(before == len(data), 'the opening list has every opening', str(before))
    manage_openings(pg)
    rows = lambda: pg.locator('.manage-row input[type="checkbox"]')
    rows().nth(0).uncheck(); rows().nth(2).uncheck()
    r.check(shown_openings(pg) == before - 2, 'hiding two openings takes them off the list')
    pg.click('.tabs .tab:has-text("Play")')
    opts = pg.locator('.controls select').nth(1).locator('option').all_inner_texts()
    r.check(len(opts) == before - 2, 'hidden openings leave the Play picker', str(opts))
    pg.click('.tabs .tab:has-text("Learn")')
    manage_openings(pg)
    for i in range(rows().count() - 1): rows().nth(i).uncheck()
    last_disabled = rows().nth(rows().count() - 1).is_disabled()
    r.check(shown_openings(pg) == 1 and last_disabled, 'the last shown opening cannot be hidden')
    manage_openings(pg)
    for i in range(rows().count()): rows().nth(i).check()
    r.check(shown_openings(pg) == before, 'all openings shown again')
    # PGN import (from the opening list): a new opponent move in the London (2...a6), a contradicting one, then remove the branch
    open_opening(pg, london)
    n_lines = len(line_names(pg))
    pg.click('.opening-btn'); pg.click('.pick-sheet .import-link')
    pg.fill('.import-card textarea', '1. d4 d5 2. Bf4 a6 3. e3 Nf6 4. Nf3')
    pg.click('.import-card button.primary'); time.sleep(0.5)
    names = line_names(pg)
    star = [i for i, o in enumerate(names) if '★' in o]
    r.check(len(names) == n_lines + 1 and star, 'PGN import adds a ★ branch', text(pg, '.import-results'))
    pg.fill('.import-card textarea', '1. d4 d5 2. c4')
    pg.click('.import-card button.primary'); time.sleep(0.5)
    r.check('2.Bf4' in text(pg, '.import-results'), 'an import that contradicts the repertoire is refused', text(pg, '.import-results'))
    if star:
        pick_line(pg, star[0])
        pg.click('.remove-branch'); time.sleep(0.5)
        r.check(len(line_names(pg)) == n_lines, 'the branch can be removed')
    pg.click('.import-card button.ghost')


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
    # "from my openings" takes puzzles from the openings the user plays only: hide all but the Pirc
    pg.evaluate("(ids) => localStorage.setItem('chess-trainer:hidden-repertoires', JSON.stringify(ids))", [x['id'] for x in data if x['id'] != 'pirc'])
    pg.reload(); pg.wait_for_selector('.tabs')
    pg.click('.tabs .tab:has-text("Practice")'); pg.click('.segmented button:has-text("Puzzles")')
    pg.wait_for_selector('.puzzle-rating', timeout=20000)
    got = []
    for _ in range(4):
        pg.click('.puzzle-header .chips button:has-text("From my openings")'); time.sleep(1)
        if not wait_until(lambda: 'Find the best move' in status(pg), 15): break
        p = PUZZLES.get(pg.evaluate(PUZZLE_BOARD_JS))
        got.append(p['openings'] if p else None)
        pg.click('button:visible:has-text("Skip")'); time.sleep(0.8)
    r.check(len(got) == 4 and all(o and 'pirc' in o for o in got), '"From my openings" gives puzzles from the shown openings only', got)
    pg.evaluate("localStorage.setItem('chess-trainer:hidden-repertoires', '[]')"); pg.reload(); pg.wait_for_selector('.tabs')


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
    # removing a position: gone from practice, back with "Undo", and gone for good after "Remove" again
    count = lambda: pg.evaluate("JSON.parse(localStorage.getItem('chess-trainer:mistakes')).filter(m => !m.deleted).length")
    pg.evaluate("""() => { const l = JSON.parse(localStorage.getItem('chess-trainer:mistakes'));
      l.push({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', played: 'a3', correct: 'Bc4', source: 'book', repertoire: 'italian', at: 1, box: 0, due: 1 });
      localStorage.setItem('chess-trainer:mistakes', JSON.stringify(l)); }""")
    tab(pg, 0); tab(pg, 3); pg.click('.segmented button:has-text("My mistakes")'); time.sleep(1)
    n = count()
    pg.click('button:visible:has-text("Remove from practice")'); time.sleep(0.5)
    r.check(count() == n - 1 and 'removed' in text(pg, '.removed-note'), 'a position can be removed from practice', f'{n} -> {count()}')
    pg.click('.removed-note button:has-text("Undo")'); time.sleep(0.5)
    r.check(count() == n and pg.locator('.removed-note').count() == 0 and pg.locator('[data-square] [data-piece]:visible').count() > 0, '"Undo" brings it back, on the board')
    pg.click('button:visible:has-text("Remove from practice")'); time.sleep(0.5); pg.reload(); pg.wait_for_selector('.tabs')
    r.check(count() == n - 1, 'removed for good after a reload')
    # the daily practice: 20 positions practiced today, 5 more due -> done for today, "Keep going" brings the 5
    pg.evaluate("""() => { const now = Date.now(), l = [];
      for (let i = 0; i < 25; i++) l.push({ fen: `r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - ${i} 3`, played: 'a3', correct: 'Bc4', source: 'book',
        repertoire: 'italian', at: 1, box: i < 20 ? 1 : 0, due: i < 20 ? now + 864e5 : 1, reviewed: i < 20 ? now : undefined });
      localStorage.setItem('chess-trainer:mistakes', JSON.stringify(l)); }""")
    pg.reload(); pg.wait_for_selector('.tabs'); tab(pg, 3); pg.click('.segmented button:has-text("My mistakes")'); time.sleep(1)
    r.check(pg.locator('.tabs .badge:not(.badge-dot)').count() == 0 and '5 more positions are waiting' in text(pg, '.drill-empty'), 'after 20 positions today the practice is done for the day', text(pg, '.drill-empty'))
    pg.click('.drill-empty button:has-text("Keep going")'); time.sleep(0.8)
    r.check('5 left' in text(pg, '.status:visible'), '"Keep going" brings the ones that wait', text(pg, '.status:visible'))


@section('review')
def review(pg):
    pg.click('.tabs .tab:has-text("My games")')
    r.check('What you get from your games' in text(pg, '.review-intro'), 'before any games: what My review gives', text(pg, '.review-intro')[:80])
    pg.fill('.review input', a.chesscom); pg.click('.review button:has-text("Load games")')
    pg.wait_for_selector('.recent-game', timeout=180000)
    r.check(pg.locator('.review-intro').count() == 0, 'with games: the intro is gone')
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
        r.check('★' in text(pg, '.line-btn .picker-btn-value'), '"Learn it" opens the new branch in Learn')
        pg.click('.tabs .tab:has-text("My games")')
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
    workers = lambda: len(pg.workers)
    pg.wait_for_timeout(1500)  # the browser reports a stopped engine a moment later
    idle = workers()
    r.check(idle == 2, 'after Stop only the two engines of Play are left', str(idle))
    if pg.locator('.review button:has-text("Analyze")').count():
        pg.locator('.review button:has-text("Analyze")').first.click()
        busy = wait_until(lambda: (pg.wait_for_timeout(100) or workers()) > idle, 10)
        r.check(busy, 'the engine analysis runs its own engine', f'{idle} -> {workers()}')
    else: r.note('  skip', 'game review stops the engine analysis: every recent game is already analyzed')
    pg.click('.recent-games-head button.primary')
    pg.wait_for_selector('.game-review', timeout=10000)
    pg.wait_for_timeout(500)
    r.check(workers() <= idle + 1, 'game review: only one review engine at a time', f'{idle} -> {workers()}')
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
    pg.reload(); pg.click('.tabs .tab:has-text("My games")')
    r.check(wait_until(lambda: pg.locator('.review .tile-value').count() > 0, 60), 'the review reloads by itself after a page reload')


# the browser offers to install (Playwright's does not): a stand-in for Chrome's event
OFFER_INSTALL = """(outcome = 'dismissed') => { const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = async () => { window.__asked = (window.__asked ?? 0) + 1; }; e.userChoice = Promise.resolve({ outcome }); window.dispatchEvent(e); window.__kept = e.defaultPrevented; }"""
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
MASTERED = """localStorage.setItem('chess-trainer:mastery', JSON.stringify({ london: { 'main-line-vs-d5-and-c5': { tries: 1, clean: 1, last: 0, at: 1 } } }))"""


@section('install')
def install(b):
    for how in ('declined', 'asked', 'done'):
        ctx, pg = open_page(b, 'install', 'en-US', 1280, 900)
        tab(pg, 1); pg.evaluate(OFFER_INSTALL); time.sleep(0.3)
        r.check(pg.locator('.install-card').count() == 0 and pg.evaluate('window.__kept'), f'install, {how}: not offered to a new user, and the browser does not offer it either')
        pg.evaluate(MASTERED); pg.reload(); tab(pg, 1)
        r.check(pg.locator('.install-card').count() == 0, f'install, {how}: no card where the browser does not offer it')
        pg.evaluate(OFFER_INSTALL, 'accepted' if how == 'done' else 'dismissed'); time.sleep(0.3)
        r.check(pg.locator('.install-card').count() == 1 and hscroll(pg) <= 0, f'install, {how}: the card, after a line without mistakes', text(pg, '.install-card'))
        r.shot(pg, 'install')
        if how == 'declined': pg.click('.install-card button:has-text("Not now")')
        else: pg.click('.install-card button:text-is("Install")')
        time.sleep(0.4)
        r.check(pg.locator('.install-card').count() == 0 and (pg.evaluate('window.__asked ?? 0') == (0 if how == 'declined' else 1)), f'install, {how}: the card goes away' + ('' if how == 'declined' else ', the browser asked once'))
        pg.reload(); tab(pg, 1); pg.evaluate(OFFER_INSTALL); time.sleep(0.3)
        r.check(pg.locator('.install-card').count() == (1 if how == 'done' else 0), f'install, {how}: ' + ('the event of an app that was removed offers it again' if how == 'done' else 'it does not come back'))
        ctx.close()
    for locale in ('en-US', 'he-IL', 'es-ES'):
        ctx = b.new_context(locale=locale, viewport={'width': 390, 'height': 664}, user_agent=IPHONE, has_touch=True, is_mobile=True)
        pg = ctx.new_page(); r.watch(pg, 'iphone'); pg.goto(a.url); pg.wait_for_selector('.tabs')
        pg.evaluate(MASTERED); pg.reload(); pg.wait_for_selector('.tabs'); tab(pg, 1)
        r.check(pg.locator('.install-card').count() == 1 and pg.locator('.install-card button').count() == 1 and hscroll(pg) <= 0, f'install, iPhone, {locale}: the steps', text(pg, '.install-card'))
        r.check(not pg.evaluate(SMALL_JS), f'install, iPhone, {locale}: the button is big enough', str(pg.evaluate(SMALL_JS)))
        fits = pg.evaluate("""() => [...document.querySelectorAll('.learn button.primary')].pop().getBoundingClientRect().bottom <= document.querySelector('.tabs').getBoundingClientRect().top""")
        r.check(fits, f'install, iPhone, {locale}: "Next" is still in view on a low phone')
        r.shot(pg, f'install-iphone-{locale}')
        pg.locator('.install-card button').tap(); pg.reload(); pg.wait_for_selector('.tabs'); tab(pg, 1)
        r.check(pg.locator('.install-card').count() == 0, f'install, iPhone, {locale}: closed for good')
        ctx.close()


@section('privacy')
def privacy(b):
    # /privacy: the app with the privacy page on top; Back closes it and stays in the app. On a phone, in every language
    for locale in ('en-US', 'he-IL', 'es-ES'):
        ctx, pg = open_page(b, f'privacy-{locale}', locale, 375, 812, a.url.rstrip('/') + '/privacy?utm_source=x')
        pg.wait_for_selector('.privacy-panel'); time.sleep(0.5)  # the sheet slides up
        body = pg.locator('.privacy-panel').inner_text()
        r.check(pg.evaluate('location.pathname + location.search') == '/?utm_source=x' and 'Vercel Web Analytics' in body and 'Firestore' in body and 'Chess.com' in body,
                f'/privacy, {locale}: the page, over the app at /', pg.evaluate('location.pathname'))
        r.check(pg.evaluate("(() => { const p = document.querySelector('.privacy-panel').getBoundingClientRect(); return p.top >= 0 && p.bottom <= innerHeight + 1; })()") and hscroll(pg) <= 0,
                f'/privacy, {locale}: it fits on the screen (its text scrolls inside)')
        r.shot(pg, f'privacy-{locale}')
        pg.go_back(); time.sleep(0.5)
        r.check(pg.locator('.privacy-panel').count() == 0 and pg.locator('.tabs').count() == 1, f'/privacy, {locale}: Back closes it, in the app')
        ctx.close()


@section('account')
def account(b):
    ctx, pg = open_page(b, 'account', 'en-US', 1280, 900, a.account_url)
    pg.click('.tabs .account-tab'); pg.wait_for_selector('.account-panel')
    txt = pg.locator('.account-panel').inner_text()
    r.check('Sign in with Google' in txt or 'Sign out' in txt, 'account panel: Google sign-in')
    r.check('Licenses' in txt, 'account panel: licenses link')
    pg.click('.account-panel .chips button[lang=he]')
    wait_until(lambda: pg.evaluate('document.documentElement.dir') == 'rtl', 10)  # its texts are loaded only now
    r.check(pg.evaluate('document.documentElement.dir') == 'rtl' and '\u05de\u05d0\u05de\u05df \u05e9\u05d7\u05de\u05d8' in pg.locator('body').inner_text(), 'language: Hebrew, right to left')
    pg.click('.account-panel .chips button[lang=en]'); time.sleep(0.5)
    r.check(pg.evaluate('document.documentElement.dir') == 'ltr', 'language: English, left to right')
    r.check(pg.locator('.install-row').count() == 0, 'account panel: no install button where the browser does not offer it')
    pg.evaluate(OFFER_INSTALL); time.sleep(0.3)
    r.check(text(pg, '.install-row button') == 'Install the app', 'account panel: the install button', text(pg, '.install-row'))
    pg.click('.account-foot button:has-text("Privacy")'); pg.wait_for_selector('.privacy-panel')
    r.check('Vercel Web Analytics' in pg.locator('.privacy-panel').inner_text(), 'account panel: the privacy page')
    pg.go_back(); time.sleep(0.5)
    r.check(pg.locator('.privacy-panel').count() == 0, 'Back closes the privacy page')
    if not pg.locator('.account-panel').count(): pg.click('.tabs .account-tab'); pg.wait_for_selector('.account-panel')
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
        tab(pg, 1); open_opening(pg, SICILIAN['id'])
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


# buttons a finger must hit (shorter than 44px), among the ones that can be seen now
SMALL_JS = """() => [...document.querySelectorAll('button, .account-panel a, .manage-row')].filter(e => e.offsetParent !== null && !e.disabled)
  .map(e => [e, e.getBoundingClientRect().height]).filter(([, h]) => h > 0 && h < 43.5)
  .map(([e, h]) => `${e.className || e.tagName}:${Math.round(h)}`)"""
BADGE_JS = """() => { const b = document.querySelector('.tabs .badge:not(.badge-dot)').getBoundingClientRect(), t = document.querySelector('.tabs .badge:not(.badge-dot)').closest('button');
  const i = t.querySelector('.tab-icon').getBoundingClientRect(), l = t.querySelector('.tab-label').getBoundingClientRect(), tb = t.getBoundingClientRect();
  const over = (x) => Math.max(0, Math.min(b.right, x.right) - Math.max(b.left, x.left)) * Math.max(0, Math.min(b.bottom, x.bottom) - Math.max(b.top, x.top));
  return { icon: over(i) / (i.width * i.height), label: over(l), inside: b.left >= tb.left - 1 && b.right <= tb.right + 1 && b.top >= tb.top }; }"""
SEED_JS = """(n) => { const l = []; for (let i = 0; i < n; i++) l.push({ fen: `r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - ${i} 3`,
  played: 'a3', correct: 'Bc4', source: 'book', repertoire: i < 15 ? 'london' : 'italian', at: 1, box: 0, due: i + 1 });
  localStorage.setItem('chess-trainer:mistakes', JSON.stringify(l)); localStorage.setItem('chess-trainer:guide-dismissed', 'true'); }"""


@section('touch')
def touch(b):
    """Phones: sizes for a finger, the badge, hidden openings in the practice, and the game review on a small screen."""
    # a first visit (the "How to learn here" card): nothing to tap is under the tab bar, and the line picker can be read
    UNDER_TABS = """() => { const t = document.querySelector('.tabs').getBoundingClientRect().top;
      return [...document.querySelectorAll('.learn button, .learn select, .learn a')].filter(e => e.offsetParent)
        .map(e => [e.className || e.tagName, e.getBoundingClientRect()]).filter(([, r]) => r.top < t - 0.5 && r.bottom > t + 0.5)
        .map(([c, r]) => `${c}:${Math.round(r.top)}-${Math.round(r.bottom)}`); }"""
    # the opening and line buttons: their name is cut with an ellipsis only when it does not fit
    PICKER = """() => [...document.querySelectorAll('.picker-btn-value')].map(e => [e.scrollWidth, e.clientWidth])"""
    # the very first visit: which openings do you play? Only those are shown; "Show all" keeps every one
    for locale, pick in (('en-US', True), ('he-IL', False)):
        ctx = b.new_context(locale=locale, viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True, first_visit=True)
        pg = ctx.new_page(); r.watch(pg, f'picker-{locale}'); pg.goto(a.url); pg.wait_for_selector('.opening-picker')
        all_chips = pg.locator('.opening-picker .chip').count()
        r.check(all_chips == len(data) and pg.locator('.opening-picker button.primary').is_disabled() and hscroll(pg) <= 0 and not pg.evaluate(SMALL_JS),
                f'first visit, {locale}: the opening picker, grouped, every opening once', f'{all_chips} of {len(data)}')
        r.shot(pg, f'picker-{locale}')
        if pick:
            pg.locator('.opening-picker .chip').nth(0).click(); pg.locator('.opening-picker .chip').nth(4).click()
            pg.click('.opening-picker button.primary'); time.sleep(0.5)
            pg.wait_for_selector('.opening-btn'); chips = shown_openings(pg)
            r.check(pg.locator('.opening-picker').count() == 0 and chips == 2 and pg.locator('.guide').count() == 1, f'first visit, {locale}: only the two chosen openings, then the guide', str(chips))
        else:
            pg.click('.opening-picker button.ghost'); time.sleep(0.5)
            pg.wait_for_selector('.opening-btn')
            r.check(shown_openings(pg) == len(data), f'first visit, {locale}: "Show all" keeps every opening')
        pg.reload(); pg.wait_for_selector('.learn .stepper')
        r.check(pg.locator('.opening-picker').count() == 0, f'first visit, {locale}: asked once')
        ctx.close()
    # "Not sure? Recommend for me": three openings for a beginner (White, vs 1.e4, vs 1.d4), and Learn opens on the first.
    # Every chip is readable: nothing cut (a long name wraps) and inside the screen; "Sicilian with ...e6" keeps its dots,
    # as "e6" alone would read as a White move
    CHIPS_JS = r"""() => [...document.querySelectorAll('.opening-picker .chip')].filter(c => c.scrollWidth > c.clientWidth + 1
      || c.getBoundingClientRect().left < -0.5 || c.getBoundingClientRect().right > innerWidth + 0.5
      || (c.dataset.rep === 'sicilian' && !c.textContent.includes('...e6'))).map(c => c.textContent)"""
    for locale in ('en-US', 'he-IL', 'es-ES'):
        for w, h in ((375, 812), (1280, 860)):
            ctx = b.new_context(locale=locale, viewport={'width': w, 'height': h}, is_mobile=w < 600, has_touch=w < 600, first_visit=True)
            pg = ctx.new_page(); r.watch(pg, f'recommend-{locale}-{w}'); pg.goto(a.url); pg.wait_for_selector('.opening-picker')
            rec = pg.locator('.recommend-btn')
            r.check(rec.is_visible() and rec.bounding_box()['y'] < h * 0.5 and not pg.evaluate(CHIPS_JS) and hscroll(pg) <= 0,
                    f'first visit, {locale}, {w}px: "recommend for me" near the top, every chip readable', str(pg.evaluate(CHIPS_JS)))
            r.shot(pg, f'recommend-{locale}-{w}')
            rec.click(); time.sleep(0.5); pg.wait_for_selector('.opening-btn')
            close_sheet(pg); pg.click('.opening-btn')
            reps = pg.eval_on_selector_all('.pick-sheet .sheet-row[data-rep]', 'e => e.map(x => x.dataset.rep)')
            current = pg.get_attribute('.pick-sheet .sheet-row.active', 'data-rep'); close_sheet(pg)
            r.check(reps == ['london', 'caro', 'slav'] and current == 'london' and pg.locator('.guide').count() == 1,
                    f'first visit, {locale}, {w}px: "recommend for me" shows the London, the Caro-Kann and the Slav, and opens the London', f'{reps} {current}')
            manage_openings(pg)
            hidden = pg.locator('.manage-row input:not(:checked)').count()
            r.check(hidden == len(data) - 3, f'  the other openings are hidden, not deleted ({locale}, {w}px)', str(hidden))
            ctx.close()
    for locale in ('en-US', 'he-IL', 'es-ES'):
        ctx, pg = open_page(b, f'first-{locale}', locale, 375, 812)
        pg.wait_for_selector('.learn .stepper'); time.sleep(0.8)
        r.check(pg.locator('.guide').count() == 1 and not pg.evaluate(UNDER_TABS), f'first visit, {locale}, 375x812: nothing to tap under the tab bar', str(pg.evaluate(UNDER_TABS)))
        sizes = pg.evaluate(PICKER)
        r.check(sizes[0][0] <= sizes[0][1], f'first visit, {locale}: the opening button shows the whole name', str(sizes))
        r.shot(pg, f'first-{locale}')
        ctx.close()
    for tag, locale, w, h in [('touch-he', 'he-IL', 375, 667), ('touch-en', 'en-US', 360, 740)]:
        ctx, pg = open_page(b, tag, locale, w, h)
        pg.evaluate(SEED_JS, 235); pg.reload(); pg.wait_for_selector('.tabs')
        badge = lambda: int(pg.locator('.tabs .badge:not(.badge-dot)').inner_text()) if pg.locator('.tabs .badge:not(.badge-dot)').count() else 0
        r.check(badge() == 20, f'{tag}: 235 positions are due, the badge shows today\'s 20', str(badge()))
        o = pg.evaluate(BADGE_JS)
        r.check(o['icon'] < 0.2 and o['label'] == 0 and o['inside'], f'{tag}: the badge does not hide the icon', str(o))
        for i, name in [(0, 'Play'), (1, 'Learn'), (3, 'Practice')]:
            tab(pg, i); time.sleep(1.5)
            small = pg.evaluate(SMALL_JS)
            r.check(not small, f'{tag}: {name} has no button too small for a finger', f'{len(small)}: {sorted(set(small))[:6]}')
            r.check(hscroll(pg) <= 0, f'{tag}: {name} has no horizontal scroll')
            r.shot(pg, f'{tag}-{name}')
        tab(pg, 1); time.sleep(0.8)
        end = pg.evaluate("document.querySelector('.learn .stepper').getBoundingClientRect().bottom")
        bar = pg.evaluate("document.querySelector('.tabs').getBoundingClientRect().top")
        r.check(end + 40 <= bar, f'{tag}: Learn shows the step buttons and the start of the explanation without scrolling', f'{end:.0f} / {bar:.0f}')

        # hidden openings leave the practice and come back
        manage_openings(pg); box = pg.locator('.manage-row[data-rep="london"] input')
        time.sleep(0.3)
        small = pg.evaluate(SMALL_JS)
        r.check(not small, f'{tag}: the list of openings has no row too small for a finger', f'{len(small)}: {sorted(set(small))[:6]}')
        box.uncheck(); time.sleep(0.5); pg.keyboard.press('Escape'); time.sleep(0.3)
        r.check(pg.evaluate("document.querySelector('.today').innerText.includes('20')"), f'{tag}: also in "today"', pg.locator('.today').inner_text()[:60].replace('\n', ' '))
        tab(pg, 0); time.sleep(0.5)
        r.check(re.search(r'220', pg.locator('.trainer aside').inner_text()) is not None, f'{tag}: and in Play')
        tab(pg, 3); pg.locator('.segmented:not(.games-site) button').nth(1).click(); time.sleep(0.8)
        r.check('20' in pg.locator('.status').last.inner_text() and 'London' not in pg.locator('main').last.inner_text() and '\u05dc\u05d5\u05e0\u05d3\u05d5\u05df' not in pg.locator('main').last.inner_text(),
                f'{tag}: the practice starts with an opening that is shown', pg.locator('main').last.inner_text()[-120:].replace('\n', ' '))
        stored = pg.evaluate("JSON.parse(localStorage.getItem('chess-trainer:mistakes')).length")
        r.check(stored == 235, f'{tag}: nothing was deleted', str(stored))
        pg.evaluate("""() => { const l = JSON.parse(localStorage.getItem('chess-trainer:mistakes')).filter(m => m.repertoire === 'london');
          localStorage.setItem('chess-trainer:mistakes', JSON.stringify(l)); }""")
        pg.reload(); pg.wait_for_selector('.tabs'); tab(pg, 3); pg.locator('.segmented:not(.games-site) button').nth(1).click(); time.sleep(0.8)
        r.check(pg.locator('.drill-empty').count() == 1 and '15' in pg.locator('.drill-empty').inner_text() and pg.locator('.drill-empty p').count() == 1, f'{tag}: only hidden ones left: the empty screen says so',
                pg.locator('.drill-empty').inner_text()[:120].replace('\n', ' ') if pg.locator('.drill-empty').count() else 'not empty')
        tab(pg, 1); time.sleep(0.5)
        manage_openings(pg); pg.locator('.manage-row[data-rep="london"] input').check(); time.sleep(0.5); pg.keyboard.press('Escape')
        r.check(badge() == 15, f'{tag}: showing the opening brings them back', str(badge()))

        # account panel
        if pg.locator('.account-tab').count():
            pg.click('.account-tab'); time.sleep(0.4)
            small = pg.evaluate(SMALL_JS)
            r.check(not small, f'{tag}: account has no button too small for a finger', f'{len(small)}: {sorted(set(small))[:6]}')
            pg.locator('.account-panel .icon-btn').click()

        # My review and the game review
        tab(pg, 2); pg.fill('.review input', a.chesscom); pg.locator('.review button.primary').first.click()
        pg.wait_for_selector('.recent-game', timeout=180000); time.sleep(1)
        small = pg.evaluate(SMALL_JS)
        r.check(not small, f'{tag}: My review has no button too small for a finger', f'{len(small)}: {sorted(set(small))[:6]}')
        r.check(hscroll(pg) <= 0, f'{tag}: My review has no horizontal scroll')
        pg.locator('.recent-game').first.click(); pg.wait_for_selector('.game-review')
        pg.evaluate('scrollTo(0, 0)')
        for _ in range(9): pg.locator('.stepper button.primary').click()
        time.sleep(0.5)
        box = pg.evaluate("""() => { const t = (q) => document.querySelector(q).getBoundingClientRect();
          return { coach: t('.game-review .coach').bottom, bar: t('.tabs').top, board: t('.game-review .review-board').width, head: t('.game-review-head').height, scroll: scrollY }; }""")
        r.check(box['coach'] <= box['bar'] and box['scroll'] == 0, f'{tag}: game review shows the whole coach card without scrolling', str(box))
        info = pg.locator('.game-review-info').inner_text()
        r.check(not re.search(r'\d+[./]\d+[./]\d{2,4}', info) and  # no date (a name may have digits)
                pg.evaluate("(() => { const e = document.querySelector('.game-review-info'); return e.scrollWidth <= e.clientWidth + 1; })()"), f'{tag}: the opponent is not cut', info)
        r.check(box['board'] >= 260, f'{tag}: and the board is still big', str(box['board']))
        small = pg.evaluate(SMALL_JS)
        r.check(not small, f'{tag}: game review has no button too small for a finger', f'{len(small)}: {sorted(set(small))[:6]}')
        r.check(hscroll(pg) <= 0, f'{tag}: game review has no horizontal scroll')
        r.shot(pg, f'{tag}-game-review')
        ctx.close()


@section('lang')
def languages(b):
    """Spanish: chosen by the browser, every screen, kept after a reload, offline, and what happens when its texts cannot load."""
    src = (pathlib.Path(__file__).resolve().parents[2] / 'src/lang/es.ts').read_text(encoding='utf-8')
    # English sentences that must not show (explanations of openings stay English, so only the interface's own texts)
    english = [k for k in re.findall(r"^  '([^'{]+)':", src, re.M) if len(k.split()) >= 3]
    left = lambda pg: [k for k in english if k in pg.evaluate('document.body.innerText')]
    # a link's language wins over the browser's, is kept, and leaves the address bar (the other parameters stay)
    ctx, pg = open_page(b, 'lang-link', 'en-US', 1280, 900, a.url.rstrip('/') + '/?lang=he&utm_source=facebook#x')
    time.sleep(0.5)
    r.check(pg.evaluate('document.documentElement.lang') == 'he' and pg.evaluate('location.search + location.hash') == '?utm_source=facebook#x',
            'a link with ?lang=he: Hebrew, and only the other parameters stay', pg.evaluate('location.href'))
    pg.goto(a.url); pg.wait_for_selector('.tabs')
    r.check(pg.evaluate('document.documentElement.lang') == 'he', 'the language of the link is kept')
    pg.goto(a.url.rstrip('/') + '/?lang=xx'); pg.wait_for_selector('.tabs')
    r.check(pg.evaluate('document.documentElement.lang') == 'he' and pg.evaluate('location.search') == '', 'an unknown ?lang= changes nothing, and is removed too')
    ctx.close()
    for tag, w, h in [('es-desktop', 1280, 900), ('es-phone', 360, 740)]:
        ctx, pg = open_page(b, tag, 'es-MX', w, h)
        r.check(pg.evaluate('document.documentElement.lang + document.documentElement.dir') == 'esltr', f'{tag}: a Spanish browser gets Spanish')
        r.check('ajedrez' in pg.title(), f'{tag}: title', pg.title())
        for i, name in enumerate(['play', 'learn', 'review', 'practice']):
            tab(pg, i); time.sleep(2 if i != 3 else 4)
            r.check(not left(pg) and hscroll(pg) <= 0, f'{tag}: {name} is in Spanish and fits', f'{left(pg)[:4]} scroll {hscroll(pg)}')
            r.shot(pg, f'{tag}-{name}')
        cut = pg.evaluate("[...document.querySelectorAll('.tabs .tab-label')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().height > 22).map(e => e.innerText)")
        r.check(not cut, f'{tag}: the tab names fit', str(cut))
        tab(pg, 1); time.sleep(0.5)
        r.check('están en inglés' in pg.locator('.learn').inner_text(), f'{tag}: Learn says the explanations are in English')
        tab(pg, 3); pg.locator('.segmented:not(.games-site) button').nth(1).click(); time.sleep(0.5)
        r.check('Nada que repasar' in pg.inner_text('body') and not left(pg), f'{tag}: my mistakes', str(left(pg)[:4]))
        if tag == 'es-desktop':
            tab(pg, 2); pg.fill('.review input', a.chesscom); pg.locator('.review button.primary').first.click()
            pg.wait_for_selector('.recent-game', timeout=180000); time.sleep(2)
            r.check(not left(pg) and 'Desconocida' not in text(pg, '.strengths'), f'{tag}: the whole review is in Spanish', str(left(pg)[:6]))
            pg.screenshot(path=str(SHOTS / f'{tag}-review-full.png'), full_page=True)
            pg.locator('.recent-game').first.click(); pg.wait_for_selector('.game-review')
            for _ in range(3): pg.locator('.stepper button.primary').click()
            r.check(wait_until(lambda: 'Aún se está analizando' not in text(pg, '.coach'), 30) and not left(pg), f'{tag}: game review', f"{text(pg, '.coach')[:90]} {left(pg)[:4]}")
            r.shot(pg, f'{tag}-game-review')
        ctx.close()

    # switching, and keeping the choice
    ctx, pg = open_page(b, 'es-switch', 'en-US', 1280, 900)
    asked = []
    pg.on('request', lambda q: asked.append(q.url) if '/assets/es-' in q.url else None)
    pg.reload(); pg.wait_for_selector('.tabs'); pg.wait_for_timeout(500)
    r.check(not asked and pg.evaluate('document.documentElement.lang') == 'en', 'English does not download the Spanish texts', str(len(asked)))
    pick_lang(pg, 'es'); pg.wait_for_function("document.documentElement.lang === 'es'")
    r.check('Aprender' in pg.inner_text('.tabs'), 'switching to Spanish')
    pg.reload(); pg.wait_for_selector('.tabs')
    r.check('Aprender' in pg.inner_text('.tabs'), 'Spanish is kept after a reload')
    pick_lang(pg, 'he'); pg.wait_for_function("document.documentElement.dir === 'rtl'")
    pick_lang(pg, 'en'); pg.wait_for_function("document.documentElement.lang === 'en'")
    r.check('Learn' in pg.inner_text('.tabs'), 'and back through Hebrew to English')
    ctx.close()

    # the Spanish texts cannot be loaded: the app works in English
    ctx = b.new_context(locale='es-ES', viewport={'width': 1280, 'height': 900}, service_workers='block'); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    ctx.route('**/assets/es-*.js', lambda route: route.abort())
    pg.goto(a.url); pg.wait_for_selector('.tabs', timeout=15000)
    r.check('Learn' in pg.inner_text('.tabs') and not errs, 'without the Spanish file the app opens in English', str(errs))
    ctx.close()

    # offline after one visit
    ctx, pg = open_page(b, 'es-offline', 'es-ES', 1280, 900)
    pg.evaluate('navigator.serviceWorker.ready.then(() => true)'); time.sleep(3)
    pg.reload(); pg.wait_for_selector('.tabs'); time.sleep(2)
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector('.tabs')
    r.check('Aprender' in pg.inner_text('.tabs'), 'Spanish works offline')
    ctx.close()


@section('fonts')
def fonts(b):
    """Heebo is served from the site itself: no request leaves it on load, and Hebrew and Latin are drawn in Heebo."""
    from urllib.parse import urlparse
    host = urlparse(a.url).netloc
    FONT_JS = r"""() => { const c = document.createElement('canvas').getContext('2d'), out = {};
      for (const w of [400, 500, 700]) for (const [k, t] of [['he', '\u05e4\u05ea\u05d9\u05d7\u05d5\u05ea \u05e9\u05dc\u05d5\u05de\u05d3\u05d9\u05dd \u05e6\u05e2\u05d3 \u05d0\u05d7\u05e8 \u05e6\u05e2\u05d3'], ['en', 'Openings you learn step by step']]) {
        c.font = `${w} 16px Heebo, monospace`; const heebo = c.measureText(t).width; c.font = `${w} 16px monospace`;
        out[`${k}${w}`] = document.fonts.check(`${w} 16px Heebo`, t) && Math.abs(heebo - c.measureText(t).width) > 1; }
      const files = performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.woff2?($|\?)/.test(n));
      return { out, files }; }"""
    for locale, lang in (('he-IL', 'he'), ('en-US', 'en')):
        for w, h in ((390, 844), (1280, 860)):
            ctx = b.new_context(locale=locale, viewport={'width': w, 'height': h}, is_mobile=w < 600, has_touch=w < 600)
            pg = ctx.new_page(); r.watch(pg, f'fonts-{lang}-{w}'); away = []
            pg.on('request', lambda q: urlparse(q.url).netloc not in (host, '') and away.append(q.url[:80]))
            pg.goto(a.url); pg.wait_for_selector('.tabs', timeout=60000); pg.evaluate('document.fonts.ready'); time.sleep(1)
            res = pg.evaluate(FONT_JS)
            want = [k for k in res['out'] if k.startswith(lang)]
            r.check(not away, f'fonts, {lang}, {w}px: no request leaves the site on load', str(away[:5]))
            r.check(all(res['out'][k] for k in want) and res['files'] and all(urlparse(f).netloc == host for f in res['files']),
                    f'fonts, {lang}, {w}px: drawn in Heebo (400/500/700), served from the site', str(res))
            ctx.close()


@section('refresh')
def refresh(b):
    """A mastered line comes back to be tested after a few days: "Refresh 1 line" in Today, a mark in the line list,
    the button starts the test at once, and a clean test sends it away again (for 7 days)."""
    lon = data[0]; day = 24 * 3600 * 1000
    now = int(time.time() * 1000)
    m = {lon['id']: {lon['lines'][1]['id']: {'tries': 1, 'clean': 1, 'last': 0, 'at': now - 4 * day, 'streak': 1},
                     lon['lines'][0]['id']: {'tries': 1, 'clean': 0, 'last': 2, 'at': now - 9 * day, 'streak': 0},
                     lon['lines'][2]['id']: {'tries': 2, 'clean': 2, 'last': 0, 'at': now - 4 * day, 'streak': 2}}}
    ctx = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
                        f"localStorage.setItem('chess-trainer:mastery', {json.dumps(json.dumps(m))});"
                        "localStorage.setItem('chess-trainer:openings-chosen', 'true'); localStorage.setItem('chess-trainer:guide-dismissed', 'true');"
                        "localStorage.setItem('chess-trainer:screen', '\"learn\"'); }")
    pg = ctx.new_page(); r.watch(pg, 'refresh'); pg.goto(a.url); pg.wait_for_selector('.learn-header', timeout=60000)
    btn = pg.locator('.today .refresh-lines')
    r.check(btn.count() == 1 and 'Refresh 1 line' in btn.inner_text(), 'refresh: Today offers the one line that is due (not the one to learn, not the one tested recently)', text(pg, '.today'))
    open_opening(pg, lon['id'])
    pg.click('.line-btn')
    marks = pg.locator('.pick-sheet .sheet-line')
    due = [i for i in range(marks.count()) if marks.nth(i).locator('.refresh-mark').count()]
    r.check(due == [1], 'refresh: the line list marks it', str(due))
    close_sheet(pg)
    pg.click('.today .refresh-lines'); time.sleep(0.8)
    n = len(lon['lines'][1]['uci'])
    r.check(current_line(pg) == 1 and pg.locator(f'.pill:text-is("Test · 0/{n}")').count() == 1, 'refresh: the button opens the line and starts its test')
    for k, u in enumerate(lon['lines'][1]['uci']):
        if k % 2: continue
        pg.wait_for_selector(f'.pill:text-is("Test · {k}/{n}")', timeout=8000)
        pg.click(f'.learn .board [data-square="{u[:2]}"]'); pg.click(f'.learn .board [data-square="{u[2:4]}"]')
    r.check(wait_until(lambda: pg.locator('.card.notice.tone-ok').count() == 1, 10), 'refresh: the test is passed')
    pg.click('.actions button:has-text("Back to study")'); time.sleep(0.4)
    rec = pg.evaluate(f"JSON.parse(localStorage.getItem('chess-trainer:mastery'))[{json.dumps(lon['id'])}][{json.dumps(lon['lines'][1]['id'])}]")
    r.check(pg.locator('.today .refresh-lines').count() == 0 and rec['streak'] == 2, 'refresh: a clean test sends it away, two clean in a row', str(rec))
    ctx.close()


@section('share')
def share(b):
    """"Share this line": a link copied on a desktop opens the same line in Learn for someone else, without the first
    question of which openings to play, also when that opening is hidden there; the parameter leaves the address bar."""
    lon, caro = data[0], next(x for x in data if x['id'] == 'caro')
    ctx = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    ctx.add_init_script("localStorage.setItem('chess-trainer:openings-chosen', 'true'); localStorage.setItem('chess-trainer:guide-dismissed', 'true')")
    pg = ctx.new_page(); r.watch(pg, 'share'); pg.goto(a.url); pg.wait_for_selector('.tabs', timeout=60000)
    pg.click('.tabs [data-tab=learn]'); open_opening(pg, lon['id']); pick_line(pg, 2)
    pg.click('.share-line button')
    r.check(wait_until(lambda: 'Link copied' in text(pg, '.share-line'), 5), 'share: the link is copied', text(pg, '.share-line'))
    url = pg.evaluate('navigator.clipboard.readText()')
    r.check(f"line={lon['id']}%2F" in url, 'share: the link names the opening and the line', url)
    open_opening(pg, caro['id']); pick_line(pg, 1); pg.click('.share-line button'); time.sleep(0.3)
    caro_url = pg.evaluate('navigator.clipboard.readText()')
    ctx.close()
    # someone else, on a first visit (Play was their last tab: the link still opens Learn)
    ctx = b.new_context(locale='en-US', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script("if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.setItem('chess-trainer:screen', '\"play\"'); }")
    pg = ctx.new_page(); r.watch(pg, 'share-friend'); pg.goto(url + '&utm_source=test'); pg.wait_for_selector('.tabs', timeout=60000); time.sleep(0.5)
    r.check(pg.locator('.opening-picker').count() == 0 and pg.locator('.learn-header').count() == 1, 'share: a first visit from the link skips the opening question and shows Learn')
    r.check(lon['id'] and current_line(pg) == 2 and pg.locator(f'.pick-sheet').count() == 0, 'share: the same line is open', str(current_line(pg)))
    r.check('line=' not in pg.url and 'utm_source=test' in pg.url, 'share: the parameter leaves the address bar, the others stay', pg.url)
    ctx.close()
    # the opening is hidden on the device that opens the link: it is shown again
    ctx = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.setItem('chess-trainer:openings-chosen', 'true');"
                        "localStorage.setItem('chess-trainer:guide-dismissed', 'true'); localStorage.setItem('chess-trainer:hidden-repertoires', JSON.stringify(['caro'])); }")
    pg = ctx.new_page(); r.watch(pg, 'share-hidden'); pg.goto(caro_url); pg.wait_for_selector('.learn-header', timeout=60000); time.sleep(0.5)
    r.check(caro['lines'][1]['name'][:12] in text(pg, '.line-btn') and current_line(pg) == 1 and 'Caro' in text(pg, '.opening-btn'),
            'share: a hidden opening is shown again for the link', text(pg, '.opening-btn') + ' | ' + text(pg, '.line-btn'))
    pg.goto(a.url + '?line=nothing%2Fhere'); pg.wait_for_selector('.tabs', timeout=60000)
    r.check('line=' not in pg.url, 'share: a link to a line that does not exist opens the app as usual', pg.url)
    ctx.close()


@section('lichess')
def lichess(b):
    """Games from Lichess, against a stand-in for its API (no network; Lichess also refuses headless browsers): the site
    switch keeps a username for each site, the games load and are reviewed, the next load asks only for new games, and
    an unknown user gets a clear message."""
    day = 24 * 3600 * 1000; now = int(time.time() * 1000)
    def game(i, white, black, winner, opening, moves, speed='blitz', acc=None):
        pl = lambda n, r: {'user': {'name': n, 'id': n.lower()}, 'rating': r}
        g = {'id': f'qa{i:06d}', 'rated': True, 'variant': 'standard', 'speed': speed, 'createdAt': now - (10 - i) * day, 'lastMoveAt': now - (10 - i) * day + 600000,
             'status': 'resign' if winner else 'draw', 'players': {'white': pl(*white), 'black': pl(*black)},
             'opening': {'eco': 'A00', 'name': opening}, 'pgn': f'[Event "Rated blitz game"]\n[Site "https://lichess.org/qa{i:06d}"]\n\n{moves} *'}
        if winner: g['winner'] = winner
        if acc: g['players']['white']['analysis'] = {'accuracy': acc}
        return g
    me, opp = ('QaPlayer', 1500), ('Rival', 1480)
    first = [game(1, me, opp, 'white', "Queen's Pawn Game: London System", '1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 5. c3 Nc6', acc=81),
             game(2, opp, me, 'black', 'Caro-Kann Defense: Advance Variation', '1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5', speed='rapid'),
             game(3, me, opp, None, 'Italian Game: Two Knights Defense', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Be7 5. O-O O-O')]
    later = [game(4, opp, me, 'white', 'Sicilian Defense: Najdorf Variation', '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6')]
    asked = []
    def api(route):
        url = route.request.url; asked.append(url)
        if '/api/user/nobody' in url: return route.fulfill(status=404, body='{"error":"Not found"}', headers={'access-control-allow-origin': '*'})
        if '/api/user/' in url: return route.fulfill(status=200, body=json.dumps({'id': 'qaplayer', 'count': {'all': 3 + (len(asked) > 4)}}), headers={'access-control-allow-origin': '*', 'content-type': 'application/json'})
        games = later if 'since=' in url else first
        return route.fulfill(status=200, body=''.join(json.dumps(g) + '\n' for g in reversed(games)), headers={'access-control-allow-origin': '*', 'content-type': 'application/x-ndjson'})
    ctx = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("localStorage.setItem('chess-trainer:openings-chosen', 'true')")
    ctx.route('https://lichess.org/api/**', api)
    pg = ctx.new_page(); r.watch(pg, 'lichess')
    pg.goto(a.url); pg.wait_for_selector('.tabs', timeout=60000); pg.click('[data-tab=review]'); time.sleep(0.5)
    pg.click('.games-site button:has-text("Lichess")')
    r.check(pg.input_value('.search input') == '' and 'Your Lichess username' in text(pg, '.search label'), 'lichess: the site switch, with its own (empty) username')
    pg.fill('.search input', 'QaPlayer'); pg.click('.search button.primary')
    r.check(wait_until(lambda: pg.locator('.recent-game').count() == 3, 20), 'lichess: three games loaded', str(pg.locator('.recent-game').count()))
    games_q = next((u for u in asked if '/api/games/user/qaplayer' in u), '')
    r.check('pgnInJson=true' in games_q and 'opening=true' in games_q and 'since=' not in games_q, 'lichess: the first load asks for the games with their openings', games_q)
    txt = pg.locator('.review').inner_text()
    r.check('Your openings as White' in txt and 'London System' in txt and 'Caro Kann Defense' in txt, 'lichess: the review, with the openings named the same way as on Chess.com', txt[:200])
    pg.click('.games-site button:has-text("Chess.com")'); time.sleep(0.5)
    r.check(pg.input_value('.search input') == '' and pg.locator('.recent-game').count() == 0, 'lichess: Chess.com keeps its own (empty) username')
    pg.click('.games-site button:has-text("Lichess")')
    r.check(wait_until(lambda: pg.locator('.recent-game').count() == 4, 20), 'lichess: back on Lichess, the kept games and the new one', str(pg.locator('.recent-game').count()))
    r.check(any('since=' in u for u in asked if '/api/games/user/' in u), 'lichess: the next load asks only for games since the last one')
    pg.locator('.recent-game').first.click(); time.sleep(2)
    r.check('Lichess' in text(pg, '.game-review-head a'), 'lichess: a game review links to Lichess', text(pg, '.game-review-head a'))
    pg.click('.game-review-head button'); time.sleep(0.5)
    pg.fill('.search input', 'nobody'); pg.click('.search button.primary')
    r.check(wait_until(lambda: 'No Lichess user with this name.' in text(pg, '.review .notice'), 10), 'lichess: an unknown user', text(pg, '.review .notice'))
    r.errors[:] = [e for e in r.errors if not (e.startswith('[lichess]') and '404' in e)]  # the browser logs the 404 of the unknown user
    ctx.close()
    # a phone, in Hebrew: the switch fits
    ctx = b.new_context(locale='he-IL', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script("localStorage.setItem('chess-trainer:openings-chosen', 'true')")
    pg = ctx.new_page(); r.watch(pg, 'lichess-phone'); pg.goto(a.url + '?lang=he'); pg.wait_for_selector('.tabs', timeout=60000); pg.click('[data-tab=review]'); time.sleep(0.5)
    box = pg.locator('.games-site').bounding_box()
    r.check(box and box['x'] >= 0 and box['x'] + box['width'] <= 390 and not hscroll(pg), 'lichess: the site switch fits a phone', str(box))
    r.shot(pg, 'lichess-phone-he')
    ctx.close()


@section('a11y')
def a11y(b):
    """The board for screen readers and the keyboard: every square is a named button, one Tab stop for the board (the
    pieces' drag handles are out of the Tab order), the arrows move between squares as shown, Enter taps: a line is
    played in "Test me" and a move against the computer, with the keyboard alone; the last move is announced."""
    ctx = b.new_context(locale='en-US', viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("localStorage.setItem('chess-trainer:openings-chosen', 'true'); localStorage.setItem('chess-trainer:guide-dismissed', 'true')")
    pg = ctx.new_page(); r.watch(pg, 'a11y'); pg.goto(a.url); pg.wait_for_selector('.learn-header', timeout=60000)
    open_opening(pg, data[0]['id']); pick_line(pg, 0)
    info = pg.evaluate("""() => { const b = document.getElementById('learn-board'), sq = [...b.querySelectorAll('[data-square]')];
      return { role: b.getAttribute('role'), label: b.getAttribute('aria-label'), n: sq.filter(s => s.getAttribute('role') === 'button').length,
        stops: sq.filter(s => s.tabIndex === 0).length, handles: [...b.querySelectorAll('[aria-roledescription]')].filter(h => h.tabIndex >= 0).length,
        e1: document.querySelector('#learn-board [data-square=e1]').getAttribute('aria-label'), e4: document.querySelector('#learn-board [data-square=e4]').getAttribute('aria-label') } }""")
    r.check(info['role'] == 'group' and info['label'] == 'Chess board' and info['n'] == 64 and info['stops'] == 1 and info['handles'] == 0,
            'a11y: 64 named squares, one Tab stop, no drag handle in the Tab order', str(info))
    r.check(info['e1'] == 'e1, white king' and info['e4'] == 'e4, empty', 'a11y: a square says its piece', str(info))
    pg.click('.actions button:has-text("Test me on this line")'); time.sleep(0.8)
    def key_move(board, frm, to):
        pg.evaluate(f"document.querySelector('#{board}-board [data-square={frm}]').focus()"); pg.keyboard.press('Enter')
        f, t = 'abcdefgh'.index(frm[0]) - 'abcdefgh'.index(to[0]), int(to[1]) - int(frm[1])
        white = pg.evaluate(f"document.querySelector('#{board}-board [data-square]').dataset.square") == 'a8'
        for _ in range(abs(f)): pg.keyboard.press(('ArrowLeft' if f > 0 else 'ArrowRight') if white else ('ArrowRight' if f > 0 else 'ArrowLeft'))
        for _ in range(abs(t)): pg.keyboard.press(('ArrowUp' if t > 0 else 'ArrowDown') if white else ('ArrowDown' if t > 0 else 'ArrowUp'))
        here = pg.evaluate("document.activeElement.dataset.square")
        pg.keyboard.press('Enter')
        return here
    u = data[0]['lines'][0]['uci'][0]
    here = key_move('learn', u[:2], u[2:4])
    r.check(here == u[2:4] and wait_until(lambda: pg.locator('.pill:text-is("Test · 2/%d")' % len(data[0]['lines'][0]['uci'])).count() == 1, 5),
            'a11y: "Test me" played with the arrows and Enter (the line goes on)', here)
    r.check(wait_until(lambda: 'Last move:' in pg.locator('#learn-board ~ .sr-only, .learn .sr-only').first.inner_text(), 3), 'a11y: the last move is announced',
            pg.locator('.learn .sr-only').first.inner_text())
    # the arrows on the board do not step the line (they move between squares)
    pg.click('.actions button:has-text("Back to study")'); time.sleep(0.4)
    head = text(pg, '.learn-move-head')
    pg.evaluate("document.querySelector('#learn-board [data-square=e2]').focus()"); pg.keyboard.press('ArrowRight')
    r.check(text(pg, '.learn-move-head') == head and pg.evaluate("document.activeElement.dataset.square") == 'f2', 'a11y: on the board, an arrow moves to the next square, not to the next move')
    # Play: a move against the computer with the keyboard
    pg.click('[data-tab=play]'); time.sleep(1)
    sel = pg.locator('.controls select'); sel.nth(0).select_option('play'); sel.nth(1).select_option('w'); time.sleep(1)
    key_move('trainer', 'e2', 'e4')
    black = "[...document.querySelectorAll('#trainer-board [data-piece]')].filter(e => e.dataset.piece[0]==='b').map(e => e.closest('[data-square]').dataset.square).sort().join()"
    r.check(wait_until(lambda: pg.evaluate("document.querySelector('#trainer-board [data-square=e4]').getAttribute('aria-label')") == 'e4, white pawn'
                       and pg.evaluate(black) != 'a7,a8,b7,b8,c7,c8,d7,d8,e7,e8,f7,f8,g7,g8,h7,h8', 30), 'a11y: Play: 1.e4 with the keyboard, and the computer answers')
    ctx.close()


@section('offline')
def offline(b):
    ctx, pg = open_page(b, 'offline', 'en-US', 1280, 900)
    pg.evaluate('navigator.serviceWorker ? navigator.serviceWorker.ready.then(() => true) : false')
    # Practice is not opened before going offline: the puzzle file is kept by itself a while after the first visit
    kept = r"caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(l => l.flat().some(q => /puzzles-v\d+\.json/.test(q.url)))"
    r.check(wait_until(lambda: pg.evaluate(kept), 40), 'offline: the puzzle file is kept after the first visit, without opening Practice')
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
    r.check(shown_openings(pg) > 1, 'offline: Learn')
    r.check(pg.evaluate("document.fonts.ready.then(() => document.fonts.check('700 16px Heebo', 'Learn'))"), 'offline: the font (Heebo) is there')
    ctx.close()


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = open_page(b, 'desktop-en', 'en-US', 1280, 900)
    if not a.only: tour(pg, 'desktop-en')
    learn(pg); mistakes(pg); puzzles(pg); review(pg)  # mistakes first: the puzzle section adds its own
    ctx.close()
    install(b); privacy(b); account(b); refresh(b); share(b); lichess(b); a11y(b); phone(b); touch(b); languages(b); fonts(b); offline(b)
    b.close()
r.done()

"""QA: Learn extras, Practice (puzzles, my mistakes), My review, account and language, phone layouts, offline.

    python scripts/qa/screens.py [--url URL] [--only learn,puzzles,mistakes,review,account,phone,touch,lang,offline]
                                 [--chesscom USER] [--account-url URL]

The review section loads real games from Chess.com; the account panel needs a build with Firebase configured,
so by default it is checked on the live site.
"""
import json, os, pathlib, re, sys, time
from playwright.sync_api import sync_playwright
from common import LIVE, SHOTS, Report, args, hscroll, lines, puzzles_by_board, wait_until


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
        got = pg.locator('button:has-text("Got it"), button:has-text("\u05d4\u05d1\u05e0\u05ea\u05d9")')
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
    r.check(pg.locator('.tabs .badge').count() == 0 and '5 more positions are waiting' in text(pg, '.drill-empty'), 'after 20 positions today the practice is done for the day', text(pg, '.drill-empty'))
    pg.click('.drill-empty button:has-text("Keep going")'); time.sleep(0.8)
    r.check('5 left' in text(pg, '.status:visible'), '"Keep going" brings the ones that wait', text(pg, '.status:visible'))


@section('review')
def review(pg):
    pg.click('.tabs .tab:has-text("My review")')
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
    pg.reload(); pg.click('.tabs .tab:has-text("My review")')
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


# buttons a finger must hit (shorter than 44px), among the ones that can be seen now
SMALL_JS = """() => [...document.querySelectorAll('button, .account-panel a, .manage-row')].filter(e => e.offsetParent !== null && !e.disabled)
  .map(e => [e, e.getBoundingClientRect().height]).filter(([, h]) => h > 0 && h < 43.5)
  .map(([e, h]) => `${e.className || e.tagName}:${Math.round(h)}`)"""
BADGE_JS = """() => { const b = document.querySelector('.tabs .badge').getBoundingClientRect(), t = document.querySelector('.tabs .badge').closest('button');
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
    PICKER = """() => { const s = document.querySelector('.learn-header select'), c = document.createElement('canvas').getContext('2d');
      c.font = getComputedStyle(s).font; return [Math.round(c.measureText(s.options[s.selectedIndex].text).width), Math.round(s.getBoundingClientRect().width)]; }"""
    for locale in ('en-US', 'he-IL', 'es-ES'):
        ctx, pg = open_page(b, f'first-{locale}', locale, 375, 812)
        pg.wait_for_selector('.learn .stepper'); time.sleep(0.8)
        r.check(pg.locator('.guide').count() == 1 and not pg.evaluate(UNDER_TABS), f'first visit, {locale}, 375x812: nothing to tap under the tab bar', str(pg.evaluate(UNDER_TABS)))
        text, width = pg.evaluate(PICKER)
        r.check(text + 40 <= width, f'first visit, {locale}: the line picker shows the whole name', f'{text}px of text in {width}px')
        r.shot(pg, f'first-{locale}')
        ctx.close()
    for tag, locale, w, h in [('touch-he', 'he-IL', 375, 667), ('touch-en', 'en-US', 360, 740)]:
        ctx, pg = open_page(b, tag, locale, w, h)
        pg.evaluate(SEED_JS, 235); pg.reload(); pg.wait_for_selector('.tabs')
        badge = lambda: int(pg.locator('.tabs .badge').inner_text()) if pg.locator('.tabs .badge').count() else 0
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
        pg.click('.manage-chip'); box = pg.locator('.manage-row input[type="checkbox"]').nth([x['id'] for x in data].index('london'))
        time.sleep(0.3)
        small = pg.evaluate(SMALL_JS)
        r.check(not small, f'{tag}: the list of openings has no row too small for a finger', f'{len(small)}: {sorted(set(small))[:6]}')
        box.uncheck(); time.sleep(0.5)
        r.check(pg.evaluate("document.querySelector('.today').innerText.includes('20')"), f'{tag}: also in "today"', pg.locator('.today').inner_text()[:60].replace('\n', ' '))
        tab(pg, 0); time.sleep(0.5)
        r.check(re.search(r'220', pg.locator('.trainer aside').inner_text()) is not None, f'{tag}: and in Play')
        tab(pg, 3); pg.locator('.segmented button').nth(1).click(); time.sleep(0.8)
        r.check('20' in pg.locator('.status').last.inner_text() and 'London' not in pg.locator('main').last.inner_text() and '\u05dc\u05d5\u05e0\u05d3\u05d5\u05df' not in pg.locator('main').last.inner_text(),
                f'{tag}: the practice starts with an opening that is shown', pg.locator('main').last.inner_text()[-120:].replace('\n', ' '))
        stored = pg.evaluate("JSON.parse(localStorage.getItem('chess-trainer:mistakes')).length")
        r.check(stored == 235, f'{tag}: nothing was deleted', str(stored))
        pg.evaluate("""() => { const l = JSON.parse(localStorage.getItem('chess-trainer:mistakes')).filter(m => m.repertoire === 'london');
          localStorage.setItem('chess-trainer:mistakes', JSON.stringify(l)); }""")
        pg.reload(); pg.wait_for_selector('.tabs'); tab(pg, 3); pg.locator('.segmented button').nth(1).click(); time.sleep(0.8)
        r.check(pg.locator('.drill-empty').count() == 1 and '15' in pg.locator('.drill-empty').inner_text() and pg.locator('.drill-empty p').count() == 1, f'{tag}: only hidden ones left: the empty screen says so',
                pg.locator('.drill-empty').inner_text()[:120].replace('\n', ' ') if pg.locator('.drill-empty').count() else 'not empty')
        tab(pg, 1); time.sleep(0.5)
        if not pg.locator('.manage-card').count(): pg.click('.manage-chip')
        pg.locator('.manage-row input[type="checkbox"]').nth([x['id'] for x in data].index('london')).check(); time.sleep(0.5)
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
        tab(pg, 3); pg.locator('.segmented button').nth(1).click(); time.sleep(0.5)
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
    pg.click('.lang-switch'); pg.wait_for_function("document.documentElement.lang === 'es'")
    r.check('Aprender' in pg.inner_text('.tabs'), 'switching to Spanish')
    pg.reload(); pg.wait_for_selector('.tabs')
    r.check('Aprender' in pg.inner_text('.tabs'), 'Spanish is kept after a reload')
    pg.click('.lang-switch'); pg.wait_for_function("document.documentElement.dir === 'rtl'")
    pg.click('.lang-switch'); pg.wait_for_function("document.documentElement.lang === 'en'")
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
    install(b); privacy(b); account(b); phone(b); touch(b); languages(b); offline(b)
    b.close()
r.done()

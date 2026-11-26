"""Shared helpers for the browser QA scripts (see scripts/qa/README.md)."""
import argparse, json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / 'out'
SHOTS = OUT / 'shots'
LIVE = 'https://opening-trainer-app.vercel.app'

# A first visit to Learn asks which openings you play (src/OpeningPicker.tsx). The checks start every browser as if that
# was answered with "Show all", so they see the app as before; pass first_visit=True to new_context/new_page to meet it.
from playwright.sync_api import Browser
_CHOSEN = "try { localStorage.getItem('chess-trainer:openings-chosen') || localStorage.setItem('chess-trainer:openings-chosen', 'true'); } catch {}"
_new_context, _new_page = Browser.new_context, Browser.new_page


def _context(self, *a, first_visit=False, **k):
    ctx = _new_context(self, *a, **k)
    if not first_visit: ctx.add_init_script(_CHOSEN)
    return ctx


def _page(self, *a, first_visit=False, **k):
    pg = _new_page(self, *a, **k)
    if not first_visit: pg.add_init_script(_CHOSEN)
    return pg


Browser.new_context, Browser.new_page = _context, _page


# Learn: the opening and the line are chosen from two buttons, each opening a list (src/LearnSheets.tsx)
def close_sheet(pg):
    if pg.locator('.pick-sheet').count(): pg.keyboard.press('Escape'); pg.wait_for_timeout(250)


def open_opening(pg, rep_id):
    """Studies this repertoire in Learn (from its row in the opening list)."""
    close_sheet(pg); pg.click('.opening-btn'); pg.click(f'.pick-sheet .sheet-row[data-rep="{rep_id}"]'); pg.wait_for_timeout(250)


def shown_openings(pg):
    """How many openings the opening list offers (the ones not hidden)."""
    close_sheet(pg); pg.click('.opening-btn'); n = pg.locator('.pick-sheet .sheet-row[data-rep]').count(); close_sheet(pg)
    return n


def manage_openings(pg):
    """Opens "which openings to show"; its checkboxes are .manage-row[data-rep=<id>] input."""
    if pg.locator('.pick-sheet .manage-row').count(): return
    close_sheet(pg); pg.click('.opening-btn'); pg.click('.pick-sheet .manage-chip'); pg.wait_for_timeout(200)


def line_names(pg):
    """The names in the line list of the opening studied."""
    close_sheet(pg); pg.click('.line-btn'); names = pg.locator('.pick-sheet .sheet-row-name').all_inner_texts(); close_sheet(pg)
    return names


def pick_line(pg, i):
    close_sheet(pg); pg.click('.line-btn'); pg.locator('.pick-sheet .sheet-row').nth(i).click(); pg.wait_for_timeout(200)


def current_line(pg):
    """The index of the line studied (the line button shows "3/8")."""
    return int(pg.inner_text('.line-btn .picker-btn-meta').split('/')[0]) - 1


def args(description, extra=None):
    p = argparse.ArgumentParser(description=description)
    p.add_argument('--url', default='http://localhost:4173', help='app to test (default: local vite preview)')
    p.add_argument('--only', default='', help='comma-separated subset (repertoire ids or section names)')
    if extra: extra(p)
    a = p.parse_args()
    a.only = [x for x in a.only.split(',') if x]
    SHOTS.mkdir(parents=True, exist_ok=True)
    return a


def lines():
    """Repertoire lines as UCI (regenerated from src/repertoire.ts on every run)."""
    raw = subprocess.run(['node', '--experimental-strip-types', str(ROOT / 'scripts/qa/dump-lines.ts')],
                         cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout
    (OUT / 'lines.json').write_text(raw, encoding='utf-8')
    return json.loads(raw)


def puzzles_by_board():
    """The current puzzle set (the newest public/puzzles-vN.json), keyed by the board the solver sees."""
    files = sorted((ROOT / 'public').glob('puzzles-v*.json'), key=lambda f: int(f.stem.split('-v')[1]))
    raw = subprocess.run(['node', '--experimental-strip-types', str(ROOT / 'scripts/qa/dump-puzzles.ts'), str(files[-1])],
                         cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout
    return json.loads(raw)


class Report:
    """Collects checks and page errors; `done()` prints a summary and exits non-zero on any failure."""

    def __init__(self, name):
        self.name, self.fails, self.passed, self.errors, self.log = name, [], 0, [], []

    def note(self, *a):
        s = ' '.join(str(x) for x in a)
        self.log.append(s)
        print(s, flush=True)

    def check(self, ok, label, detail=''):
        if ok:
            self.passed += 1
            self.note('  ok  ', label, detail)
        else:
            self.fails.append(f'{label} {detail}'.strip())
            self.note('  FAIL', label, detail)
        return ok

    def watch(self, page, tag):
        page.on('pageerror', lambda e: self.errors.append(f'[{tag}] pageerror: {e}'))
        page.on('console', lambda m: m.type == 'error' and self.errors.append(f'[{tag}] console: {m.text[:300]}'))

    def shot(self, page, name):
        try:
            page.screenshot(path=str(SHOTS / f'{name}.png'))
        except Exception:
            pass

    def done(self):
        for e in self.errors: self.fails.append(e)
        (OUT / f'{self.name}.json').write_text(json.dumps({'passed': self.passed, 'fails': self.fails, 'log': self.log},
                                                          ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'\n{self.name}: {self.passed} passed, {len(self.fails)} failed ({len(self.errors)} page errors)')
        for f in self.fails[:30]: print('  -', f[:250])
        sys.exit(1 if self.fails else 0)


def hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')


def wait_until(fn, timeout=30, step=0.25):
    t = time.time()
    while time.time() - t < timeout:
        if fn(): return True
        time.sleep(step)
    return False

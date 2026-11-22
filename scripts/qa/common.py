"""Shared helpers for the browser QA scripts (see scripts/qa/README.md)."""
import argparse, json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / 'out'
SHOTS = OUT / 'shots'
LIVE = 'https://opening-trainer-app.vercel.app'


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

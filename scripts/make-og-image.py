"""The picture a shared link shows (Facebook, WhatsApp, X): public/og-image.png, 1200x630.

The board is the app's own (a screenshot of Learn, London System after 2.Bf4), next to the logo
(public/favicon.svg) and a short Hebrew headline. Needs a running build:

    npm run build && npx vite preview --port 4173
    python scripts/make-og-image.py [--url http://localhost:4173]
"""
import argparse, base64, pathlib, tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/og-image.png'
# "Chess opening trainer" / "Free, on your phone, even offline" / "Learn your lines step by step and train them against Stockfish"
TITLE = '\u05de\u05d0\u05de\u05df \u05e4\u05ea\u05d9\u05d7\u05d5\u05ea \u05e9\u05d7\u05de\u05d8'
SUB = '\u05d7\u05d9\u05e0\u05dd, \u05d1\u05d8\u05dc\u05e4\u05d5\u05df, \u05d2\u05dd \u05d1\u05dc\u05d9 \u05d0\u05d9\u05e0\u05d8\u05e8\u05e0\u05d8'
LINE = ('\u05dc\u05d5\u05de\u05d3\u05d9\u05dd \u05e7\u05d5\u05d5\u05d9\u05dd \u05e6\u05e2\u05d3 \u05d0\u05d7\u05e8 \u05e6\u05e2\u05d3 '
        '\u05d5\u05de\u05ea\u05d0\u05de\u05e0\u05d9\u05dd \u05de\u05d5\u05dc Stockfish')

p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
p.add_argument('--url', default='http://localhost:4173', help='a running build of the app')
a = p.parse_args()

with sync_playwright() as pw:
    b = pw.chromium.launch()
    # the board: Learn, two steps into the London (a position that says "openings" at a glance)
    pg = b.new_page(viewport={'width': 1280, 'height': 900}, device_scale_factor=1, locale='en-US')
    pg.goto(a.url)
    pg.evaluate("localStorage.setItem('chess-trainer:guide-dismissed', 'true'); localStorage.setItem('chess-trainer:screen', JSON.stringify('learn'))")
    pg.reload(); pg.wait_for_selector('.learn .stepper')
    for _ in range(3): pg.locator('.learn .stepper button.primary').click()
    pg.wait_for_timeout(800)
    board = base64.b64encode(pg.locator('.learn .board').screenshot()).decode()
    logo = base64.b64encode((ROOT / 'public/favicon.svg').read_bytes()).decode()

    html = f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@500;800&display=block" rel="stylesheet">
<style>
  * {{ margin: 0; box-sizing: border-box; }}
  body {{ width: 1200px; height: 630px; background: #16181d; color: #e8eaed; font-family: Heebo, sans-serif;
         display: flex; align-items: center; gap: 56px; padding: 0 64px; }}
  .text {{ flex: 1; display: flex; flex-direction: column; gap: 22px; }}
  .logo {{ width: 120px; height: 120px; }}
  h1 {{ font-size: 76px; font-weight: 800; line-height: 1.05; }}
  h2 {{ font-size: 40px; font-weight: 500; color: #5fb36b; }}
  p {{ font-size: 28px; color: #a8adb7; }}
  .board {{ width: 500px; height: 500px; border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,.5); }}
</style></head><body>
  <div class="text">
    <img class="logo" src="data:image/svg+xml;base64,{logo}">
    <h1>{TITLE}</h1>
    <h2>{SUB}</h2>
    <p>{LINE}</p>
  </div>
  <img class="board" src="data:image/png;base64,{board}">
</body></html>"""
    page = b.new_page(viewport={'width': 1200, 'height': 630}, device_scale_factor=1)
    with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as f:
        f.write(html)
    page.goto(pathlib.Path(f.name).as_uri()); page.evaluate('document.fonts.ready'); page.wait_for_timeout(500)
    page.screenshot(path=str(OUT))
    b.close()

size = OUT.stat().st_size
print(f'{OUT.relative_to(ROOT)}: {size // 1024} KB')
assert size < 300 * 1024, 'over 300 KB: Facebook may not show it'

"""QA: "Test me" on every line of every repertoire through the real UI (English, desktop).

    python scripts/qa/learn_lines.py [--url URL] [--only london,qga]
"""
import time
from playwright.sync_api import sync_playwright
from common import Report, args, lines, open_opening, pick_line

a = args('Test me on every repertoire line')
r = Report('learn_lines')
data = lines()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(locale='en-US', viewport={'width': 1280, 'height': 900})
    r.watch(pg, 'learn')
    pg.goto(a.url)
    pg.wait_for_selector('.tabs', timeout=60000)
    pg.click('.tabs .tab:has-text("Learn")')
    pg.wait_for_selector('.learn-header')
    if pg.locator('button:has-text("Got it")').count(): pg.click('button:has-text("Got it")')

    for ri, rep in enumerate(data):
        if a.only and rep['id'] not in a.only: continue
        open_opening(pg, rep['id'])
        user_parity = 0 if rep['color'] == 'w' else 1
        for line in rep['lines']:
            n, detail = len(line['uci']), ''
            try:
                pick_line(pg, line['i'])
                pg.locator('.actions button:has-text("Test me on this line")').click()
                time.sleep(0.8)  # the board animates back to the start position
                for k, u in enumerate(line['uci']):
                    if k % 2 != user_parity: continue
                    pg.wait_for_selector(f'.pill:text-is("Test · {k}/{n}")', timeout=8000)
                    pg.click(f'.learn .board [data-square="{u[:2]}"]')
                    pg.click(f'.learn .board [data-square="{u[2:4]}"]')
                    if pg.locator('.card.feedback.tone-error').count():
                        raise RuntimeError(f'move {k + 1} ({u}) rejected')
                pg.wait_for_selector('.card.notice.tone-ok', timeout=8000)
                ok = True
            except Exception as e:
                ok, detail = False, str(e).splitlines()[0][:200]
                r.shot(pg, f'learn-{rep["id"]}-{line["i"]}')
            r.check(ok, f'{rep["id"]} #{line["i"]} {line["name"]}', detail)
    b.close()
r.done()

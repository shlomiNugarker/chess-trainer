"""Sign-in and sync between devices, against the local Firebase emulators (never the real project).

Needs the emulators and an emulator build of the app, see README.md ("Sync"). Every browser context is one device.
"""
import json, time, urllib.request, uuid
from playwright.sync_api import Error, sync_playwright
from common import Report, args, wait_until

P = 'chess-trainer:'
PROJECT = 'demo-chess'  # a demo- project exists only in the emulators
PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

a = args('Sync QA (Firebase emulators)')
if not a.url.startswith('http://localhost:'): raise SystemExit('sync.py runs only on a local emulator build (README.md, "Sync")')
r = Report('sync')


def clear_emulators():
    for url in (f'http://127.0.0.1:8080/emulator/v1/projects/{PROJECT}/databases/(default)/documents',
                f'http://127.0.0.1:9099/emulator/v1/projects/{PROJECT}/accounts'):
        urllib.request.urlopen(urllib.request.Request(url, method='DELETE', headers={'Authorization': 'Bearer owner'}))


def cloud_docs():
    """The saved documents, as {data, stamps} of plain values."""
    url = f'http://127.0.0.1:8080/v1/projects/{PROJECT}/databases/(default)/documents/users'
    res = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer owner'})))
    return [{k: v['mapValue'].get('fields', {}) for k, v in d['fields'].items() if 'mapValue' in v} for d in res.get('documents', [])]


def cloud_value(key):
    docs = cloud_docs()
    v = docs[0]['data'].get(key, {}).get('stringValue') if docs else None
    return None if v is None else json.loads(v)


class Device:
    def __init__(self, browser, name, user=None, **ctx):
        self.ctx = browser.new_context(locale='en-US', service_workers='block', **ctx)
        self.page = self.ctx.new_page()
        r.watch(self.page, name)
        if user:
            token = json.dumps({'sub': user, 'email': f'{user}@example.com', 'email_verified': True})
            self.ctx.add_init_script(f'if (location.origin === {json.dumps(a.url)}) localStorage.setItem("emulator-google-user", {json.dumps(token)})')

    def open(self):
        self.page.goto(a.url)
        self.page.wait_for_selector('.tabs')
        time.sleep(1)

    def get(self, key):
        for attempt in range(3):
            try:
                v = self.page.evaluate('k => localStorage.getItem(k)', P + key)
                break
            except Error:  # the page is loading again after a merge
                if attempt == 2: raise
                self.page.wait_for_selector('.tabs')
        return None if v is None else json.loads(v)

    def set(self, key, value):
        self.page.evaluate('([k, v]) => localStorage.setItem(k, v)', [P + key, json.dumps(value)])

    def stamps(self):
        return self.get('sync-stamps') or {}

    def account(self):
        if not self.page.locator('.account-panel').count():
            self.page.locator('.account-tab').first.click()
            self.page.wait_for_selector('.account-panel')

    def sign_in(self):
        self.account()
        self.page.locator('.google-btn').click()
        return self.synced()

    def synced(self):
        def ok():
            try:
                return bool(self.get('cloud-signed-in')) and self.get('cloud-last-sync') is not None and not self.page.locator('.google-btn').count()
            except Exception:
                return False  # the page is reloading after a merge
        done = wait_until(ok, 25)
        self.page.wait_for_timeout(1500)
        return done


clear_emulators()
with sync_playwright() as p:
    b = p.chromium.launch()
    user = 'u' + uuid.uuid4().hex[:8]

    # ---- opening the app is not a change ----
    d = Device(b, 'fresh')
    d.open()
    r.check(d.stamps() == {}, 'a fresh device that only opened the app has no changes to upload', str(sorted(d.stamps())))
    d.page.locator('.tabs .tab').nth(1).click()
    time.sleep(0.5)
    r.check(d.stamps() == {}, 'nor after going to another screen', str(sorted(d.stamps())))
    d.ctx.close()

    # ---- device A: real choices, signed in ----
    A = Device(b, 'A', user)
    A.open()
    for k, v in {'chesscom-user': 'someone', 'skill': 11, 'threshold': 30}.items(): A.set(k, v)
    A.page.reload(); A.page.wait_for_selector('.tabs')
    r.check(A.sign_in(), 'device A signs in and syncs')
    r.check(cloud_value('chesscom-user') == 'someone' and cloud_value('skill') == 11, 'device A uploaded its settings')

    # ---- a new device must take the cloud's settings ----
    B = Device(b, 'B', user)
    B.open()
    r.check(B.sign_in(), 'new device B signs in and syncs')
    got = {k: B.get(k) for k in ('chesscom-user', 'skill', 'threshold')}
    r.check(got == {'chesscom-user': 'someone', 'skill': 11, 'threshold': 30}, "the new device takes the cloud's settings", str(got))
    got = {k: cloud_value(k) for k in ('chesscom-user', 'skill', 'threshold')}
    r.check(got == {'chesscom-user': 'someone', 'skill': 11, 'threshold': 30}, "the new device does not overwrite the cloud's settings", str(got))

    # ---- a device that already has defaults stamped as new (opened before this was fixed) ----
    E = Device(b, 'stamped', user)
    E.open()
    now = int(time.time() * 1000) + 60000
    old = {'chesscom-user': '', 'skill': 3, 'threshold': 20}
    for k, v in old.items(): E.set(k, v)
    E.set('sync-stamps', {P + k: now for k in old})
    r.check(E.sign_in(), 'a device with stamped defaults signs in')
    got = [{k: f(k) for k in old} for f in (E.get, cloud_value)]
    r.check(all(g == {'chesscom-user': 'someone', 'skill': 11, 'threshold': 30} for g in got), "its defaults do not replace the account's settings", str(got))
    E.ctx.close()

    # ---- a device that is behind: opening it must not win ----
    B.set('skill', 17)  # changed on B, uploaded a few seconds later
    r.check(wait_until(lambda: cloud_value('skill') == 17, 15), 'a change on B reaches the cloud')
    A.page.reload(); A.page.wait_for_selector('.tabs')
    r.check(wait_until(lambda: A.get('skill') == 17, 15), 'A, which was behind, takes the change when it opens', str(A.get('skill')))
    time.sleep(5)
    r.check(cloud_value('skill') == 17, 'and did not put its old value back', str(cloud_value('skill')))

    # ---- a real choice made in the UI is saved, stamped and uploaded ----
    A.page.keyboard.press('Escape')
    A.page.locator('.tabs .tab').nth(1).click()
    before = A.stamps().get(P + 'show-notes', 0)
    A.page.evaluate("""() => { const l = [...document.querySelectorAll('input[type=checkbox]')]; window.__boxes = l.length; l.forEach((x) => x.click()); }""")
    changed = wait_until(lambda: any(A.stamps().get(P + k, 0) > before for k in ('show-notes', 'show-eval', 'correct-all')), 5)
    r.check(changed, 'a setting changed in the Play screen is stamped', f"{A.page.evaluate('window.__boxes')} checkboxes")
    key = next((k for k in ('show-notes', 'show-eval', 'correct-all') if A.get(k) is not None), None)
    r.check(key is not None and wait_until(lambda: cloud_value(key) == A.get(key), 15), 'and reaches the cloud', f'{key}={A.get(key) if key else None}')

    # ---- a removed branch stays removed on both devices ----
    branch = {'moves': 'd4 d5', 'dev': '1...d5', 'at': 1000}
    A.set('custom-lines', {'london': [branch]})
    wait_until(lambda: (cloud_value('custom-lines') or {}).get('london'), 15)
    B.page.reload(); B.page.wait_for_selector('.tabs')
    r.check(wait_until(lambda: len((B.get('custom-lines') or {}).get('london', [])) == 1, 15), 'a branch added on A reaches B')
    B.set('custom-lines', {'london': [{**branch, 'removed': 2000}]})
    wait_until(lambda: ((cloud_value('custom-lines') or {}).get('london') or [{}])[0].get('removed') == 2000, 15)
    A.page.reload(); A.page.wait_for_selector('.tabs')
    r.check(wait_until(lambda: A.get('custom-lines')['london'][0].get('removed') == 2000, 15), 'removed on B, it is removed on A too')

    # ---- sign out, then the button works again ----
    B.account()
    B.page.get_by_text('Sign out').click()
    r.check(wait_until(lambda: B.page.locator('.google-btn').count() == 1, 10), 'signing out')
    r.check(B.page.locator('.google-btn').is_enabled(), 'the sign-in button is enabled after signing out')
    A.ctx.close(); B.ctx.close()

    # ---- a phone sign-in (redirect) that was cancelled ----
    C = Device(b, 'phone', user_agent=PHONE, viewport={'width': 390, 'height': 844}, has_touch=True)
    C.open()
    C.account()
    C.page.locator('.google-btn').click()
    C.page.wait_for_url('**/emulator/auth/handler**', timeout=30000)
    r.check(True, 'phone: sign-in goes to the provider page')
    C.page.go_back()
    C.page.wait_for_selector('.tabs')
    C.account()
    free = wait_until(lambda: C.page.locator('.google-btn').is_enabled(), 30)
    r.check(free, 'phone: after cancelling and going back, the button is enabled again', C.page.locator('.google-btn').inner_text())
    C.page.locator('.google-btn').click()
    C.page.wait_for_url('**/emulator/auth/handler**', timeout=30000)
    r.check(True, 'phone: and a second try goes to the provider page again')
    C.page.goto(a.url); C.page.wait_for_selector('.tabs'); C.account()
    free = wait_until(lambda: C.page.locator('.google-btn').is_enabled(), 30)
    r.check(free, 'phone: the same when the app is opened again instead of going back', C.page.locator('.google-btn').inner_text())
    # the browser may show the old page as it was (back/forward cache): the provider page is blocked to stay here
    C.ctx.route('**/emulator/auth/handler**', lambda route: route.fulfill(status=204))
    C.page.locator('.google-btn').click()
    C.page.wait_for_timeout(3000)
    r.check(not C.page.locator('.google-btn').is_enabled(), 'phone: while signing in, the button is disabled')
    C.page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))")
    C.page.wait_for_timeout(300)
    r.check(C.page.locator('.google-btn').is_enabled(), 'phone: a page restored as it was enables the button')
    C.ctx.close()

    # ---- a failed Firebase load is tried again ----
    D = Device(b, 'retry', user)
    D.ctx.route('**/assets/firebase-*.js', lambda route: route.abort())
    D.open()
    D.account()
    D.page.locator('.google-btn').click()
    r.check(wait_until(lambda: D.page.locator('.sync-status.warn').count() > 0, 10), 'Firebase cannot load: an error is shown')
    D.ctx.unroute('**/assets/firebase-*.js')
    D.page.locator('.google-btn').click()  # loads the page again: Chrome does not fetch a failed module twice
    D.page.wait_for_timeout(3000)
    r.check(D.page.locator('.account-panel').count() == 0, 'trying again loads a fresh page')
    r.check(D.sign_in(), 'and signing in works there')
    D.ctx.close()
    # the aborted download above is the point of that check, not a page error
    r.errors = [e for e in r.errors if not (e.startswith('[retry]') and 'ERR_FAILED' in e)]
    b.close()
r.done()

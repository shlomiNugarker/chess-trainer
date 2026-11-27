"""Sign-in and sync between devices, against the local Firebase emulators (never the real project).

Needs the emulators and an emulator build of the app, see README.md ("Sync"). Every browser context is one device.
"""
import json, time, urllib.error, urllib.request, uuid
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


def cloud_users():
    """user id -> {key: value} as saved in the cloud."""
    url = f'http://127.0.0.1:8080/v1/projects/{PROJECT}/databases/(default)/documents/users'
    res = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Bearer owner'})))
    return {d['name'].split('/')[-1]: {k: json.loads(v['stringValue']) for k, v in d['fields']['data']['mapValue'].get('fields', {}).items()}
            for d in res.get('documents', [])}


def cloud_value(key):
    docs = cloud_docs()
    v = docs[0]['data'].get(key, {}).get('stringValue') if docs else None
    return None if v is None else json.loads(v)


class Device:
    def __init__(self, browser, name, user=None, **ctx):
        self.ctx = browser.new_context(locale='en-US', service_workers='block', **ctx)
        self.page = self.ctx.new_page()
        r.watch(self.page, name)
        self.user = user
        if user:
            # only the first time: become() changes the Google account of this device
            self.ctx.add_init_script(f'if (location.origin === {json.dumps(a.url)} && !localStorage.getItem("emulator-google-user")) '
                                     f'localStorage.setItem("emulator-google-user", {json.dumps(self.token(user))})')

    def token(self, user):
        return json.dumps({'sub': user, 'email': f'{user}@example.com', 'email_verified': True})

    def become(self, user):
        """The next sign-in on this device is another person's."""
        self.page.evaluate('t => localStorage.setItem("emulator-google-user", t)', self.token(user))

    def sign_out(self):
        self.account()
        self.page.get_by_text('Sign out').click()
        self.page.wait_for_selector('.google-btn')
        self.page.wait_for_timeout(500)

    def hold(self, what):
        """Holds this device's Firestore requests ('batchGet' or 'commit') until release() is called."""
        held, self.holding = [], True
        self.ctx.route(f'**/documents:{what}*', lambda route: held.append(route) if self.holding else route.continue_())

        def release():
            self.holding = False
            for route in held: route.continue_()
        return held, release

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


def rules():
    """firestore.rules, asked directly: each user only their own document, and only of the right shape."""
    def call(url, method='GET', body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token: headers['Authorization'] = f'Bearer {token}'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)) as res:
                return res.status, json.load(res)
        except urllib.error.HTTPError as e:
            return e.code, None

    def person(name):
        body = {'postBody': 'id_token=' + json.dumps({'sub': name, 'email': f'{name}@example.com', 'email_verified': True}) + '&providerId=google.com', 'requestUri': 'http://localhost', 'returnSecureToken': True}
        res = call('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo', 'POST', body)[1]
        return res['localId'], res['idToken']

    base = f'http://127.0.0.1:8080/v1/projects/{PROJECT}/databases/(default)/documents'
    good = {'data': {'mapValue': {}}, 'stamps': {'mapValue': {}}, 'updatedAt': {'integerValue': '1'}}
    write = lambda path, fields, token: call(f'{base}/{path}', 'PATCH', {'fields': fields}, token)[0]
    (u1, t1), (u2, t2) = person('rules-one'), person('rules-two')
    r.check(write(f'users/{u1}', good, t1) == 200, 'rules: a user writes their own document')
    r.check(call(f'{base}/users/{u1}', token=t1)[0] == 200, 'rules: and reads it')
    r.check(call(f'{base}/users/{u1}', token=t2)[0] == 403 and write(f'users/{u1}', good, t2) == 403, "rules: not another user's")
    r.check(call(f'{base}/users/{u1}')[0] == 403 and write(f'users/{u1}', good, None) == 403, 'rules: nobody without signing in')
    r.check(call(f'{base}/users', token=t1)[0] == 403, 'rules: no list of users')
    r.check(write(f'other/{u1}', good, t1) == 403 and write(f'users/{u1}/more/x', good, t1) == 403, 'rules: nothing outside users/{uid}')
    for label, bad in (('an extra field', {**good, 'x': {'stringValue': 'y'}}), ('data that is not a map', {**good, 'data': {'stringValue': 'y'}}),
                       ('stamps that are not a map', {**good, 'stamps': {'stringValue': 'y'}}), ('a time that is not a number', {**good, 'updatedAt': {'stringValue': 'y'}}),
                       ('no time', {k: v for k, v in good.items() if k != 'updatedAt'})):
        r.check(write(f'users/{u2}', bad, t2) == 403, f'rules: refused with {label}')
    r.check(call(f'{base}/users/{u1}', 'DELETE', token=t1)[0] == 200, 'rules: a user deletes their own document')


clear_emulators()
rules()
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

    # ---- two devices sync at the same moment: neither overwrites the other ----
    noted = len(r.errors)
    held, release = A.hold('commit')
    A.set('threshold', 25)
    for _ in range(40):
        if held: break
        A.page.wait_for_timeout(250)
    r.check(len(held) > 0, 'A has read the cloud and is about to write')
    B.set('deep-count', 50)
    for _ in range(40):
        if cloud_value('deep-count') == 50: break
        B.page.wait_for_timeout(250)
    r.check(cloud_value('deep-count') == 50, 'meanwhile B uploads another change')
    release()
    for _ in range(40):
        if cloud_value('threshold') == 25: break
        A.page.wait_for_timeout(250)
    A.page.wait_for_timeout(1500)
    got = (cloud_value('threshold'), cloud_value('deep-count'))
    r.check(got == (25, 50), 'both changes are in the cloud', str(got))
    A.ctx.unroute('**/documents:commit*')

    # the refused write (400) is how A learns that B was first, and Chrome logs it
    r.errors[noted:] = [e for e in r.errors[noted:] if not (e.startswith('[A]') and 'status of 400' in e)]

    # ---- a change made on the device while a sync is running is not lost ----
    B.set('skill', 14)
    for _ in range(40):
        if cloud_value('skill') == 14: break
        B.page.wait_for_timeout(250)
    held, release = A.hold('commit')
    A.set('threshold', 35)
    for _ in range(40):
        if held: break
        A.page.wait_for_timeout(250)
    r.check(len(held) > 0, "A has read the cloud (with B's skill) and is about to write")
    A.set('skill', 6)  # newer than B's change
    release()
    for _ in range(60):
        if cloud_value('skill') == 6: break
        A.page.wait_for_timeout(250)
    r.check(A.get('skill') == 6 and cloud_value('skill') == 6, "A's newer change is kept and uploaded", f"{A.get('skill')} {cloud_value('skill')}")
    A.ctx.unroute('**/documents:commit*')

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
    # ---- too much for one document ----
    G = Device(b, 'big', 'big' + uuid.uuid4().hex[:6])
    G.open()
    known = set(cloud_users())
    G.sign_in()
    G.set('skill', 12)
    wait_until(lambda: any(d.get('skill') == 12 for u, d in cloud_users().items() if u not in known), 15)
    G.page.evaluate("k => localStorage.setItem(k, JSON.stringify([{ fen: 'x'.repeat(1100000), repertoire: 'london', at: 1, due: 1 }]))", P + 'mistakes')
    G.account()
    r.check(wait_until(lambda: 'too much data' in G.page.locator('.sync-status').inner_text(), 15), 'too much to sync: the account panel says so', G.page.locator('.sync-status').inner_text())
    r.check(len(G.get('mistakes')) == 1 and any(d.get('skill') == 12 for u, d in cloud_users().items() if u not in known), 'nothing is lost, here or in the cloud')
    G.set('mistakes', [])
    r.check(wait_until(lambda: 'Synced' in G.page.locator('.sync-status').inner_text(), 15), 'and syncing goes on when it fits again')
    G.ctx.close()

    # ---- a clock that is behind: its change is still the newer one ----
    H, K = Device(b, 'clock-ahead', 'clock'), Device(b, 'clock-behind', 'clock')
    K.ctx.add_init_script('{ const now = Date.now; Date.now = () => now() - 3600000; }')
    H.open(); H.sign_in(); H.set('skill', 4); H.page.wait_for_timeout(5000)
    K.open(); K.sign_in()
    r.check(K.get('skill') == 4, 'the device whose clock is an hour behind gets the setting', str(K.get('skill')))
    K.set('skill', 15); K.page.wait_for_timeout(5000)
    H.page.reload(); H.page.wait_for_selector('.tabs')
    r.check(wait_until(lambda: H.get('skill') == 15, 15), 'and its later change wins', str(H.get('skill')))
    H.ctx.close(); K.ctx.close()

    # ---- another Google account on the same device ----
    first, second = 'first' + uuid.uuid4().hex[:6], 'second' + uuid.uuid4().hex[:6]
    F = Device(b, 'shared', first)
    F.open()
    known = set(cloud_users())
    F.set('mistakes', [{'fen': 'f1', 'repertoire': 'london', 'at': 1, 'due': 1}])  # before any sign-in: joins the account
    F.sign_in()
    F.set('chesscom-user', 'first-player')
    wait_until(lambda: any(d.get('chesscom-user') == 'first-player' for d in cloud_users().values()), 15)
    one = (set(cloud_users()) - known).pop()
    r.check(len(cloud_users()[one].get('mistakes', [])) == 1, 'progress made before the first sign-in joins the account')
    F.sign_out()
    F.set('skill', 19)  # changed while signed out: belongs to the first account, not uploaded yet
    F.become(second)
    F.sign_in()
    F.page.wait_for_timeout(5000)  # the switch loads the page again
    F.synced()
    new = set(cloud_users()) - known - {one}
    r.check(len(new) == 1, 'the second account has its own document')
    two = new.pop()
    mixed = {k: v for k, v in cloud_users()[two].items() if k in ('mistakes', 'chesscom-user', 'skill')}
    r.check(mixed == {}, "nothing of the first account is uploaded to the second", str(mixed))
    r.check(not F.get('mistakes') and not F.get('chesscom-user'), 'nor shown in the app', f"{F.get('mistakes')} {F.get('chesscom-user')}")
    r.check(F.page.locator('.account-tab').count() == 1, 'the app works after the switch')
    F.set('chesscom-user', 'second-player')
    wait_until(lambda: cloud_users()[two].get('chesscom-user') == 'second-player', 15)
    r.check(cloud_users()[two].get('chesscom-user') == 'second-player' and cloud_users()[one].get('chesscom-user') == 'first-player', 'each account keeps its own settings')
    F.sign_out()
    F.become(first)
    F.sign_in()
    F.page.wait_for_timeout(5000)
    F.synced()
    r.check(F.get('chesscom-user') == 'first-player' and len(F.get('mistakes') or []) == 1, 'back in the first account: its progress is back', f"{F.get('chesscom-user')}")
    r.check(F.get('skill') == 19 and cloud_users()[one].get('skill') == 19, 'also what was changed while signed out, now uploaded', f"{F.get('skill')} {cloud_users()[one].get('skill')}")
    r.check(cloud_users()[two].get('chesscom-user') == 'second-player', "and the second account's cloud copy is untouched")

    # the device has no room to keep the first account's data aside: nothing is mixed and nothing is lost
    F.sign_out()
    F.become(second)
    F.page.evaluate("() => { let n = 262144; for (let i = 0; n > 64; ) { try { localStorage.setItem('fill' + i, 'x'.repeat(n)); i++; } catch { n = n / 2 | 0; } } }")
    F.account()
    F.page.locator('.google-btn').click()
    F.page.wait_for_timeout(6000)
    r.check(F.get('chesscom-user') == 'first-player' and len(F.get('mistakes') or []) == 1, 'full storage: the first account stays on the device', str(F.get('chesscom-user')))
    F.account()
    r.check('No room' in F.page.locator('.sync-status').inner_text(), 'full storage: the account panel says why', F.page.locator('.sync-status').inner_text())
    r.check(cloud_users()[two].get('chesscom-user') == 'second-player' and 'mistakes' not in cloud_users()[two], 'full storage: and is not uploaded to the second', str(cloud_users()[two]))
    F.ctx.close()

    # "Delete my cloud data": the document and the user are gone, this device keeps its progress, and a second
    # device signed in to the same account does not bring the data back
    def auth_users():
        req = urllib.request.Request(f'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:batchGet?maxResults=100',
                                     headers={'Authorization': 'Bearer owner'})
        return [u['localId'] for u in json.load(urllib.request.urlopen(req)).get('users', [])]
    deleter = 'deleter-' + uuid.uuid4().hex[:6]
    G = Device(b, 'delete-1', deleter)
    G.open(); G.set('chesscom-user', 'deleting-player'); G.set('skill', 7)
    before = set(cloud_users())
    r.check(G.sign_in(), 'delete: first device signed in')
    wait_until(lambda: len(set(cloud_users()) - before) == 1, 15)
    uid = next(iter(set(cloud_users()) - before), None)
    H = Device(b, 'delete-2', deleter)
    H.open()
    r.check(H.sign_in() and H.get('chesscom-user') == 'deleting-player', 'delete: second device on the same account has the data')
    G.account()
    G.page.get_by_text('Delete my cloud data').click()
    dialog = G.page.locator('.confirm-dialog[role=alertdialog]')
    r.check(dialog.count() == 1 and 'stays' in dialog.inner_text() and G.page.locator('.account-panel').count() == 1,
            'delete: asks first, in the app’s own dialog, and says the progress on this device stays')
    G.page.keyboard.press('Escape')
    r.check(dialog.count() == 0 and G.page.locator('.account-panel').count() == 1 and uid in cloud_users(),
            'delete: Escape cancels the question only, nothing is deleted')
    G.page.get_by_text('Delete my cloud data').click()
    G.page.locator('.confirm-dialog button.danger').click()
    gone = wait_until(lambda: uid not in cloud_users() and uid not in auth_users() and G.page.locator('.deleted-note').count() == 1, 20)
    r.check(gone, 'delete: the document and the user are gone, and the panel says so', G.page.locator('.account-panel').inner_text()[:200])
    r.check(G.get('chesscom-user') == 'deleting-player' and G.get('skill') == 7 and G.get('cloud-signed-in') is None and G.page.locator('.google-btn').count() == 1,
            'delete: signed out, and the progress on this device stays')
    G.set('skill', 8)  # a change after the deletion must not reach the cloud
    time.sleep(6)
    r.check(uid not in cloud_users() and len(cloud_users()) == len(before), 'delete: nothing is written after the deletion', str(list(cloud_users())))
    # the second device is still open, with a sign-in that stays valid for up to an hour: a change there syncs
    H.set('skill', 12)
    time.sleep(8)
    r.check(uid not in cloud_users() and len(cloud_users()) == len(before), 'delete: the second device does not bring the data back', str(list(cloud_users())))
    H.account()
    r.check(H.page.locator('.google-btn').count() == 1 and H.page.locator('.deleted-note').count() == 1 and H.get('chesscom-user') == 'deleting-player',
            'delete: the second device signs out, says why, and keeps its progress', H.page.locator('.account-panel').inner_text()[:200])
    G.ctx.close(); H.ctx.close()

    # the aborted download above is the point of that check, not a page error
    r.errors = [e for e in r.errors if not (e.startswith('[retry]') and 'ERR_FAILED' in e)]
    b.close()
r.done()

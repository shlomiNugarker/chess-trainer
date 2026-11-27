// Offline support: the app (and the Stockfish engine) keep working without internet.
// - pages: network first, so a new version arrives as soon as you are online; the cached copy offline
// - /assets (hashed names, all of them kept: see cacheIndex — the Heebo font files too), /engine, icons: cache first —
//   their content never changes under the same name
// - anything on another site (the Chess.com API, Google sign-in, Firestore) and Web Analytics is left alone
// a new name drops everything cached before: needed when a file changes under the same name (the icons, v3), or to
// drop entries no longer used (v4: the Google Fonts files of returning users)
const CACHE = 'chess-trainer-v4';
const CORE = ['/', '/manifest.webmanifest', '/icon-192.png', '/engine/stockfish-19-lite-single.js', '/engine/stockfish-19-lite-single.wasm'];

// the hashed js/css that a given index.html points at
const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

// every file of the build, also the chunks loaded later with import() (e.g. Firebase), which index.html does
// not name; written by Vite (build.manifest in vite.config.ts). null if it cannot be read.
async function buildFiles() {
  try {
    const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const files = [];
    for (const e of Object.values(await res.json())) files.push(e.file, ...(e.css ?? []), ...(e.assets ?? []));
    return files.map((f) => '/' + f);
  } catch {
    return null;
  }
}

async function cacheIndex(cache, res) {
  const html = await res.clone().text();
  await cache.put('/', res);
  const linked = assetsOf(html);
  const all = await buildFiles();
  // the manifest belongs to this version only if it names everything the page links to
  const complete = all !== null && linked.every((a) => all.includes(a));
  const keep = new Set(complete ? [...linked, ...all] : linked);
  // fetch the current version's files
  await Promise.all([...keep].map((a) => cache.match(a).then((hit) => hit || cache.add(a))));
  // drop the old versions' files (only when the full list is known: never a chunk the page may still load)
  if (!complete) return;
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE.slice(1));
      await cacheIndex(cache, await fetch('/', { cache: 'no-store' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // only this app's old versions; other caches (e.g. Chess.com archives) belong to the page
      for (const k of await caches.keys()) if (k.startsWith('chess-trainer-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

// the page asks for the puzzle file to be kept, once the first visit has loaded (src/main.tsx), so the puzzles work
// offline even before Practice was opened
self.addEventListener('message', (event) => {
  const url = event.data?.type === 'keep' && typeof event.data.url === 'string' ? new URL(event.data.url, location.origin) : null;
  if (!url || url.origin !== location.origin || !/^\/puzzles-v\d+\.json$/.test(url.pathname)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      if (!(await cache.match(url.pathname))) await cache.add(url.pathname).catch(() => {});
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google sign-in pages (proxied to Firebase by vercel.json) must always come from the network
  if (url.origin === location.origin && url.pathname.startsWith('/__/')) return;
  // Web Analytics (its script and its counts): never from the cache, and never cached
  if (url.origin === location.origin && url.pathname.startsWith('/_vercel/')) return;

  if (req.mode === 'navigate' && url.origin === location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req, { cache: 'no-store' });
          if (res.ok) event.waitUntil(cacheIndex(cache, res.clone()));
          return res;
        } catch {
          return (await cache.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.origin !== location.origin) return;
  if (url.pathname === '/sw.js') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })(),
  );
});

// Offline support: the app (and the Stockfish engine) keep working without internet.
// - pages: network first, so a new version arrives as soon as you are online; the cached copy offline
// - /assets (hashed names), /engine, icons: cache first — their content never changes under the same name
// - Google Fonts: cached after the first load
// - everything else (the Chess.com API) is left alone
const CACHE = 'chess-trainer-v1';
const CORE = ['/', '/manifest.webmanifest', '/icon-192.png', '/engine/stockfish-19-lite-single.js', '/engine/stockfish-19-lite-single.wasm'];

// the hashed js/css that a given index.html points at
const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

async function cacheIndex(cache, res) {
  const html = await res.clone().text();
  await cache.put('/', res);
  const keep = new Set(assetsOf(html));
  // fetch the current version's files, drop the old versions' files
  await Promise.all([...keep].map((a) => cache.match(a).then((hit) => hit || cache.add(a))));
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
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

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

  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  if (url.origin === location.origin && url.pathname === '/sw.js') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })(),
  );
});

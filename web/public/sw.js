/* WorkMars service worker.
   - Installable app: keeps a small app shell so WorkMars opens instantly and shows a friendly page offline.
   - Pages are always fetched from the network first, so you get the latest version whenever you're online.
   - Built files under /assets/ have content hashes in their names, so they're cached once and reused.
   - API calls and the Vite dev server's files are never cached.
   - Push notifications: shows them and opens the right page when one is tapped. */
const VERSION = 'wm-v2';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ['/offline.html', '/icon-192.png', '/icon-512.png', '/favicon.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

const NEVER = [/^\/api\//, /^\/src\//, /^\/@/, /^\/node_modules\//, /hot-update/, /\.ics$/];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.some((r) => r.test(url.pathname)) || url.searchParams.has('import')) return;

  // Pages: network first, then the last good copy of the app, then the offline page.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = (await event.preloadResponse) || (await fetch(req));
        if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
        }
        return res;
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('/')) || (await cache.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Hashed build files: cache first (their names change whenever their content does).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  // Icons, fonts and other public files: serve the cached copy if we have one, refresh it in the background.
  if (/\.(png|svg|webp|jpg|jpeg|woff2?|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => hit);
      return hit || fresh;
    })());
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'WorkMars';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'You have a new notification.',
    icon: '/icon-512.png',
    badge: '/favicon.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if ('navigate' in w) return w.navigate(target);
        return undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});

// The browser rotated the subscription: re-subscribe and tell the server.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old?.options?.applicationServerKey;
    if (!key) return;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' }, body: JSON.stringify(sub.toJSON()) });
  })());
});

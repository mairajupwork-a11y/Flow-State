/* WorkMars service worker: shows push notifications and opens the right page when one is tapped.
   It deliberately caches nothing, so the app is always the latest version. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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

/* Service worker di Always Adaptive Coach: riceve le notifiche push e apre l'app al tocco.
   Nessuna cache offline: l'app resta sempre aggiornata. */
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const url = typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/';
  e.waitUntil(self.registration.showNotification(String(d.title || 'Always Adaptive Coach'), {
    body: String(d.body || ''),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: typeof d.tag === 'string' ? d.tag : undefined,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((finestre) => {
    for (const w of finestre) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) return w.focus().then((f) => (f && f.navigate && f.url !== url ? f.navigate(url) : f));
    }
    return self.clients.openWindow(url);
  }));
});

const CACHE_NAME = 'sismo-platform-v2';
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('sismo-platform-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
  })());
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'Sismo Platform';
  const options = {
    body: data.body || 'Hay una actualización sísmica reportada.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || `sismo-${Date.now()}`,
    renotify: false,
    data: { url: data.url || '/', kind: data.kind || 'automatic', source_url: data.source_url || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) { await client.focus(); if ('navigate' in client) await client.navigate(target); return; }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

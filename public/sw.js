// Fizion Web: приложение открывается быстро и без сети показывает сохранённую оболочку.
// Данные (сообщения, файлы, вход) всегда идут напрямую на сервер и не кэшируются.
const CACHE = 'fizion-shell-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // страница: сначала сеть, без сети — сохранённая
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          void caches.open(CACHE).then((c) => c.put('/', copy));
          return r;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  // файлы сборки с хешем в имени не меняются — берём из кэша
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((r) => {
            const copy = r.clone();
            void caches.open(CACHE).then((c) => c.put(e.request, copy));
            return r;
          }),
      ),
    );
  }
});

// push от сервера (функция fizion-events): показать уведомление
self.addEventListener('push', (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    p = { title: 'Fizion', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(p.title || 'Fizion', {
      body: p.body || '',
      tag: p.tag || 'fizion',
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      requireInteraction: !!p.urgent,
      vibrate: p.urgent ? [300, 150, 300, 150, 300] : [120],
      data: { url: p.url || '/' },
    }),
  );
});

// нажали на уведомление: открыть Fizion на нужном чате
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === location.origin);
      if (open) {
        open.postMessage({ type: 'fizion-open', url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

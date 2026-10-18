const CACHE_NAME = 'kollektiv-v4-clean';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=4.1',
  '/app.js?v=4.1',
  '/manifest.json',
  '/fonts/arturito-slab.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Кэширование оболочки приложения...');
      return cache.addAll(STATIC_ASSETS).catch((err) => console.warn('[SW] Ошибка кэширования некоторых ассетов:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Удаление устаревшего кэша:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network-First стратегия: всегда запрашиваем свежую версию из сети,
// а при отсутствии связи (офлайн в СНТ) отдаем из кэша
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Для API-запросов: сначала сеть, при сбое — кэш
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Для статических ассетов: сначала сеть, чтобы дизайн и скрипты обновлялись мгновенно,
  // при отсутствии интернета — фоллбэк на кэш
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

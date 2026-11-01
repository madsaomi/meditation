// ============================================================
//  Service Worker «Тихого ума» — настоящий оффлайн-режим PWA.
//  Стратегии:
//    • Оболочка приложения (same-origin) — stale-while-revalidate:
//      мгновенная загрузка из кеша, обновление в фоне.
//    • Навигация — network-first с откатом на закешированный index.html:
//      свежая страница, но приложение открывается даже без сети.
//    • Google Fonts — cache-first (шрифты не меняются).
//    • Остальные внешние API (цитаты, переводы, музыка) — мимо SW:
//      приложение само обрабатывает оффлайн (офлайн-подборка, кеш переводов).
//  Бампни CACHE_VERSION при любом изменении index.html / app.js /
//  style.css / config.js — старые кеши удалятся автоматически.
// ============================================================

const CACHE_VERSION = 'v47';
const CACHE_NAME = `tihiy-um-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  'index.html',
  `style.css?v=${CACHE_VERSION}`,
  `app.js?v=${CACHE_VERSION}`,
  `config.js?v=${CACHE_VERSION}`,
  `manifest.webmanifest?v=${CACHE_VERSION}`,
  'icon.svg',
];

// --- install: прекешируем оболочку ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// --- activate: удаляем кеши прошлых версий ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// --- fetch: маршрутизация по типу запроса ---
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Не трогаем не-GET и стриминг аудио (Range-запросы плеера)
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);

  // 1) Навигация: сеть → кеш → офлайн-страница
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('index.html', copy));
          return response;
        })
        .catch(() =>
          caches
            .match('index.html')
            .then((cached) => cached || caches.match('./'))
            .then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // 2) Оболочка приложения (same-origin): кеш сразу, обновление в фоне
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      })
    );
    return;
  }

  // 3) Google Fonts: cache-first — шрифты статичны
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // 4) Остальные внешние источники — пропускаем напрямую
});

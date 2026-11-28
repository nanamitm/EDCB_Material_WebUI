const CACHE_NAME = 'e3-pwa-cache-v18';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './js/ts-loader.js',
  './js/hls.worker.js',
  './css/style.css',
  './css/ts-loader.css',
  './css/beer.min.css',
  './css/material-symbols-outlined.woff2',
  './css/material-symbols-rounded.woff2',
  './css/material-symbols-sharp.woff2',
  './css/material-symbols-subset.woff2',
  './css/loading-indicator.svg',
  './js/beer.min.js',
  './js/material-dynamic-colors.min.js',
  './js/danmaku.js',
  './js/hls.min.js',
  './js/aribb24.js',
  './js/intersect.min.js',
  './js/alpine.min.js',
  './Kosugi-Regular.woff2',
  './KosugiMaru-Bold.woff2',
  './KosugiMaru-Regular.woff2',
  './img/apple-touch-icon.png',
  './img/android-chrome-192x192.png',
  './img/android-chrome-512x512.png',
  './img/EpgTimer.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(async err => {
        await caches.delete(CACHE_NAME);
        throw err;
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('e3-pwa-cache-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.eventId;
  if (typeof id !== 'string' || !/^\d+-\d+-\d+-\d+$/.test(id)) return;
  const target = new URL(self.registration.scope);
  target.searchParams.set('id', id);
  target.hash = '#epg';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing?.navigate) {
      // 管理下にないウィンドウではnavigateが失敗するため、新しいウィンドウで開く
      try {
        const navigated = await existing.navigate(target.href);
        if (navigated) { await navigated.focus(); return; }
      } catch (e) {
        console.warn('Notification navigation failed:', e);
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isLogoApi = url.pathname.includes('/api/logo');

  // 動的APIやluaスクリプト、GET以外のリクエストはキャッシュ処理から除外する
  if (
    !url.protocol.startsWith('http') ||
    (url.pathname.includes('/api/') && !isLogoApi) ||
    url.pathname.includes('/video/') ||
    url.pathname.endsWith('.lua') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  const connection = navigator.connection || {}; // Safari非対応
  // モバイルネットワークまたはフォント、画像、サードパーティライブラリ(.min.)、ロゴAPIはキャッシュ優先(Cache-First)
  const isMobileNetwork = connection.type === 'cellular';
  const isCacheFirstAsset = isMobileNetwork ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.includes('.min.') ||
    isLogoApi;

  if (isCacheFirstAsset) {
    const matchOptions = isLogoApi ? {} : { ignoreSearch: true };
    event.respondWith(
      caches.match(event.request, matchOptions).then((cachedResponse) => {
        if (cachedResponse && isMobileNetwork) {
          return cachedResponse; 
        }

        const fetchPromise = fetch(event.request, { signal: AbortSignal.timeout(3000) }).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              const cacheKey = isLogoApi ? event.request.url : (url.origin + url.pathname);
              cache.put(cacheKey, responseToCache);
            });
          }
          return response;
        }).catch((err) => {
          console.warn('Background fetch failed:', err);
        });

        return cachedResponse || fetchPromise;
      })
    );
  } else {
    // index.html, style.css, app.js などの独自ロジックはネットワーク優先(Network-First)
    event.respondWith(
      fetch(event.request, { signal: AbortSignal.timeout(2000) })
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              const cleanUrl = url.origin + url.pathname;
              cache.put(cleanUrl, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
  }
});

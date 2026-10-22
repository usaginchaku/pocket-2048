/* Bump VERSION whenever any app-shell asset changes. */
const VERSION = 'v1';
const CACHE_PREFIX = 'pocket-2048-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const BASE = new URL('./', self.registration.scope);
const SHELL_URL = new URL('index.html', BASE).href;
const ASSET_PATHS = [
  'index.html',
  'app.js',
  'engine.js',
  'storage.js',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon.svg',
];
const ASSET_URLS = new Set(ASSET_PATHS.map((path) => new URL(path, BASE).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...ASSET_URLS].map((url) => new Request(url, {
      cache: 'reload',
      credentials: 'same-origin',
    })));
    // A new version waits until existing game windows close. Never reload a game.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== BASE.origin) return;

  const isGameNavigation = event.request.mode === 'navigate'
    && (url.pathname === BASE.pathname || url.pathname === new URL(SHELL_URL).pathname);
  // Cache only the explicit app shell. Leave authentication and other URLs alone.
  const cacheKey = isGameNavigation ? SHELL_URL : url.href;
  if (!isGameNavigation && !ASSET_URLS.has(cacheKey)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    return cached || fetch(event.request);
  })());
});

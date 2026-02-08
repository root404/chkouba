const CACHE_NAME = 'chkobba-offline-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './index.tsx',
  './App.tsx',
  './types.ts',
  './constants.tsx',
  './components/DrawingBoard.tsx',
  './components/Card.tsx',
  'https://cdn.tailwindcss.com',
  // Cache the ESM modules (this is a basic strategy, production apps bundle these)
  'https://esm.sh/react@^19.2.4',
  'https://esm.sh/react-dom@^19.2.4/',
  'https://esm.sh/lucide-react@^0.563.0',
  'https://esm.sh/lz-string@1.5.0'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // We try to cache what we can. 
      // Note: In this dev environment, direct file caching might be tricky depending on how it's served,
      // but this sets up the structure.
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.log("Caching specific files skipped in dev mode", err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Runtime Caching Strategy: Stale-While-Revalidate
// This allows the app to load from cache immediately, then update in background.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Cache the new response
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
             const responseToCache = networkResponse.clone();
             caches.open(CACHE_NAME).then((cache) => {
               cache.put(event.request, responseToCache);
             });
        }
        return networkResponse;
      }).catch(() => {
         // If offline and fetch fails, we just rely on cachedResponse
      });

      // Return cached response immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

const CACHE_NAME = 'fitlog-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // 优先尝试从网络获取，失败后再回退到缓存（针对 API 请求应反之，此处针对静态资源）
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(response => {
        // 动态缓存新的资源
        if (event.request.url.startsWith('http')) {
           return caches.open(CACHE_NAME).then(cache => {
             cache.put(event.request, response.clone());
             return response;
           });
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

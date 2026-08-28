/* FitLog Service Worker — same-origin-only cache, no CDN dependency. */
const CACHE_NAME = 'fitlog-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  // 自托管字体：地下室没信号时这几个必须已经在本地，
  // 否则整站中文掉回系统黑体，「墨与纸」当场归零。
  '/fonts/noto-sans-sc.woff2',
  '/fonts/noto-serif-sc.woff2',
  '/fonts/plex-mono-500.woff2',
  '/fonts/plex-mono-600.woff2',
  '/fonts/ma-shan-zheng.woff2',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 失败时不阻塞安装（如离线时某些静态文件暂不可用）
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] skip cache:', url, err)),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理 GET，且只缓存同源资源；跨域（字体/API）一律放行给浏览器
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 个人服务器同步接口不走缓存
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    }),
  );
});

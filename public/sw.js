/* FitLog Service Worker — same-origin-only cache, no CDN dependency. */
/**
 * 改名即清空旧缓存（activate 里删掉所有别的 key）。
 * v4 → v5：v4 是缓存优先拿 index.html 的那一版，见下面 fetch 里的长注释。
 * v5 → v6：v5 对 /fonts/ 也缓存优先 —— 但字体文件名不带内容哈希、
 *          内容会随子集重切而变，缓存优先等于「首次装机后字体永久冻结」。
 *          真机实测：印章子集在 v5 缓存里停在加入部位印文之前的旧版，
 *          胸肩背腿臂制六字逐字回退成系统黑体，且 FontFace 照样 load 成功、
 *          fonts.check() 照样返回 true —— 三层探针全是假绿。
 */
const CACHE_NAME = 'fitlog-v6';
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
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      // 立刻接管已经打开的页面。不加这句，新 SW 要等下一次导航才生效，
      // 于是「装了新包 → 还是旧行为」会再白屏一次。
      .then(() => self.clients.claim()),
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

  /**
   * 导航请求（HTML）必须网络优先，绝不能缓存优先。
   *
   * Vite 每次构建都给 bundle 换 hash，而 index.html 是唯一指向这些 hash 的文件。
   * 缓存优先 = 升级后仍然吐出旧 index.html，它引用的 chunk 在新包里已经不存在 ——
   * 结果是纯白屏，页面不报错，只在 logcat 里留一行
   * `Capacitor: Unable to open asset URL: .../assets/index-<旧hash>.js`。
   * （v4 就是这么坏的，换过一次图标重新打包就复现了。）
   *
   * 在 Capacitor 里「网络」就是 APK 内的本地资源服务器，永远可达，
   * 所以网络优先在这里没有任何离线代价；真离线时下面的 catch 仍然回落到缓存。
   */
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html'))),
    );
    return;
  }

  /**
   * 缓存优先【只给】/assets/ —— Vite 给它们的文件名带内容哈希，内容真不可变。
   *
   * 其余同源资源（/fonts/*.woff2、manifest、图标）文件名不带哈希、内容会变：
   * 字体子集每次重切字节都不同。对它们网络优先 ——
   * 在 Capacitor 里「网络」就是 APK 内的本地资源服务器，永远可达、零延迟，
   * 网络优先没有任何离线代价；真离线（浏览器 PWA 场景）仍回落到缓存。
   */
  const immutable = url.pathname.startsWith('/assets/');

  if (immutable) {
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
    return;
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req)),
  );
});

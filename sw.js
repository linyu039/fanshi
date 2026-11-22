/* 泛式 · Service Worker —— 让站点可离线打开（CDN 上的编码器除外） */
const VERSION = 'fanshi-v1';
const SHELL = [
  './', 'index.html',
  'assets/style.css',
  'assets/util.js', 'assets/ncm.js', 'assets/image.js', 'assets/pdfout.js',
  'assets/audio.js', 'assets/docx.js', 'assets/doc.js', 'assets/app.js',
  'assets/icon-64.png', 'assets/icon-192.png', 'assets/icon.ico',
  'tools/guide.html', 'tools/wenku_bookmarklet.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // CDN 资源交给浏览器自己缓存

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});

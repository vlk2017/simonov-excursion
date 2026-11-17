/* Simonov excursion: offline cache. Pages and data: network first. Audio and photos: cache first. */
const CACHE = "simonov-v9";
const CORE = ["./", "index.html", "css/style.css", "css/kremlin.css", "css/simonov-identity.css", "css/cover-chronicle.css", "js/app.js", "js/nav-core.js", "data/points.json", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("message", e => {
  if (!e.data || e.data.type !== "precache") return;
  const port = e.ports && e.ports[0];
  e.waitUntil(caches.open(CACHE).then(async c => {
    let ok = true, done = 0;
    const total = e.data.files.length;
    for (const f of e.data.files) {
      try { if (!(await c.match(f))) await c.add(f); } catch (err) { ok = false; }
      done++;
      if (e.data.progress && port) port.postMessage({ progress: done, total });
    }
    port && port.postMessage({ ok, done: true });
  }));
});

// Safari asks for audio with a Range header and needs a 206 answer.
async function rangeFrom(resp, range) {
  const buf = await resp.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const size = buf.byteLength;
  let start = m[1] ? Number(m[1]) : 0;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (!m[1] && m[2]) { start = size - Number(m[2]); end = size - 1; }
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206, statusText: "Partial Content",
    headers: { "Content-Type": "audio/mpeg", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" }
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isAudio = /\.mp3$/.test(url.pathname);
  const media = /\/(audio|img)\//.test(url.pathname) || /\/scripts\/.*\.txt$/.test(url.pathname);
  if (isAudio) {
    // Аудио: из кэша отдаём только если файл там уже целиком (с правильным 206 на Range, как требует iOS Safari).
    // Если в кэше нет — НЕ перехватываем запрос: браузер сам идёт в сеть с Range и начинает играть сразу,
    // а не ждёт, пока service worker скачает весь файл. Кэшируем только по кнопке «Скачать рассказы для офлайна».
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(new Request(url.href), { ignoreSearch: true });
      if (!hit) return fetch(req);
      const range = req.headers.get("range");
      return range ? rangeFrom(hit.clone(), range) : hit;
    })());
    return;
  }
  if (media) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      let hit = await c.match(req, { ignoreSearch: true });
      if (!hit) {
        const net = await fetch(url.href);
        if (net.ok && net.status === 200) { await c.put(url.href, net.clone()); hit = net; }
        else return net;
      }
      return hit;
    })());
    return;
  }
  e.respondWith(fetch(req, { cache: "no-cache" }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});

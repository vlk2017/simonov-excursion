/* Simonov excursion: offline cache. Pages and data: network first. Audio and photos: cache first. */
const CACHE = "simonov-v3";
const CORE = ["./", "index.html", "css/style.css", "js/app.js", "data/points.json", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("message", e => {
  if (!e.data || e.data.type !== "precache") return;
  const port = e.ports && e.ports[0];
  e.waitUntil(caches.open(CACHE).then(async c => {
    let ok = true;
    for (const f of e.data.files) {
      try { if (!(await c.match(f))) await c.add(f); } catch (err) { ok = false; }
    }
    port && port.postMessage({ ok });
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
    headers: { "Content-Type": resp.headers.get("Content-Type") || "audio/mpeg", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" }
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const media = /\/(audio|img)\//.test(url.pathname) || /\/scripts\/.*\.txt$/.test(url.pathname);
  if (media) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const key = url.pathname.endsWith(".mp3") ? new Request(url.href) : req;
      let hit = await c.match(key, { ignoreSearch: true });
      if (!hit) {
        const net = await fetch(url.href);
        if (net.ok && net.status === 200) { await c.put(url.href, net.clone()); hit = net; }
        else return net;
      }
      const range = req.headers.get("range");
      return range ? rangeFrom(hit.clone(), range) : hit;
    })());
    return;
  }
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});

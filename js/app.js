const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const state = {
  data: null,
  pos: null,
  watchId: null,
  currentId: null,
  opacity: 0.55,
  photoIdx: 0,
  cmp: 50,
  rate: 1,
  arriveOn: true,
  arriveId: null,
  cameraOn: false,
  stream: null,
  lastTrigger: {},
  map: null,
  markers: {},
  youMarker: null,
  navIndex: 0,
  heading: null,
};

const RADIUS = 25;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(m) {
  if (m == null || Number.isNaN(m)) return "—";
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m/1000).toFixed(1)} км`;
}

function showScreen(id) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3500);
}

function imgSrc(local, remote) {
  return local || remote || "";
}

async function loadData() {
  const res = await fetch("data/points.json");
  state.data = await res.json();
}

function distances() {
  if (!state.pos || !state.data) return {};
  const out = {};
  for (const p of state.data.points) {
    out[p.id] = haversine(state.pos.lat, state.pos.lon, p.lat, p.lon);
  }
  return out;
}

function updateNavigator() {
  if (!state.data) return;
  const points = state.data.points;
  const p = points[Math.min(state.navIndex, points.length - 1)];
  if (!p) return;
  $("#nav-step").textContent = String(p.num).padStart(2, "0");
  $("#nav-title").textContent = p.title;
  const d = state.pos ? haversine(state.pos.lat, state.pos.lon, p.lat, p.lon) : null;
  $("#nav-distance").textContent = d == null
    ? "Включите геолокацию — покажем расстояние до остановки"
    : d <= 20 ? "Вы рядом. Остановитесь и осмотритесь." : "До остановки " + fmtDist(d) + " · направление " + dirName(bearingTo(state.pos.lat, state.pos.lon, p.lat, p.lon));
  const destination = p.lat + "," + p.lon;
  const origin = state.pos ? state.pos.lat + "," + state.pos.lon : "";
  $("#nav-route").href = state.pos
    ? "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(origin) + "&destination=" + encodeURIComponent(destination) + "&travelmode=walking"
    : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination) + "&travelmode=walking";
  $("#nav-open").textContent = "Открыть точку " + p.num;
  $("#nav-note").textContent = p.dir || "На месте откройте исторический вид и сравните его с тем, что перед вами.";
}

function renderList() {
  const dist = distances();
  const box = $("#list");
  box.innerHTML = "";
  for (const p of state.data.points) {
    const d = dist[p.id];
    const near = d != null && d <= (state.data.radiusM || RADIUS);
    const btn = document.createElement("button");
    btn.className = "point-card" + (near ? " near" : "");
    btn.innerHTML = `
      <div class="point-num">${p.num}</div>
      <div>
        <h3>${p.title}</h3>
        <p>${p.short}</p>
      </div>
      <div class="dist">${fmtDist(d)}</div>
    `;
    btn.addEventListener("click", () => openPoint(p.id, false));
    box.appendChild(btn);
  }
}

function initMap() {
  if (state.map || !window.L || !state.data) return;
  const c = state.data.mapCenter;
  state.map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView(c, state.data.mapZoom || 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);
  const routeCoords = state.data.points.map(p => [p.lat, p.lon]);
  L.polyline(routeCoords, { color: "#b9a77e", weight: 3, opacity: .8, dashArray: "5 8" }).addTo(state.map);
  for (const p of state.data.points) {
    const m = L.circleMarker([p.lat, p.lon], {
      radius: 8, color: "#d4b06a", weight: 2, fillColor: "#9a3f2c", fillOpacity: .9
    }).addTo(state.map);
    m.bindPopup(`<b>${p.num}. ${p.title}</b>`);
    m.on("click", () => openPoint(p.id, false));
    state.markers[p.id] = m;
  }
  setTimeout(() => state.map.invalidateSize(), 200);
}

function updateYouMarker() {
  if (!state.map || !state.pos || !window.L) return;
  const latlng = [state.pos.lat, state.pos.lon];
  if (!state.youMarker) {
    state.youMarker = L.circleMarker(latlng, {
      radius: 7, color: "#f4ebda", weight: 2, fillColor: "#7d9a5a", fillOpacity: 1
    }).addTo(state.map).bindPopup("Вы здесь");
  } else {
    state.youMarker.setLatLng(latlng);
  }
}

function setGpsPill(ok, acc) {
  const el = $("#gps-pill");
  const btn = $("#btn-gps");
  if (!el) return;
  if (ok) {
    el.className = "gps-pill on";
    el.textContent = acc != null ? `Вы здесь, около ${Math.round(acc)} м` : "Место найдено";
    if (btn) btn.textContent = "Обновить место";
  } else {
    el.className = "gps-pill off";
    el.textContent = "Место не найдено";
    if (btn) btn.textContent = "Найти меня";
  }
}

function onPosition(pos) {
  state.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
  setGpsPill(true, state.pos.acc);
  updateYouMarker();
  renderList();
  updateNavigator();
  maybeAutoTrigger();
  updateStandLive();
}

function maybeAutoTrigger() {
  // Never autoplay: only offer. Audio starts from the user's tap (iOS requirement).
  if (!state.pos || !state.data || !state.arriveOn) return;
  const r = state.data.radiusM || RADIUS;
  let closest = null;
  for (const p of state.data.points) {
    const d = haversine(state.pos.lat, state.pos.lon, p.lat, p.lon);
    if (d <= r && (!closest || d < closest.d)) closest = { p, d };
  }
  if (!closest) return;
  const now = Date.now();
  if (state.currentId === closest.p.id) return;
  if (state.lastTrigger[closest.p.id] && now - state.lastTrigger[closest.p.id] < 5 * 60000) return;
  state.lastTrigger[closest.p.id] = now;
  if (navigator.vibrate) navigator.vibrate(80);
  state.arriveId = closest.p.id;
  $("#arrive-text").innerHTML = `Вы у точки ${closest.p.num}: <b>${closest.p.title}</b>. Включить рассказ?`;
  $("#arrive").classList.remove("hidden");
}

function enableGps() {
  if (!navigator.geolocation) {
    setGpsPill(false);
    toast("Телефон не умеет определить место. Откройте точку в списке и нажмите «Я на месте».");
    return;
  }
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    onPosition,
    (err) => {
      setGpsPill(false);
      toast("Не удалось найти место. Откройте точку в списке или нажмите «Я на месте».");
      console.warn(err);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
  );
}

function bindImg(img, local, remote, alt) {
  img.alt = alt || "";
  const tryRemote = () => {
    if (remote && img.dataset.tried !== "remote") {
      img.dataset.tried = "remote";
      img.src = remote;
    }
  };
  img.onerror = tryRemote;
  if (local) {
    img.dataset.tried = "local";
    img.src = local;
    // If local 404, error handler will swap
  } else if (remote) {
    tryRemote();
  }
}

/* ---------- Photos, viewpoint, then/now ---------- */
const DIRS = ["север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад"];
function dirName(b) { return DIRS[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }
function thumbOf(src) {
  if (!src) return "";
  if (src.startsWith("img/then/")) return src.replace("img/then/", "img/thumbs/");
  if (src.startsWith("img/now/")) return src.replace("img/now/", "img/thumbs/").replace(/\.jpg$/, "-now.jpg");
  return src;
}
function bearingTo(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function shortAuthor(a) { return (a || "автор неизвестен").replace(/\s*\(.*$/, ""); }
function esc(t) { return String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function currentPoint() { return state.data && state.data.points.find(x => x.id === state.currentId); }
function currentPhoto() { const p = currentPoint(); return p && p.photos[state.photoIdx || 0]; }

/* list for the lightbox: all old photos, then modern ones */
function galleryItems(p) {
  const out = p.photos.map((ph, i) => ({ src: ph.src, remote: ph.remote, cap: `${ph.year} · ${shortAuthor(ph.author)} — ${ph.title}`, photoIdx: i }));
  p.photos.forEach(ph => { if (ph.now) out.push({ src: ph.now.src, remote: ph.now.remote, cap: `Сейчас, ${ph.now.year} · ${ph.now.author}, ${ph.now.license} — ${ph.now.note}` }); });
  if (p.nowContext) out.push({ src: p.nowContext.src, remote: p.nowContext.remote, cap: `Сейчас, ${p.nowContext.year} · ${p.nowContext.author}, ${p.nowContext.license} — ${p.nowContext.note}` });
  return out;
}

function openPoint(id, play) {
  const p = state.data.points.find(x => x.id === id);
  if (!p) return;
  state.currentId = id;
  stopCamera();
  showScreen("screen-point");
  window.scrollTo(0, 0);
  $("#point-title").textContent = p.title;
  $("#point-num-label").textContent = `Точка ${p.num} из ${state.data.points.length}`;
  $("#point-short").textContent = p.summary || p.short;
  $("#point-dir").textContent = p.dir || "";

  const audio = $("#player");
  audio.src = p.audio;
  audio.load();
  audio.playbackRate = state.rate;
  if (play) audio.play().catch(() => toast("Нажмите «Слушать», чтобы включить рассказ"));

  // thumbnails
  const th = $("#thumbs");
  th.innerHTML = "";
  p.photos.forEach((ph, i) => {
    const b = document.createElement("button");
    b.className = "thumb";
    b.setAttribute("role", "listitem");
    b.setAttribute("aria-label", `${ph.title}, ${ph.year}`);
    b.innerHTML = `<img src="${thumbOf(ph.src)}" alt="" loading="lazy"><span>${esc(String(ph.year).replace(/^(около|ок\.)\s*/, "~").slice(0, 9))}</span>${ph.now ? '<i title="есть пара сейчас">⇆</i>' : ""}`;
    b.addEventListener("click", () => selectPhoto(i));
    th.appendChild(b);
  });
  th.classList.toggle("hidden", p.photos.length < 2);

  // narration text
  const tb = $("#script-text");
  tb.textContent = "…";
  fetch(p.script).then(r => r.text()).then(t => {
    tb.innerHTML = t.trim().split(/\n\s*\n/).map(x => `<p>${esc(x.trim())}</p>`).join("");
  }).catch(() => { tb.textContent = "Текст не загрузился."; });

  // modern context photo (no exact pair)
  const nc = $("#now-context");
  if (p.nowContext) {
    nc.classList.remove("hidden");
    bindImg($("#now-context-img"), p.nowContext.src, p.nowContext.remote, "Сейчас");
    $("#now-context-cap").innerHTML = `Как сейчас: ${esc(p.nowContext.note)}. ${esc(p.nowContext.year)}, ${esc(p.nowContext.author)}, ${esc(p.nowContext.license)}, <a href="${p.nowContext.commons}" target="_blank" rel="noopener">Викисклад</a>. Точной пары к старым снимкам этот кадр не даёт.`;
  } else nc.classList.add("hidden");

  selectPhoto(0);
}

function selectPhoto(i) {
  const p = currentPoint();
  if (!p) return;
  state.photoIdx = i;
  const ph = p.photos[i];
  $$("#thumbs .thumb").forEach((b, k) => b.classList.toggle("on", k === i));
  bindImg($("#then-img"), ph.src, ph.remote, ph.title);
  bindImg($("#overlay-img"), ph.src, ph.remote, ph.title);
  $("#hero-count").textContent = p.photos.length > 1 ? `${i + 1} / ${p.photos.length}` : "";
  $("#photo-caption").innerHTML = `${esc(ph.year)} · ${esc(shortAuthor(ph.author))}<span class="cap-title">${esc(ph.title)}. Нажмите на фото, чтобы открыть на весь экран.</span>`;

  // where to stand
  const vp = ph.viewpoint;
  const needle = $("#stand-needle");
  const links = [];
  if (vp) {
    const hasB = vp.bearing != null;
    needle.style.display = hasB ? "" : "none";
    if (hasB) needle.setAttribute("transform", `rotate(${state.heading == null ? vp.bearing : (vp.bearing - state.heading + 360) % 360} 32 32)`);
    $("#stand-text").innerHTML = `${esc(ph.stand)}${hasB ? ` <span class="muted">Взгляд — на ${dirName(vp.bearing)}.</span>` : ""}`;
    links.push(`<a href="https://www.openstreetmap.org/?mlat=${vp.lat}&mlon=${vp.lon}#map=19/${vp.lat}/${vp.lon}" target="_blank" rel="noopener">Точка на карте</a>`);
    if (vp.source && vp.source.includes("pastvu")) links.push(`<a href="${vp.source}" target="_blank" rel="noopener">Источник точки — PastVu</a>`);
  } else {
    needle.style.display = "none";
    $("#stand-text").innerHTML = `${esc(ph.stand || "Точное место съёмки этого кадра не установлено.")}`;
  }
  $("#stand-links").innerHTML = links.join(" · ");
  updateStandLive();

  // then / now pair
  const cmp = $("#compare");
  if (ph.now) {
    cmp.classList.remove("hidden");
    bindImg($("#cmp-now"), ph.now.src, ph.now.remote, "Сейчас");
    bindImg($("#cmp-then"), ph.src, ph.remote, "Тогда");
    $("#cmp-note").innerHTML = `Тяните ползунок: слева ${esc(ph.year)}, справа ${esc(ph.now.year)} (${esc(ph.now.author)}, ${esc(ph.now.license)}, <a href="${ph.now.commons}" target="_blank" rel="noopener">Викисклад</a>). ` +
      esc((ph.now.align && ph.now.align.note) || "");
    setCmp(50);
    requestAnimationFrame(layoutCmp);
  } else {
    cmp.classList.add("hidden");
  }

  // rights
  $("#photo-meta").innerHTML = `
    <p><b>Старое фото.</b> ${esc(ph.year)}. ${esc(ph.author)}. ${esc(ph.title)}.</p>
    <p>${esc(ph.license)}. ${esc(ph.rights)}</p>
    <p><a href="${ph.commons}" target="_blank" rel="noopener">Карточка на Викискладе</a></p>
    ${p.photos.some(x => x.now) ? "" : `<p>Современного снимка с той же точки на Викискладе не нашлось. Пары «тогда — сейчас» для этой точки нет — честно.</p>`}
    ${(p.moreLinks || []).length ? `<div class="more-links"><p><b>Ещё снимки — только по ссылке.</b> Они хранятся на сайте «История России в фотографиях». Права на них у музеев, архивов и авторов, поэтому копировать их сюда мы не можем.</p><ul>${p.moreLinks.map(l => `<li><a href="${l.url}" target="_blank" rel="noopener">${esc(l.title)}</a>, ${esc(l.year)}, ${esc(l.author)} (${esc(l.source)})${l.note ? `. ${esc(l.note)}` : ""}</li>`).join("")}</ul></div>` : ""}`;
}

function layoutCmp() {
  const ph = currentPhoto();
  if (!ph || !ph.now) return;
  const frame = $("#cmp-frame"), nowImg = $("#cmp-now"), thenImg = $("#cmp-then");
  const set = () => {
    const W = frame.clientWidth;
    if (nowImg.naturalWidth) frame.style.aspectRatio = `${nowImg.naturalWidth} / ${nowImg.naturalHeight}`;
    const a = ph.now.align || { w: 1, x: 0, y: 0 };
    thenImg.style.width = (a.w * W) + "px";
    thenImg.style.left = (a.x * W) + "px";
    thenImg.style.top = (a.y * W) + "px";
  };
  if (nowImg.complete) set(); else nowImg.onload = set;
  set();
}

function setCmp(pct) {
  pct = Math.max(0, Math.min(100, pct));
  state.cmp = pct;
  $("#cmp-then-wrap").style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  $("#cmp-then-wrap").style.webkitClipPath = `inset(0 ${100 - pct}% 0 0)`;
  const h = $("#cmp-handle");
  h.style.left = pct + "%";
  h.setAttribute("aria-valuenow", Math.round(pct));
}

function initCompare() {
  const frame = $("#cmp-frame");
  let drag = false;
  const move = e => {
    const r = frame.getBoundingClientRect();
    setCmp((e.clientX - r.left) / r.width * 100);
  };
  frame.addEventListener("pointerdown", e => { drag = true; frame.setPointerCapture(e.pointerId); move(e); });
  frame.addEventListener("pointermove", e => { if (drag) move(e); });
  const end = () => { drag = false; };
  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);
  $("#cmp-handle").addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") setCmp(state.cmp - 5);
    if (e.key === "ArrowRight") setCmp(state.cmp + 5);
  });
  window.addEventListener("resize", layoutCmp);
}

/* live hint: how far and which way to step to reach the photographer's spot */
async function enableCompass() {
  if (!("DeviceOrientationEvent" in window)) {
    toast("Компас не поддерживается этим телефоном. Используйте направление на карте.");
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        toast("Доступ к компасу не разрешён.");
        return;
      }
    }
    const handler = e => {
      let heading = null;
      if (typeof e.webkitCompassHeading === "number") heading = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === "number") heading = (360 - e.alpha) % 360;
      if (heading != null) {
        state.heading = heading;
        updateStandLive();
      }
    };
    window.addEventListener("deviceorientation", handler, true);
    toast("Компас включён. Держите телефон перед собой.");
  } catch (err) {
    toast("Не удалось включить компас. Проверьте разрешения телефона.");
  }
}

function updateStandLive() {
  const el = $("#stand-live");
  if (!el) return;
  const ph = currentPhoto();
  const vp = ph && ph.viewpoint;
  if (!vp || !state.pos) {
    el.textContent = vp ? "Включите «Найти меня» на карте — подскажем, куда шагнуть." : "";
    return;
  }
  const d = haversine(state.pos.lat, state.pos.lon, vp.lat, vp.lon);
  const acc = state.pos.acc ? Math.round(state.pos.acc) : null;
  if (d > 60) {
    el.textContent = `Точка съёмки в ${fmtDist(d)} от вас, на ${dirName(bearingTo(state.pos.lat, state.pos.lon, vp.lat, vp.lon))}.`;
    return;
  }
  if (d < 4) { el.textContent = "Вы почти на месте фотографа. Повернитесь, как показывает стрелка."; return; }
  if (vp.bearing == null) { el.textContent = `До точки съёмки около ${Math.round(d)} м, на ${dirName(bearingTo(state.pos.lat, state.pos.lon, vp.lat, vp.lon))}.`; return; }
  // vector from user to viewpoint in metres, then split along/across the view direction
  const r = Math.PI / 180;
  const dn = (vp.lat - state.pos.lat) * 111320;
  const de = (vp.lon - state.pos.lon) * 111320 * Math.cos(vp.lat * r);
  const fx = Math.sin(vp.bearing * r), fy = Math.cos(vp.bearing * r);
  const along = de * fx + dn * fy;      // >0: step forward (in view direction)
  const right = de * fy - dn * fx;      // >0: step right (when facing the view direction)
  const steps = m => Math.max(1, Math.round(Math.abs(m) / 0.7));
  const parts = [];
  if (Math.abs(right) >= 2) parts.push(`${steps(right)} шагов ${right > 0 ? "вправо" : "влево"}`);
  if (Math.abs(along) >= 2) parts.push(`${steps(along)} шагов ${along > 0 ? "вперёд" : "назад"}`);
  el.textContent = `Встаньте лицом на ${dirName(vp.bearing)} и сделайте ${parts.join(" и ") || "пару шагов"}.` + (acc && acc > 10 ? ` GPS сейчас ошибается примерно на ${acc} м.` : "");
}

/* ---------- Lightbox: pinch-zoom, pan, swipe, back gesture ---------- */
const lb = { items: [], i: 0, s: 1, x: 0, y: 0, ptrs: new Map(), start: null, lastTap: 0, open: false };

function lbOpen(items, i) {
  lb.items = items; lb.i = i; lb.open = true;
  $("#lightbox").classList.remove("hidden");
  document.documentElement.classList.add("lb-on");
  history.pushState({ lb: 1 }, "");
  lbShow();
}
function lbClose(fromPop) {
  if (!lb.open) return;
  lb.open = false;
  $("#lightbox").classList.add("hidden");
  document.documentElement.classList.remove("lb-on");
  if (!fromPop && history.state && history.state.lb) history.back();
}
function lbShow() {
  const it = lb.items[lb.i];
  lb.s = 1; lb.x = 0; lb.y = 0; lbApply();
  bindImg($("#lb-img"), it.src, it.remote, it.cap);
  $("#lb-cap").textContent = `${lb.i + 1} / ${lb.items.length} · ${it.cap}`;
  $("#lb-prev").classList.toggle("hidden", lb.items.length < 2);
  $("#lb-next").classList.toggle("hidden", lb.items.length < 2);
}
function lbGo(d) { lb.i = (lb.i + d + lb.items.length) % lb.items.length; lbShow(); }
function lbClamp() {
  const st = $("#lb-stage"), img = $("#lb-img");
  const W = st.clientWidth, H = st.clientHeight;
  const iw = img.clientWidth * lb.s, ih = img.clientHeight * lb.s;
  const mx = Math.max(0, (iw - W) / 2), my = Math.max(0, (ih - H) / 2);
  lb.x = Math.max(-mx, Math.min(mx, lb.x));
  lb.y = Math.max(-my, Math.min(my, lb.y));
}
function lbApply(anim) {
  const img = $("#lb-img");
  img.style.transition = anim ? "transform .2s ease" : "none";
  img.style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.s})`;
}
function lbZoomAt(ns, cx, cy) {
  // keep the point under (cx,cy) fixed (coords relative to stage centre)
  ns = Math.max(1, Math.min(6, ns));
  lb.x = cx - (cx - lb.x) * ns / lb.s;
  lb.y = cy - (cy - lb.y) * ns / lb.s;
  lb.s = ns;
  if (lb.s === 1) { lb.x = 0; lb.y = 0; }
  lbClamp();
}
function initLightbox() {
  const st = $("#lb-stage");
  const rel = e => { const r = st.getBoundingClientRect(); return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }; };
  st.addEventListener("pointerdown", e => {
    st.setPointerCapture(e.pointerId);
    lb.ptrs.set(e.pointerId, rel(e));
    const pts = [...lb.ptrs.values()];
    if (pts.length === 1) {
      lb.start = { mode: "pan", p: pts[0], x: lb.x, y: lb.y, t: Date.now() };
    } else if (pts.length === 2) {
      const [a, b] = pts;
      lb.start = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), s: lb.s, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: lb.x, y: lb.y };
    }
  });
  st.addEventListener("pointermove", e => {
    if (!lb.ptrs.has(e.pointerId) || !lb.start) return;
    lb.ptrs.set(e.pointerId, rel(e));
    const pts = [...lb.ptrs.values()];
    if (lb.start.mode === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ns = Math.max(1, Math.min(6, lb.start.s * d / lb.start.d));
      // zoom around the initial midpoint, then follow the fingers
      lb.x = lb.start.mid.x - (lb.start.mid.x - lb.start.x) * ns / lb.start.s + (mid.x - lb.start.mid.x);
      lb.y = lb.start.mid.y - (lb.start.mid.y - lb.start.y) * ns / lb.start.s + (mid.y - lb.start.mid.y);
      lb.s = ns; lbClamp(); lbApply();
    } else if (lb.start.mode === "pan") {
      const dx = pts[0].x - lb.start.p.x, dy = pts[0].y - lb.start.p.y;
      if (lb.s > 1.01) { lb.x = lb.start.x + dx; lb.y = lb.start.y + dy; lbClamp(); lbApply(); }
      else { lb.x = dx; lb.y = Math.max(0, dy) * 0.6; lbApply(); }  // follow finger for swipe / pull-down
    }
  });
  const up = e => {
    if (!lb.ptrs.has(e.pointerId)) return;
    const p = lb.ptrs.get(e.pointerId);
    lb.ptrs.delete(e.pointerId);
    const s = lb.start;
    if (!s) return;
    if (s.mode === "pinch") {
      if (lb.ptrs.size === 1) { const q = [...lb.ptrs.values()][0]; lb.start = { mode: "pan", p: q, x: lb.x, y: lb.y, t: Date.now(), afterPinch: true }; }
      else lb.start = null;
      if (lb.s < 1.02) { lb.s = 1; lb.x = 0; lb.y = 0; lbApply(true); }
      return;
    }
    lb.start = null;
    const dx = p.x - s.p.x, dy = p.y - s.p.y;
    const tap = Math.abs(dx) < 8 && Math.abs(dy) < 8 && Date.now() - s.t < 300;
    if (tap) {
      const now = Date.now();
      if (now - lb.lastTap < 300) { lbZoomAt(lb.s > 1.01 ? 1 : 2.5, p.x, p.y); lbApply(true); lb.lastTap = 0; }
      else lb.lastTap = now;
      return;
    }
    if (lb.s <= 1.01 && !s.afterPinch) {
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { lbClose(); return; }
      if (Math.abs(dx) > 60 && lb.items.length > 1) { lbGo(dx < 0 ? 1 : -1); return; }
      lb.x = 0; lb.y = 0; lbApply(true);
    }
  };
  st.addEventListener("pointerup", up);
  st.addEventListener("pointercancel", up);
  st.addEventListener("wheel", e => { e.preventDefault(); const p = rel(e); lbZoomAt(lb.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), p.x, p.y); lbApply(); }, { passive: false });
  // Safari iOS: suppress native page pinch inside the viewer
  ["gesturestart", "gesturechange"].forEach(ev => st.addEventListener(ev, e => e.preventDefault()));
  $("#lb-close").addEventListener("click", () => lbClose());
  $("#lb-prev").addEventListener("click", () => lbGo(-1));
  $("#lb-next").addEventListener("click", () => lbGo(1));
  document.addEventListener("keydown", e => {
    if (!lb.open) return;
    if (e.key === "Escape") lbClose();
    if (e.key === "ArrowLeft") lbGo(-1);
    if (e.key === "ArrowRight") lbGo(1);
  });
  window.addEventListener("popstate", () => { if (lb.open) lbClose(true); });
  window.addEventListener("resize", () => { if (lb.open) { lbClamp(); lbApply(); } });
}

function openLightboxForCurrent(src) {
  const p = currentPoint();
  if (!p || state.cameraOn) return;
  const items = galleryItems(p);
  let i = items.findIndex(it => it.src === src);
  lbOpen(items, Math.max(0, i));
}

function closePoint() {
  $("#player").pause();
  stopCamera();
  state.currentId = null;
  showScreen("screen-tour");
  setTimeout(() => state.map && state.map.invalidateSize(), 200);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Камера недоступна. Сравните снимки ниже.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    state.stream = stream;
    state.cameraOn = true;
    const video = $("#live-video");
    video.srcObject = stream;
    video.classList.remove("hidden");
    await video.play();
    $("#then-img").classList.add("hidden");
    const ov = $("#overlay-img");
    ov.classList.remove("hidden");
    ov.style.opacity = state.opacity;
    $("#cam-slider").classList.remove("hidden");
    $("#btn-camera").textContent = "Закрыть камеру";
    toast("Встаньте, как подсказано под фото, и двигайте ползунок.");
  } catch (e) {
    console.warn(e);
    toast("Нет доступа к камере.");
    stopCamera();
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  const video = $("#live-video");
  video.pause();
  video.srcObject = null;
  video.classList.add("hidden");
  state.cameraOn = false;
  $("#btn-camera").textContent = "Открыть камеру";
  $("#then-img").classList.remove("hidden");
  $("#overlay-img").classList.add("hidden");
  $("#cam-slider").classList.add("hidden");
}

function imHere() {
  const p = currentPoint();
  if (!p) return;
  state.lastTrigger[p.id] = Date.now();
  const audio = $("#player");
  audio.currentTime = 0;
  audio.playbackRate = state.rate;
  audio.play().catch(() => toast("Нажмите «Слушать», чтобы включить рассказ"));
}

function startTour(opts = {}) {
  showScreen("screen-tour");
  updateNavigator();
  initMap();
  renderList();
  if (opts.askGps !== false) enableGps();
  setTimeout(() => state.map && state.map.invalidateSize(), 250);
}

function applyHash() {
  const h = (location.hash || "").replace(/^#/, "");
  if (h === "tour" || h === "list") startTour({ askGps: false });
  else if (h === "about") showScreen("screen-about");
  else if (h.startsWith("point=")) {
    startTour({ askGps: false });
    const [id, ph] = h.slice(6).split(":");
    openPoint(id, false);
    if (ph) selectPhoto(Number(ph) || 0);
  }
}

/* offline: service worker caches pages, audio and photos */
function initOffline() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").then(async reg => {
    await navigator.serviceWorker.ready;
    if (localStorage.getItem("simonov-offline") === "v3") return;
    const files = new Set(["data/points.json"]);
    for (const p of state.data.points) {
      files.add(p.script);
      p.photos.forEach(ph => { files.add(ph.src); files.add(thumbOf(ph.src)); if (ph.now) { files.add(ph.now.src); files.add(thumbOf(ph.now.src)); } });
      if (p.nowContext) files.add(p.nowContext.src);
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = e => {
      if (e.data && e.data.ok) { localStorage.setItem("simonov-offline", "v3"); toast("Экскурсия сохранена: рассказы и фото будут работать без интернета."); }
    };
    (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: "precache", files: [...files] }, [ch.port2]);
  }).catch(e => console.warn("sw", e));
}

async function main() {
  await loadData();
  state.rate = Number(localStorage.getItem("simonov-rate")) || 1;
  state.arriveOn = localStorage.getItem("simonov-arrive") !== "0";
  $("#opt-arrive").checked = state.arriveOn;
  $("#cover-title").textContent = state.data.title;
  $("#cover-lead").textContent = state.data.subtitle;
  $("#cover-place").textContent = state.data.place;
  initCompare();
  initLightbox();
  renderList();
  applyHash();

  $("#btn-start").addEventListener("click", startTour);
  $("#nav-open").addEventListener("click", () => openPoint(state.data.points[state.navIndex].id, false));
  $("#nav-next").addEventListener("click", () => {
    state.navIndex = (state.navIndex + 1) % state.data.points.length;
    updateNavigator();
    const p = state.data.points[state.navIndex];
    if (state.markers[p.id] && state.map) state.map.setView([p.lat, p.lon], 18);
  });
  $("#btn-about").addEventListener("click", () => showScreen("screen-about"));
  $$("[data-back=tour]").forEach(b => b.addEventListener("click", () => {
    showScreen("screen-tour");
    setTimeout(() => state.map && state.map.invalidateSize(), 200);
  }));
  $("#btn-back-point").addEventListener("click", closePoint);
  $("#btn-gps").addEventListener("click", enableGps);
  $("#btn-here").addEventListener("click", imHere);
  $("#btn-camera").addEventListener("click", () => { state.cameraOn ? stopCamera() : startCamera(); });
  $("#btn-compass").addEventListener("click", enableCompass);
  $("#then-img").addEventListener("click", () => openLightboxForCurrent(currentPhoto().src));
  $("#then-img").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightboxForCurrent(currentPhoto().src); } });
  $("#btn-full").addEventListener("click", () => openLightboxForCurrent(currentPhoto().src));
  $("#now-context-img").addEventListener("click", () => { const p = currentPoint(); openLightboxForCurrent(p.nowContext.src); });
  $("#cmp-frame").addEventListener("dblclick", () => { const ph = currentPhoto(); openLightboxForCurrent(state.cmp > 50 ? ph.src : ph.now.src); });
  $("#opacity").addEventListener("input", (e) => {
    state.opacity = Number(e.target.value);
    $("#overlay-img").style.opacity = state.opacity;
    $("#opacity-val").textContent = Math.round(state.opacity * 100) + "%";
  });
  $("#opt-arrive").addEventListener("change", e => {
    state.arriveOn = e.target.checked;
    localStorage.setItem("simonov-arrive", state.arriveOn ? "1" : "0");
  });
  $("#arrive-go").addEventListener("click", () => {
    $("#arrive").classList.add("hidden");
    openPoint(state.arriveId, true);   // started by the tap, so iOS allows playback
  });
  $("#arrive-no").addEventListener("click", () => $("#arrive").classList.add("hidden"));

  const player = $("#player");
  const playBtn = $("#btn-play");
  playBtn.addEventListener("click", () => {
    if (player.paused) { player.playbackRate = state.rate; player.play(); } else player.pause();
  });
  player.addEventListener("play", () => { playBtn.textContent = "Пауза"; });
  player.addEventListener("pause", () => { playBtn.textContent = "Слушать"; });
  player.addEventListener("ended", () => { playBtn.textContent = "Слушать"; });
  player.addEventListener("loadedmetadata", () => { player.playbackRate = state.rate; });
  const markRate = () => $$("#speed button").forEach(b => b.classList.toggle("on", Number(b.dataset.rate) === state.rate));
  $$("#speed button").forEach(b => b.addEventListener("click", () => {
    state.rate = Number(b.dataset.rate);
    player.playbackRate = state.rate;
    localStorage.setItem("simonov-rate", String(state.rate));
    markRate();
  }));
  markRate();
  initOffline();
}

main().catch(err => {
  console.error(err);
  toast("Не удалось загрузить данные экскурсии.");
});

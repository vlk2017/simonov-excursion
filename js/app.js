const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const state = {
  data: null,
  pos: null,
  watchId: null,
  currentId: null,
  opacity: 0.55,
  cameraOn: false,
  stream: null,
  lastTrigger: {},
  map: null,
  markers: {},
  youMarker: null,
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
  maybeAutoTrigger();
}

function maybeAutoTrigger() {
  if (!state.pos || !state.data) return;
  const r = state.data.radiusM || RADIUS;
  let closest = null;
  for (const p of state.data.points) {
    const d = haversine(state.pos.lat, state.pos.lon, p.lat, p.lon);
    if (d <= r && (!closest || d < closest.d)) closest = { p, d };
  }
  if (!closest) return;
  const now = Date.now();
  if (state.currentId === closest.p.id) return;
  if (state.lastTrigger[closest.p.id] && now - state.lastTrigger[closest.p.id] < 45000) return;
  state.lastTrigger[closest.p.id] = now;
  if (navigator.vibrate) navigator.vibrate(80);
  toast(`Вы у точки ${closest.p.num}. ${closest.p.title}`);
  openPoint(closest.p.id, true);
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

function mediaUrl(local, remote) {
  return { local, remote };
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

function openPoint(id, auto) {
  const p = state.data.points.find(x => x.id === id);
  if (!p) return;
  state.currentId = id;
  stopCamera(false);
  showScreen("screen-point");
  $("#point-title").textContent = p.title;
  $("#point-num-label").textContent = `Точка ${p.num} из ${state.data.points.length}`;
  $("#point-short").textContent = p.summary || p.short;
  $("#point-dir").textContent = p.dir || "";
  const acc = $("#point-accuracy");
  const accText = [p.photoAccuracyNote, p.photoAccuracy ? `Точность точки: ${p.photoAccuracy}.` : ""].filter(Boolean).join(" ");
  acc.textContent = accText;

  const audio = $("#player");
  audio.src = p.audio;
  audio.load();
  if (auto) {
    const play = audio.play();
    if (play && play.catch) play.catch(() => toast("Нажмите «Слушать», чтобы включить рассказ"));
  }

  const thenImg = $("#then-img");
  const overImg = $("#overlay-img");
  const baseNow = $("#base-now");
  bindImg(thenImg, p.then, p.thenRemote, p.photo.title);
  bindImg(overImg, p.then, p.thenRemote, p.photo.title);
  if (p.now || p.nowRemote) {
    bindImg(baseNow, p.now, p.nowRemote, "Сейчас");
    baseNow.classList.remove("hidden");
    thenImg.classList.add("hidden");
  } else {
    baseNow.removeAttribute("src");
    baseNow.classList.add("hidden");
    thenImg.classList.remove("hidden");
  }
  overImg.classList.remove("hidden");
  overImg.style.opacity = state.opacity;
  $("#opacity").value = state.opacity;
  $("#opacity-val").textContent = Math.round(state.opacity * 100) + "%";

  const nowWrap = $("#now-side");
  const nowImg = $("#now-img");
  if (p.now || p.nowRemote) {
    nowWrap.classList.remove("hidden");
    bindImg(nowImg, p.now, p.nowRemote, "Сейчас");
    $("#now-cap").textContent = p.nowCredit || "Современный снимок";
  } else {
    nowWrap.classList.add("hidden");
    nowImg.removeAttribute("src");
  }

  const ph = p.photo || {};
  const authorShort = (ph.author || "автор неизвестен").replace(/\s*\(.*$/, "");
  const cap = $("#photo-caption");
  if (cap) {
    const yearAuthor = [ph.year, authorShort].filter(Boolean).join(" · ");
    cap.innerHTML = `${yearAuthor}${ph.title ? `<span class="cap-title">${ph.title}</span>` : ""}`;
  }
  $("#photo-meta").innerHTML = `
    <p><b>Старое фото.</b> ${ph.year || ""}. ${authorShort}. ${ph.title || ""}</p>
    <p>${ph.rightsStatus || ph.license || ""}</p>
    ${ph.commons ? `<p><a href="${ph.commons}" target="_blank" rel="noopener">Карточка на Викискладе</a></p>` : ""}
    ${ph.pastvu ? `<p><a href="${ph.pastvu}" target="_blank" rel="noopener">Точка на PastVu</a></p>` : ""}
  `;

  const exact = $("#exact-point");
  if (p.exactPhotoLat) {
    exact.classList.remove("hidden");
    exact.textContent = `Точное место съёмки этого кадра — чуть дальше, на PastVu: ${p.exactPhotoLat}, ${p.exactPhotoLon}` +
      (p.exactPhotoPastvu ? `.` : ".");
    if (p.exactPhotoPastvu) {
      exact.innerHTML += ` <a href="${p.exactPhotoPastvu}" target="_blank" rel="noopener">Открыть на PastVu</a>`;
    }
  } else {
    exact.classList.add("hidden");
  }

  // If we have geolocation, scroll map later when returning
}

function closePoint() {
  const audio = $("#player");
  audio.pause();
  stopCamera(true);
  state.currentId = null;
  showScreen("screen-tour");
  setTimeout(() => state.map && state.map.invalidateSize(), 200);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Камера недоступна. Смотрите снимки рядом, ниже на странице.");
    $("#compare-box").classList.remove("hidden");
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
    $("#base-now").classList.add("hidden");
    $("#overlay-img").classList.remove("hidden");
    const camBtn = $("#btn-camera");
    if (camBtn) camBtn.textContent = "Закрыть камеру";
    toast("Двигайте ползунок: старое фото ляжет на то, что видит камера.");
  } catch (e) {
    console.warn(e);
    toast("Нет доступа к камере. Ниже можно сравнить два снимка.");
    $("#compare-box").classList.remove("hidden");
  }
}

function stopCamera(hideOverlay) {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  const video = $("#live-video");
  video.pause();
  video.srcObject = null;
  video.classList.add("hidden");
  state.cameraOn = false;
  const camBtn = $("#btn-camera");
  if (camBtn) camBtn.textContent = "Открыть камеру";
  const p = state.data && state.data.points.find(x => x.id === state.currentId);
  if (p && (p.now || p.nowRemote)) {
    $("#base-now").classList.remove("hidden");
    $("#then-img").classList.add("hidden");
  } else {
    $("#then-img").classList.remove("hidden");
  }
  if (hideOverlay) $("#overlay-img").classList.add("hidden");
  else $("#overlay-img").classList.remove("hidden");
}

function imHere() {
  const p = state.data.points.find(x => x.id === state.currentId);
  if (!p) return;
  state.lastTrigger[p.id] = Date.now();
  const audio = $("#player");
  audio.currentTime = 0;
  audio.play().catch(() => toast("Нажмите «Слушать», чтобы включить рассказ"));
}

function startTour(opts = {}) {
  showScreen("screen-tour");
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
    openPoint(h.slice(6), false);
  }
}

async function main() {
  await loadData();
  $("#cover-title").textContent = state.data.title;
  $("#cover-lead").textContent = state.data.subtitle;
  $("#cover-place").textContent = state.data.place;
  renderList();
  applyHash();

  $("#btn-start").addEventListener("click", startTour);
  $("#btn-about").addEventListener("click", () => showScreen("screen-about"));
  $$("[data-back=tour]").forEach(b => b.addEventListener("click", () => {
    showScreen("screen-tour");
    setTimeout(() => state.map && state.map.invalidateSize(), 200);
  }));
  $("#btn-back-point").addEventListener("click", closePoint);
  $("#btn-gps").addEventListener("click", enableGps);
  $("#btn-here").addEventListener("click", imHere);
  $("#btn-camera").addEventListener("click", () => {
    if (state.cameraOn) stopCamera(false);
    else startCamera();
  });
  $("#btn-compare").addEventListener("click", () => {
    $("#compare-box").classList.toggle("hidden");
  });
  $("#opacity").addEventListener("input", (e) => {
    state.opacity = Number(e.target.value);
    $("#overlay-img").style.opacity = state.opacity;
    $("#opacity-val").textContent = Math.round(state.opacity * 100) + "%";
    if ($("#overlay-img").classList.contains("hidden")) {
      $("#overlay-img").classList.remove("hidden");
    }
  });
  const player = $("#player");
  const playBtn = $("#btn-play");
  playBtn.addEventListener("click", () => {
    if (player.paused) player.play(); else player.pause();
  });
  player.addEventListener("play", () => { playBtn.textContent = "Пауза"; });
  player.addEventListener("pause", () => { playBtn.textContent = "Слушать"; });
  player.addEventListener("ended", () => { playBtn.textContent = "Слушать"; });
}

main().catch(err => {
  console.error(err);
  toast("Не удалось загрузить данные экскурсии.");
});

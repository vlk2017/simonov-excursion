const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const state = {
  data: null,
  pos: null,
  watchId: null,
  currentId: null,
  opacity: 0.55,
  camMode: "overlay",
  curtain: 50,
  photoIdx: 0,
  slideIdx: 0,
  slides: [],
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
  userRoute: null,
  routeLayer: null,
  routeRequested: false,
  routeBusy: false,
  routeTargetId: null,
  routeLastOrigin: null,
  routeInfo: null,
  routeCoords: [],
  routeManeuvers: [],
  routeProgressIndex: 0,
  accuracyCircle: null,
  targetHalo: null,
  navIndex: 0,
  navPref: null,
  visited: {},
  heading: null,
  headingAt: 0,
  headingUi: 0,
  arrowAngle: null,
  compassOn: false,
  routeCum: [],
  routeProj: null,
  routeSeq: 0,
  routeAbort: null,
  routeLastAt: 0,
  offRoute: NavCore.createOffRouteTracker(),
};

const ROUTE_ENDPOINT = "https://valhalla1.openstreetmap.de/route";
const ROUTE_TIMEOUT_MS = 10000;      // ждать ответ маршрутизатора не дольше
const ROUTE_MIN_INTERVAL_MS = 15000; // не чаще одного запроса в 15 с (fair-use FOSSGIS)

const RADIUS = 22;

const { haversine, bearingTo, dirName, fmtDist, decodePolyline6, normalizeAngle, angleDelta } = NavCore;

/* localStorage бывает недоступен (приватный режим, переполнение): не даём упасть из-за этого */
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { console.warn("localStorage", e); } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { console.warn("localStorage", e); } }
function saveVisited() { lsSet("ordynka-visited", JSON.stringify(state.visited)); }

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

function nextUnvisitedIndex() {
  return state.data.points.findIndex(p => !state.visited[p.id]);
}
/* Цель навигации: точка, выбранная кнопками «Предыдущая/Следующая точка» (пока не отмечена пройденной), иначе первая непройденная */
function navTargetIndex() {
  if (state.navPref) {
    const i = state.data.points.findIndex(p => p.id === state.navPref);
    if (i >= 0) return i;
  }
  return nextUnvisitedIndex();
}

function updateNavigator() {
  if (!state.data) return;
  const points = state.data.points;
  const done = points.filter(p => state.visited[p.id]).length;
  $("#nav-progress").textContent = `Пройдено ${done} из ${points.length}`;
  const nextIndex = navTargetIndex();
  if (nextIndex < 0) {
    $("#nav-step").textContent = "✓";
    $("#nav-title").textContent = "Маршрут завершён";
    $("#nav-distance").textContent = "Все остановки пройдены. Можно посмотреть весь маршрут на карте.";
    $("#nav-open").textContent = "Первая точка";
    $("#nav-note").textContent = "Спасибо, что прошли этот маршрут.";
    $("#nav-route").disabled = true;
    $("#nav-external").classList.add("hidden");
    $("#route-guidance").textContent = "";
    state.navIndex = 0;
    updateRouteOnMap();
    return;
  }
  state.navIndex = nextIndex;
  const p = points[nextIndex];
  $("#nav-route").disabled = false;
  $("#nav-step").textContent = String(p.num).padStart(2, "0");
  $("#nav-title").textContent = p.title;
  const d = state.pos ? haversine(state.pos.lat, state.pos.lon, p.lat, p.lon) : null;
  const accuracy = state.pos && state.pos.acc ? Math.round(state.pos.acc) : null;
  const activeRoute = state.routeInfo && state.routeTargetId === p.id;
  $("#nav-distance").textContent = activeRoute
    ? `Пешком ${fmtDist(state.routeInfo.distance)} · около ${Math.max(1,Math.round(state.routeInfo.duration/60))} мин.`
    : d == null
      ? "Нажмите «Проложить пеший путь», затем разрешите геолокацию."
      : accuracy > 35
        ? `До точки примерно ${fmtDist(d)} по прямой. GPS неточен (±${accuracy} м).`
        : d <= 20 ? "Вы рядом с остановкой. Найдите безопасное место и осмотритесь."
        : `До точки ${fmtDist(d)} по прямой · ${dirName(bearingTo(state.pos.lat, state.pos.lon, p.lat, p.lon))}`;
  $("#nav-open").textContent = "Рассказ об остановке";
  $("#nav-note").textContent = p.scene?.where || p.dir || "На месте откройте исторический вид и сравните его с тем, что перед вами.";
  const origin = state.pos ? state.pos.lat + "," + state.pos.lon : "";
  const url = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(p.lat + "," + p.lon) + "&travelmode=walking" + (origin ? "&origin=" + encodeURIComponent(origin) : "");
  $("#nav-external").href = url;
  $("#nav-external").classList.remove("hidden");
  updateRouteOnMap();
}
function clearPedestrianRoute() {
  if (state.routeLayer && state.map) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  state.routeInfo = null;
  state.routeTargetId = null;
  state.routeLastOrigin = null;
  state.routeCoords = [];
  state.routeCum = [];
  state.routeProj = null;
  state.routeManeuvers = [];
  state.routeProgressIndex = 0;
  state.arrowAngle = null;
  state.offRoute.reset();
  const guidance = $("#route-guidance");
  if (guidance) { guidance.replaceChildren(); guidance.classList.remove("route-guidance-active"); }
  const hud = $("#navigation-hud");
  if (hud) hud.classList.add("hidden");
}
function hasFreshHeading() { return state.heading != null && Date.now() - state.headingAt < 3000; }
function updateNavigationHud() {
  const hud = $("#navigation-hud");
  if (!hud) return;
  if (!state.routeInfo || !state.routeCoords.length || !state.pos) {
    hud.classList.add("hidden");
    return;
  }
  hud.classList.remove("hidden");
  const coords = state.routeCoords, cum = state.routeCum;
  const pr = NavCore.projectOnRoute(coords, cum, state.pos, state.routeProgressIndex);
  state.routeProj = pr;
  if (pr.index > state.routeProgressIndex) state.routeProgressIndex = pr.index;
  const remaining = NavCore.remainingDistance(cum, pr);
  const next = NavCore.pickNextManeuver(state.routeManeuvers, pr.index);
  const maneuverDistance = NavCore.distanceToManeuver(next, cum, pr, coords.length);
  // стрелка смотрит на точку маршрута примерно в 8 м впереди (а не на соседнюю вершину, которая может быть в метре)
  let li = pr.index + 1;
  while (li < coords.length - 1 && cum[li] - pr.along < 8) li++;
  const bearing = bearingTo(state.pos.lat, state.pos.lon, coords[li][0], coords[li][1]);
  const withCompass = hasFreshHeading();
  const target = normalizeAngle(bearing - (withCompass ? state.heading : 0));
  const prev = state.arrowAngle == null ? target : state.arrowAngle;
  state.arrowAngle = prev + angleDelta(prev, target); // кратчайший поворот, без раскрутки на 360°
  const arrow = $("#nav-arrow");
  if (arrow) arrow.style.transform = `rotate(${state.arrowAngle}deg)`;
  const note = $("#nav-arrow-note");
  if (note) note.textContent = withCompass ? "" : "Компас выключен: стрелка показывает направление относительно севера (вверх — север).";
  const compassBtn = $("#nav-compass");
  if (compassBtn) compassBtn.classList.toggle("hidden", withCompass);
  $("#nav-turn-title").textContent = next?.instruction || "Продолжайте по маршруту";
  $("#nav-turn-distance").textContent = maneuverDistance == null || maneuverDistance < 12
    ? "Сейчас"
    : `Через ${fmtDist(maneuverDistance)}`;
  $("#nav-route-remaining").textContent = `До остановки ${fmtDist(remaining)} · около ${NavCore.walkMinutes(remaining)} мин пешком`;
  const target0 = state.data.points[navTargetIndex()];
  const arrive = NavCore.arrivalState(state.pos, target0);
  const q = NavCore.gpsQuality(state.pos.acc);
  const gps = $("#nav-gps");
  if (gps) {
    gps.dataset.level = q.level;
    gps.textContent = q.label + (arrive.reason === "poor-accuracy" && arrive.distance <= 60 ? " · вы рядом, ждём точный GPS для «Я на месте»" : "") +
      (pr.distance > NavCore.OFF_ROUTE_DISTANCE_M && Number.isFinite(state.pos.acc) && state.pos.acc <= NavCore.OFF_ROUTE_MAX_ACCURACY_M ? " · вы в стороне от маршрута" : "");
  }
  const arrival = $("#nav-arrived");
  if (arrival) {
    arrival.classList.toggle("hidden", !arrive.ready);
    arrival.textContent = arrive.ready ? `Я на месте — открыть рассказ «${target0.title}»` : "Подтвердить прибытие";
    arrival.disabled = !arrive.ready;
  }
}
function renderRouteGuidance(maneuvers) {
  const box = $("#route-guidance");
  if (!box) return;
  box.replaceChildren();
  if (!maneuvers || !maneuvers.length) return;
  const heading = document.createElement("strong");
  heading.textContent = "Как идти";
  box.appendChild(heading);
  maneuvers.slice(0,3).forEach((m, i) => {
    const line = document.createElement("p");
    const distance = Number(m.length) > 0 ? fmtDist(Number(m.length) * 1000) : "";
    line.textContent = `${i + 1}. ${m.instruction || "Продолжайте по маршруту"}${distance ? " · " + distance : ""}`;
    box.appendChild(line);
  });
}
async function buildWalkingRoute(force = false) {
  if (!state.data || !state.map) return;
  const p = state.data.points[navTargetIndex()];
  if (!p) { fitFullRoute(); return; }
  if (!state.pos) {
    state.routeRequested = true;
    enableGps();
    toast("Определяем ваше место. Как только GPS ответит, построим пеший путь.");
    return;
  }
  if (state.routeBusy && !force) return;
  if (!force && state.routeInfo && state.routeTargetId === p.id) return;
  // новый запрос отменяет старый; ответ старого запроса, если всё же придёт, будет отброшен по номеру
  if (state.routeAbort) state.routeAbort.abort();
  const seq = ++state.routeSeq;
  const ctl = new AbortController();
  state.routeAbort = ctl;
  const timer = setTimeout(() => ctl.abort(), ROUTE_TIMEOUT_MS);
  const origin = { lat: state.pos.lat, lon: state.pos.lon };
  const isReroute = !!state.routeInfo && state.routeTargetId === p.id;
  state.routeBusy = true;
  state.routeRequested = false;
  state.routeLastAt = Date.now();
  $("#nav-route").disabled = true;
  $("#nav-route").textContent = "Строим пеший путь…";
  $("#route-guidance").textContent = isReroute ? "Вы ушли с маршрута. Ищем новый путь…" : "Ищем пешеходные дорожки и переходы…";
  try {
    const response = await fetch(ROUTE_ENDPOINT, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": "simonov-excursion.github.io/ordynka"
      },
      body: JSON.stringify({
        locations: [
          { lat: origin.lat, lon: origin.lon },
          { lat: p.lat, lon: p.lon }
        ],
        costing: "pedestrian",
        units: "km",
        language: "ru-RU"
      })
    });
    if (!response.ok) { const e = new Error("Маршрутизатор ответил " + response.status); e.status = response.status; throw e; }
    const data = await response.json();
    if (seq !== state.routeSeq) return;                                   // устарел: есть более новый запрос
    const nowTarget = state.data.points[navTargetIndex()];
    if (!nowTarget || nowTarget.id !== p.id) return;                      // за это время остановку отметили или пропустили
    const route = NavCore.parseValhallaRoute(data);
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    state.routeLayer = L.polyline(route.coords, {
      color:"#e6b85f", weight:6, opacity:.96, lineCap:"round", lineJoin:"round"
    }).addTo(state.map);
    state.routeInfo = { distance: route.distance, duration: route.duration };
    state.routeCoords = route.coords;
    state.routeCum = route.cum;
    state.routeManeuvers = route.maneuvers;
    state.routeProgressIndex = 0;
    state.routeProj = null;
    state.arrowAngle = null;
    state.offRoute.reset();
    state.routeTargetId = p.id;
    state.routeLastOrigin = origin;
    const bounds = state.routeLayer.getBounds();
    if (bounds.isValid() && !isReroute) state.map.fitBounds(bounds.pad(.18), { maxZoom:19 });
    renderRouteGuidance(route.maneuvers);
    updateNavigator();
    updateNavigationHud();
    $("#route-guidance").classList.add("route-guidance-active");
    if (isReroute) toast("Маршрут перестроен.");
  } catch (error) {
    if (seq !== state.routeSeq) return;                                   // отменён нашим же новым запросом
    console.warn("Pedestrian routing unavailable:", error);
    const reason = NavCore.routingErrorMessage(error);
    if (!isReroute) clearPedestrianRoute();                               // старый путь при перестроении оставляем: по нему ещё можно идти
    $("#route-guidance").textContent = reason + " На карте показаны остановки; воспользуйтесь внешней пешеходной картой ниже. Не идите по прямой через здания или ограждения.";
    updateNavigator();
    toast(isReroute ? "Не удалось перестроить маршрут. " + reason : "Пешеходный маршрут недоступен. " + reason);
  } finally {
    clearTimeout(timer);
    if (seq === state.routeSeq) {
      state.routeBusy = false;
      state.routeAbort = null;
      $("#nav-route").disabled = navTargetIndex() < 0;
      $("#nav-route").textContent = "Проложить пеший путь";
    }
  }
}
function updateRouteOnMap() {
  if (!state.map || !state.data) return;
  const points = state.data.points;
  const next = points[navTargetIndex()];
  Object.entries(state.markers).forEach(([id, marker]) => {
    const p = points.find(x => x.id === id);
    if (!p) return;
    const done = !!state.visited[id];
    marker.setStyle({ color: done ? "#7d9a5a" : (next && id === next.id ? "#f3d18b" : "#b9a77e"),
      fillColor: done ? "#506d3d" : (next && id === next.id ? "#d4a74f" : "#9a3f2c"),
      radius: next && id === next.id ? 11 : 7, weight: next && id === next.id ? 3 : 2 });
  });
  if (state.targetHalo) { state.map.removeLayer(state.targetHalo); state.targetHalo = null; }
  if (next) state.targetHalo = L.circle([next.lat,next.lon], {radius:24,color:"#e3bd76",weight:1,fillOpacity:0.06,dashArray:"4 5"}).addTo(state.map);
  if (state.routeTargetId && next && state.routeTargetId !== next.id) clearPedestrianRoute();
}
function focusNextOnMap() {
  if (!state.map || !state.data) return;
  buildWalkingRoute(true);
}
function fitFullRoute() {
  if (!state.map || !state.data) return;
  const pts = state.data.points.map(p => [p.lat,p.lon]);
  if (state.pos) pts.push([state.pos.lat,state.pos.lon]);
  state.map.fitBounds(L.latLngBounds(pts).pad(.18));
}
function markVisited(id) {
  if (id && state.navPref === id) { state.navPref = null; updateNavigator(); }
  if (!id || state.visited[id]) return;
  if (state.routeTargetId === id) clearPedestrianRoute();
  state.visited[id] = true;
  saveVisited();
  renderList();
  updateNavigator();
  toast("Остановка отмечена. Маршрут обновлён.");
}

function renderList() {
  const dist = distances();
  const box = $("#list");
  box.innerHTML = "";
  for (const p of state.data.points) {
    const d = dist[p.id];
    const near = d != null && d <= (state.data.radiusM || RADIUS);
    const btn = document.createElement("button");
    btn.className = "point-card" + (near ? " near" : "") + (state.visited[p.id] ? " visited" : "");
    btn.innerHTML = `
      <div class="point-num">${p.num}</div>
      <div>
        <h3>${p.title}</h3>
        <p>${p.short}</p>
      </div>
      <div class="dist">${state.visited[p.id] ? "✓ пройдена" : fmtDist(d)}</div>
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
  L.polyline(routeCoords, { color: "#88785f", weight: 3, opacity: .55, dashArray: "5 8" }).addTo(state.map);
  for (const p of state.data.points) {
    const m = L.circleMarker([p.lat, p.lon], {
      radius: 8, color: "#d4b06a", weight: 2, fillColor: "#9a3f2c", fillOpacity: .9
    }).addTo(state.map);
    m.bindPopup(`<b>${p.num}. ${p.title}</b>`);
    m.on("click", () => openPoint(p.id, false));
    state.markers[p.id] = m;
  }
  updateRouteOnMap();
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
  if (state.accuracyCircle) state.map.removeLayer(state.accuracyCircle);
  state.accuracyCircle = L.circle(latlng, { radius: Math.min(state.pos.acc || 20, 100), color:"#9ab77b", weight:1, fillColor:"#9ab77b", fillOpacity:.08 }).addTo(state.map);
  updateRouteOnMap();
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
  state.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
  setGpsPill(true, state.pos.acc);
  updateYouMarker();
  renderList();
  updateNavigator();
  maybeAutoTrigger();
  updateStandLive();
  updateApproach();
  updateNavigationHud();
  if (state.routeRequested && !state.routeBusy) buildWalkingRoute(true);
  else checkOffRoute();
}

/* Перестраиваем путь только при настоящем уходе с маршрута (несколько точных измерений подряд дальше порога)
   и не чаще, чем раз в ROUTE_MIN_INTERVAL_MS. Один GPS-скачок ничего не запускает. */
function checkOffRoute() {
  if (!state.routeInfo || !state.routeProj || !state.pos) return;
  if (!state.offRoute.update(state.routeProj.distance, state.pos.acc)) return;
  if (state.routeBusy || Date.now() - state.routeLastAt < ROUTE_MIN_INTERVAL_MS) return;
  state.offRoute.reset();
  buildWalkingRoute(true);
}

function maybeAutoTrigger() {
  // Never autoplay: only offer. Audio starts from the user's tap (iOS requirement).
  if (!state.pos || !state.data || !state.arriveOn) return;
  const r = state.data.radiusM || RADIUS;
  // Do not offer an arrival when GPS accuracy is too poor: a false prompt is worse than no prompt.
  if (state.pos.acc != null && state.pos.acc > 35) return;
  let closest = null;
  for (const p of state.data.points) {
    if (state.visited[p.id]) continue;
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
      console.warn(err);
      if (err && err.code === 1) {
        // доступ запрещён: слежение бесполезно, остаёмся в ручном режиме
        if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
        state.routeRequested = false;
        setGpsPill(false);
        toast("Доступ к геолокации запрещён. Разрешите его в настройках браузера или открывайте точки из списка.");
      } else if (err && err.code === 3) {
        toast("GPS долго не отвечает. Выйдите на открытое место.");
      } else {
        setGpsPill(false);
        toast("Не удалось найти место. Откройте точку в списке или нажмите «Я на месте».");
      }
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
function thumbOf(src) {
  if (!src) return "";
  if (src.startsWith("img/then/")) return src.replace("img/then/", "img/thumbs/");
  if (src.startsWith("img/now/")) return src.replace("img/now/", "img/thumbs/").replace(/\.jpg$/, "-now.jpg");
  return src;
}
function shortAuthor(a) { return (a || "автор неизвестен").replace(/\s*\(.*$/, ""); }
function esc(t) { return String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function currentPoint() { return state.data && state.data.points.find(x => x.id === state.currentId); }
function currentPhoto() { const p = currentPoint(); return p && p.photos[state.photoIdx || 0]; }

/* list for the lightbox: all old photos, then modern ones */
function galleryItems(p) {
  const out = p.photos.map((ph, i) => ({ src: ph.src, remote: ph.remote, cap: `${ph.year} · ${shortAuthor(ph.author)} — ${ph.title}`, photoIdx: i }));
  const nowCap = n => `Сейчас, ${n.year} · ${n.author}, ${n.license} — ${n.note}`;
  p.photos.forEach(ph => { if (ph.now) out.push({ src: ph.now.src, remote: ph.now.remote, cap: nowCap(ph.now) }); });
  if (p.heroNow) out.push({ src: p.heroNow.src, remote: p.heroNow.remote, cap: nowCap(p.heroNow) });
  if (p.nowContext) out.push({ src: p.nowContext.src, remote: p.nowContext.remote, cap: nowCap(p.nowContext) });
  return out;
}

/* ---------- Рассказ: основной источник — интернет (HeyGen), запасной — локальный файл в репозитории ---------- */
const AUDIO_START_TIMEOUT_MS = 8000;
const narr = { sources: [], idx: 0, wantPlay: false, timer: null, failed: false };


/* ---------- Временный голос ----------
   Пока нет записи диктора (audio/*.mp3), рассказ читает озвучка браузера (speechSynthesis, ru-RU).
   Адаптер ведёт себя как <audio>: paused, ended, currentTime, play(), pause() и события play/pause/ended/emptied.
   Благодаря этому вся логика Симонова (кнопка «Начать», пауза, конец рассказа → остановка пройдена) работает без изменений. */
const ttsp = (() => {
  const et = new EventTarget();
  const s = { chunks: [], idx: 0, speaking: false, ended: false, paused: true, token: 0, loading: null, startOnLoad: false };
  const sy = () => ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") ? window.speechSynthesis : null;
  const emit = n => et.dispatchEvent(new Event(n));
  function splitChunks(text) {
    const sentences = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) || [];
    const out = [];
    for (let sent of sentences) {
      sent = sent.trim();
      while (sent.length > 200) {
        let cut = sent.lastIndexOf(",", 190);
        if (cut < 60) cut = sent.lastIndexOf(" ", 190);
        if (cut < 1) cut = 190;
        out.push(sent.slice(0, cut + 1).trim());
        sent = sent.slice(cut + 1).trim();
      }
      if (sent) out.push(sent);
    }
    return out;
  }
  function ruVoice() {
    const v = sy() ? sy().getVoices() : [];
    const ru = v.filter(x => /^ru([-_]|$)/i.test(x.lang));
    return ru.find(x => x.localService) || ru[0] || null;
  }
  function speakNext(tok) {
    const syn = sy();
    if (!syn || tok !== s.token || !s.speaking) return;
    if (s.idx >= s.chunks.length) { s.speaking = false; s.paused = true; s.ended = true; emit("ended"); return; }
    const u = new SpeechSynthesisUtterance(s.chunks[s.idx]);
    u.lang = "ru-RU";
    const v = ruVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.onend = () => { if (tok !== s.token || !s.speaking) return; s.idx++; speakNext(tok); };
    u.onerror = e => {
      if (tok !== s.token || (e && (e.error === "canceled" || e.error === "interrupted"))) return;
      s.speaking = false; s.paused = true; emit("pause");
      toast("Голос телефона не смог прочитать рассказ. Прочитайте текст на экране.");
    };
    syn.speak(u);
  }
  // Object.assign превратил бы геттеры в обычные значения, поэтому переносим дескрипторы
  return Object.defineProperties(et, Object.getOwnPropertyDescriptors({
    get paused() { return s.paused; },
    get ended() { return s.ended; },
    get currentTime() { return s.idx * 5; },
    set currentTime(v) { if (v === 0) { s.token++; if (sy()) sy().cancel(); s.speaking = false; s.idx = 0; s.ended = false; s.paused = true; } },
    get available() { return !!sy(); },
    get hasRussianVoice() { return !sy() || !sy().getVoices().length || !!ruVoice(); },
    load(textPromise) {
      this.stop();
      s.chunks = []; s.idx = 0; s.ended = false; s.paused = true;
      const mine = s.loading = Promise.resolve(textPromise).then(txt => { if (s.loading === mine) s.chunks = splitChunks(txt); }).catch(() => {});
      emit("emptied");
    },
    play() {
      const syn = sy();
      if (!syn) { toast("В этом браузере нет озвучки. Прочитайте текст на экране."); return Promise.resolve(); }
      if (s.ended) { s.idx = 0; s.ended = false; }
      const tok = ++s.token;
      s.speaking = true; s.paused = false;
      emit("play"); emit("playing");
      const go = () => {
        if (tok !== s.token) return;
        if (!s.chunks.length) { s.speaking = false; s.paused = true; emit("pause"); toast("Текст рассказа не загрузился. Проверьте интернет."); return; }
        if (!this.hasRussianVoice) toast("На телефоне нет русского голоса. Его можно добавить в настройках, или дождитесь записи диктора.");
        if (syn.speaking || syn.pending) { syn.cancel(); setTimeout(() => speakNext(tok), 80); } else speakNext(tok);
      };
      if (s.chunks.length) go(); else { try { syn.speak(new SpeechSynthesisUtterance("")); } catch {} s.loading.then(go); }
      return Promise.resolve();
    },
    pause() {
      if (s.paused && !s.speaking) return;
      s.token++; s.speaking = false; s.paused = true;
      if (sy()) sy().cancel();
      emit("pause");
    },
    stop() { s.token++; s.speaking = false; s.paused = true; if (sy()) sy().cancel(); },
  }));
})();
/* текущий «плеер»: озвучка браузера, пока у точки нет mp3 */
function pl() { return narr.tts ? ttsp : $("#player"); }

/* Порядок источников: без сети сначала локальный (если он скачан в кэш), иначе сначала внешний. */
function narrationSources(p) {
  const ext = p.audio && /^https?:/.test(p.audio) ? p.audio : null;
  const loc = p.audioLocal || (p.audio && !ext ? p.audio : null);
  const list = navigator.onLine === false ? [loc, ext] : [ext, loc];
  return list.filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
}
function loadNarration(p) {
  const audio = $("#player");
  clearTimeout(narr.timer);
  narr.sources = narrationSources(p);
  narr.idx = 0;
  narr.wantPlay = false;
  narr.failed = false;
  narr.tts = !narr.sources.length;
  $("#tts-note").classList.toggle("hidden", !narr.tts);
  audio.classList.toggle("hidden", narr.tts);
  ttsp.stop();
  if (narr.tts) {
    audio.removeAttribute("src");
    audio.load();
    ttsp.load(fetch(p.ttsScript || p.script).then(r => r.ok ? r.text() : ""));
    return;
  }
  audio.src = narr.sources[0];
  audio.load();
  audio.playbackRate = state.rate;
}
/* Следующий источник; true, если переключились. Позицию не сохраняем: ошибка случается в начале загрузки. */
function switchNarrationSource(reason) {
  const audio = $("#player");
  if (narr.idx + 1 >= narr.sources.length) return false;
  const want = narr.wantPlay;
  narr.idx++;
  console.warn("Рассказ: переключаюсь на запасной источник —", reason, narr.sources[narr.idx]);
  const t = audio.currentTime;
  audio.src = narr.sources[narr.idx];
  audio.load();
  audio.playbackRate = state.rate;
  if (t > 1) audio.addEventListener("loadedmetadata", () => { try { audio.currentTime = t; } catch {} }, { once: true });
  narr.wantPlay = want;
  if (want) audio.play().catch(() => {});
  armStartWatchdog();
  return true;
}
/* Если за AUDIO_START_TIMEOUT_MS звук не пошёл (зависшая внешняя ссылка), берём запасной файл. */
function armStartWatchdog() {
  clearTimeout(narr.timer);
  if (!narr.wantPlay || narr.idx + 1 >= narr.sources.length) return;
  narr.timer = setTimeout(() => {
    const a = $("#player");
    if (narr.wantPlay && a.currentTime === 0) switchNarrationSource("нет звука за " + AUDIO_START_TIMEOUT_MS + " мс");
  }, AUDIO_START_TIMEOUT_MS);
}
function startNarration() {
  if (narr.tts) { narr.wantPlay = true; ttsp.play(); return; }
  const audio = $("#player");
  narr.wantPlay = true;
  audio.playbackRate = state.rate;
  const pr = audio.play();
  armStartWatchdog();
  if (pr && pr.catch) pr.catch(err => {
    if (err && err.name === "NotAllowedError") { narr.wantPlay = false; toast("Нажмите «Начать рассказ», чтобы включить звук."); }
    else if (err && err.name !== "AbortError") { if (!switchNarrationSource("play(): " + err.name)) toast("Рассказ не загрузился. Проверьте интернет."); }
  });
}
function onNarrationError() {
  const audio = $("#player");
  if (!audio.getAttribute("src")) return;
  if (switchNarrationSource("ошибка загрузки")) return;
  narr.failed = true; narr.wantPlay = false;
  toast("Рассказ не загрузился. Проверьте интернет или скачайте рассказы для офлайна.");
}

function openPoint(id, play) {
  const p = state.data.points.find(x => x.id === id);
  if (!p) return;
  state.currentId = id;
  $("#btn-done").textContent = state.visited[id] ? "Остановка пройдена ✓" : "Отметить остановку пройденной";
  $("#btn-done").disabled = !!state.visited[id];
  stopCamera();
  showScreen("screen-point");
  window.scrollTo(0, 0);
  $("#point-title").textContent = p.title;
  $("#point-num-label").textContent = `Точка ${p.num} из ${state.data.points.length}`;
  $("#point-short").textContent = p.summary || p.short;
  $("#point-dir").textContent = p.dir || "";
  const scene = p.scene;
  const sceneCard = $("#look-card");
  if (scene) {
    sceneCard.classList.remove("hidden");
    $("#scene-where").textContent = scene.where;
    $("#scene-look").textContent = scene.look;
    $("#scene-notice").textContent = scene.notice;
    $("#scene-then").textContent = scene.then;
    $("#scene-confidence").textContent = "Надёжность и оговорки: " + scene.confidence;
    const destination = p.lat + "," + p.lon;
    const origin = state.pos ? "&origin=" + encodeURIComponent(state.pos.lat + "," + state.pos.lon) : "";
    $("#scene-route").innerHTML =
      `<a class="scene-route-link" href="https://www.google.com/maps/dir/?api=1${origin}&destination=${encodeURIComponent(destination)}&travelmode=walking" target="_blank" rel="noopener">Пешком к этой остановке ↗</a>` +
      `<a class="scene-map-link" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=19/${p.lat}/${p.lon}" target="_blank" rel="noopener">Показать точку на карте</a>`;
    $("#scene-sources").innerHTML = (scene.sources || []).map(s => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · ");
  } else {
    sceneCard.classList.add("hidden");
  }

  const filmCard = $("#archival-film");
  if (p.archivalFilm) {
    filmCard.classList.remove("hidden");
    $("#film-title").textContent = p.archivalFilm.title;
    $("#film-date").textContent = p.archivalFilm.date;
    $("#film-description").textContent = p.archivalFilm.description;
    $("#film-links").innerHTML = p.archivalFilm.sources.map(s =>
      `<a class="film-link" href="${s.url}" target="_blank" rel="noopener">${esc(s.label)} ↗</a>`
    ).join("");
    $("#film-rights").textContent = p.archivalFilm.rights;
  } else {
    filmCard.classList.add("hidden");
    $("#film-links").textContent = "";
  }

  loadNarration(p);
  updatePointNav();
  state.approachAngle = null;
  updateApproach();
  if (play) startNarration();   // тот же синхронный вызов из обработчика нажатия: iOS разрешает звук только так

  buildCarousel(p);

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

/* ---------- Карусель архивных фото в рамке сверху (при включённой камере скрыта: там живая накладка) ---------- */
/* Первый кадр точки: современное фото + шторка со старым (открыта пополам). Дальше — архивные снимки. */
function buildSlides(p) {
  const out = [];
  const heroModern = p.heroNow && !(p.photos[0] && p.photos[0].now);
  if (heroModern) out.push({ kind: "modern", photoIdx: 0 });
  p.photos.forEach((ph, i) => { if (heroModern && ph.modern && i === 0) return; out.push({ kind: i === 0 && ph.now ? "cmp" : "old", photoIdx: i }); });
  return out;
}
function focalStyle(f) {
  f = f || {};
  const x = Number.isFinite(f.x) ? f.x : 50, y = Number.isFinite(f.y) ? f.y : 50, z = Number.isFinite(f.z) ? f.z : 1;
  return `object-position:${x}% ${y}%;` + (z !== 1 ? `transform:scale(${z});transform-origin:${x}% ${y}%;` : "");
}
const CMP_MIN = 4, CMP_MAX = 96;
function setCmpOn(slide, pct) {
  pct = Math.max(CMP_MIN, Math.min(CMP_MAX, pct));
  state.cmp = pct;
  const clip = slide.querySelector(".cmp-clip"), h = slide.querySelector(".cmp-handle");
  clip.style.clipPath = clip.style.webkitClipPath = `inset(0 ${100 - pct}% 0 0)`;
  h.style.left = pct + "%";
  h.setAttribute("aria-valuenow", String(Math.round(pct)));
  slide.dataset.pct = String(Math.round(pct));
}
function wireCmp(slide) {
  const frame = slide.querySelector(".cmp-frame"), h = slide.querySelector(".cmp-handle");
  let drag = false;
  const move = e => { const r = frame.getBoundingClientRect(); setCmpOn(slide, (e.clientX - r.left) / r.width * 100); };
  h.addEventListener("pointerdown", e => { drag = true; try { h.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); e.stopPropagation(); move(e); });
  h.addEventListener("pointermove", e => { if (drag) move(e); });
  const end = () => { drag = false; };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
  h.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); setCmpOn(slide, (Number(slide.dataset.pct) || 50) - 5); }
    if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); setCmpOn(slide, (Number(slide.dataset.pct) || 50) + 5); }
  });
  setCmpOn(slide, 50);
}
function buildCarousel(p) {
  const track = $("#car-track"), dots = $("#car-dots");
  track.innerHTML = ""; dots.innerHTML = "";
  state.slides = buildSlides(p);
  const n = state.slides.length;
  state.slides.forEach((sl, k) => {
    const ph = p.photos[sl.photoIdx];
    const s = document.createElement("div");
    s.className = "car-slide" + (sl.kind === "old" ? "" : " car-cmp");
    s.dataset.kind = sl.kind;
    s.setAttribute("role", "group"); s.setAttribute("aria-roledescription", "слайд"); s.setAttribute("aria-label", `${k + 1} из ${n}`);
    if (sl.kind === "old") {
      const img = document.createElement("img");
      img.alt = `${ph.title}, ${ph.year}`; img.draggable = false; img.dataset.i = String(k);
      img.addEventListener("click", () => openLightboxForCurrent(ph.src));
      s.appendChild(img);
    } else {
      const nw = sl.kind === "cmp" ? ph.now : p.heroNow;
      const old = sl.kind === "cmp";
      s.innerHTML = `<div class="cmp-frame">
        <img class="cmp-now" alt="Сейчас: ${esc(nw.note)}" draggable="false" style="${focalStyle(nw.focal)}" />
        ${old ? `<div class="cmp-clip"><img class="cmp-old" alt="${esc(ph.title)}, ${esc(ph.year)}" draggable="false" style="${focalStyle(ph.focal)}" /></div>
        <span class="cmp-tag cmp-tag-l">${esc(ph.year)}</span>
        <div class="cmp-handle" role="slider" tabindex="0" aria-label="Шторка: слева старое фото, справа современное" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><i></i><b>‹ ›</b></div>` : `<span class="cmp-tag cmp-tag-l cmp-tag-warn">Старого снимка нет</span>`}
        <span class="cmp-tag cmp-tag-r">Сейчас</span></div>`;
      s.querySelector(".cmp-now").addEventListener("click", () => openLightboxForCurrent(nw.src));
      if (old) { s.querySelector(".cmp-old").addEventListener("click", () => openLightboxForCurrent(ph.src)); wireCmp(s); }
    }
    track.appendChild(s);
    const d = document.createElement("button");
    d.type = "button"; d.className = "car-dot";
    d.setAttribute("aria-label", `Фото ${k + 1} из ${n}: ${sl.kind === "modern" ? "сейчас" : sl.kind === "cmp" ? `${ph.year} и сейчас` : ph.year}`);
    d.addEventListener("click", () => carGo(k));
    dots.appendChild(d);
  });
  $("#car").classList.toggle("single", n < 2);   // одно фото: ни стрелок, ни точек
  track.scrollLeft = 0;
}
function carBind(k) {
  const p = currentPoint(); if (!p) return;
  const sl = state.slides[k], el = $$("#car-track .car-slide")[k];
  if (!sl || !el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const ph = p.photos[sl.photoIdx];
  if (sl.kind === "old") bindImg(el.querySelector("img"), ph.src, ph.remote, `${ph.title}, ${ph.year}`);
  else {
    const nw = sl.kind === "cmp" ? ph.now : p.heroNow;
    bindImg(el.querySelector(".cmp-now"), nw.src, nw.remote, `Сейчас: ${nw.note}`);
    if (sl.kind === "cmp") bindImg(el.querySelector(".cmp-old"), ph.src, ph.remote, `${ph.title}, ${ph.year}`);
  }
}
function carShow(i) {
  const p = currentPoint(); if (!p) return;
  const n = state.slides.length;
  [i - 1, i, i + 1].forEach(k => { if (k >= 0 && k < n) carBind(k); });
  $$("#car-dots .car-dot").forEach((d, k) => { d.classList.toggle("on", k === i); if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
  $("#car-prev").disabled = i <= 0;
  $("#car-next").disabled = i >= n - 1;
  const track = $("#car-track"), w = track.clientWidth;
  if (w && Math.abs(track.scrollLeft - i * w) > 2) track.scrollTo({ left: i * w, behavior: state.carInstant ? "instant" : "smooth" });
}
function carGo(i) {
  const p = currentPoint(); if (!p) return;
  i = Math.max(0, Math.min(state.slides.length - 1, i));
  if (i !== state.slideIdx) selectPhoto(i);
  else carShow(i);
}
function initCarousel() {
  const track = $("#car-track");
  let t = null;
  const settle = () => {
    const w = track.clientWidth; if (!w) return;
    const i = Math.round(track.scrollLeft / w), p = currentPoint();
    if (p && i >= 0 && i < state.slides.length && i !== state.slideIdx) selectPhoto(i);
  };
  track.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(settle, 90); }, { passive: true });
  $("#car-prev").addEventListener("click", () => carGo((state.slideIdx || 0) - 1));
  $("#car-next").addEventListener("click", () => carGo((state.slideIdx || 0) + 1));
  $("#car").addEventListener("keydown", e => {
    if (e.target && e.target.classList && e.target.classList.contains("cmp-handle")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); carGo((state.slideIdx || 0) - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); carGo((state.slideIdx || 0) + 1); }
  });
  window.addEventListener("resize", () => { const i = state.slideIdx || 0, w = track.clientWidth; if (w) track.scrollTo({ left: i * w, behavior: "instant" }); });
}

function selectPhoto(k) {
  const p = currentPoint();
  if (!p) return;
  const sl = state.slides[k] || state.slides[0] || { kind: "old", photoIdx: 0 };
  state.slideIdx = state.slides[k] ? k : 0;
  state.photoIdx = sl.photoIdx;
  const i = sl.photoIdx;
  const ph = p.photos[i];
  const nw = sl.kind === "cmp" ? ph.now : sl.kind === "modern" ? p.heroNow : null;
  carShow(state.slideIdx);
  bindImg($("#then-img"), ph.src, ph.remote, ph.title);
  bindImg($("#overlay-img"), ph.src, ph.remote, ph.title);
  if (!state.rp.on) { rpReset(); applyRpTransform(); }
  $("#hero-count").textContent = state.slides.length > 1 ? `${state.slideIdx + 1} / ${state.slides.length}` : "";
  const link = u => u ? ` · <a href="${esc(u)}" target="_blank" rel="noopener">источник: Викисклад</a>` : "";
  if (sl.kind === "modern") {
    $("#photo-caption").innerHTML = `Сейчас · ${esc(nw.author)}<span class="cap-title">${esc(nw.note)}. ${esc(nw.year)}, ${esc(nw.license)}${link(nw.commons)}. ${esc(p.heroNow.missingThen)}</span>`;
  } else if (sl.kind === "cmp") {
    $("#photo-caption").innerHTML = `${esc(ph.year)} · ${esc(shortAuthor(ph.author))} и сейчас · ${esc(nw.author)}<span class="cap-title">${esc(ph.title)}. Тяните шторку: слева ${esc(ph.year)}, справа — сейчас (${esc(nw.year)}). ${esc(nw.note)} Нажмите на фото, чтобы открыть на весь экран.</span>`;
  } else {
    $("#photo-caption").innerHTML = `${esc(ph.year)} · ${esc(shortAuthor(ph.author))}<span class="cap-title">${esc(ph.title)}. ${esc(ph.license || "")}${ph.commons ? ` · <a href="${esc(ph.commons)}" target="_blank" rel="noopener">источник: Викисклад</a>` : ""}. Нажмите на фото, чтобы открыть на весь экран.</span>`;
  }

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
    const origin = state.pos ? `&origin=${encodeURIComponent(state.pos.lat + "," + state.pos.lon)}` : "";
    links.push(`<a href="https://www.google.com/maps/dir/?api=1${origin}&destination=${encodeURIComponent(vp.lat + "," + vp.lon)}&travelmode=walking" target="_blank" rel="noopener">Пешком к точке съёмки</a>`);
    if (vp.source && vp.source.includes("pastvu")) links.push(`<a href="${vp.source}" target="_blank" rel="noopener">Источник точки — PastVu</a>`);
  } else {
    needle.style.display = "none";
    $("#stand-text").innerHTML = `${esc(ph.stand || "Точное место съёмки этого кадра не установлено.")}`;
  }
  $("#stand-links").innerHTML = links.join(" · ");
  updateStandLive();

  // rights
  const nowBlock = nw ? `<p><b>Современное фото.</b> ${esc(nw.year)}. ${esc(nw.author)}. ${esc(nw.license)}. ${esc(nw.note)}${nw.commons ? ` <a href="${esc(nw.commons)}" target="_blank" rel="noopener">Карточка на Викискладе</a>` : ""}</p>` : "";
  $("#photo-meta").innerHTML = `
    ${nowBlock}
    ${sl.kind === "modern" ? "" : `<p><b>${ph.modern ? "Современное фото." : "Старое фото."}</b> ${esc(ph.year)}. ${esc(ph.author)}. ${esc(ph.title)}.</p>
    <p>${esc(ph.license)}. ${esc(ph.rights)}</p>
    <p><a href="${ph.commons}" target="_blank" rel="noopener">Карточка на Викискладе</a></p>`}
    ${(p.moreLinks || []).length ? `<div class="more-links"><p><b>Ещё снимки — только по ссылке.</b> Они хранятся на сайте «История России в фотографиях». Права на них у музеев, архивов и авторов, поэтому копировать их сюда мы не можем.</p><ul>${p.moreLinks.map(l => `<li><a href="${l.url}" target="_blank" rel="noopener">${esc(l.title)}</a>, ${esc(l.year)}, ${esc(l.author)} (${esc(l.source)})${l.note ? `. ${esc(l.note)}` : ""}</li>`).join("")}</ul></div>` : ""}`;
}

/* live hint: how far and which way to step to reach the photographer's spot */
function onOrientation(e) {
  let heading = null;
  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0 && !(e.webkitCompassAccuracy < 0)) heading = e.webkitCompassHeading;
  else if (e.absolute === true && typeof e.alpha === "number") heading = (360 - e.alpha) % 360;
  if (heading == null) return;
  state.heading = NavCore.smoothAngle(state.heading, heading);
  const now = Date.now();
  state.headingAt = now;
  if (now - state.headingUi < 150) return;   // события приходят десятки раз в секунду: интерфейс обновляем реже
  state.headingUi = now;
  updateStandLive();
  updateApproach();
  rpUpdateHint();
  updateNavigationHud();
}

function stopCompassListeners() {
  window.removeEventListener("deviceorientation", onOrientation, true);
  window.removeEventListener("deviceorientationabsolute", onOrientation, true);
}

async function enableCompass() {
  if (!("DeviceOrientationEvent" in window)) {
    toast("Компас не поддерживается этим телефоном. Используйте направление на карте.");
    return;
  }
  try {
    // iOS 13+: разрешение можно запросить только из нажатия, поэтому вызываем его первым
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        toast("Доступ к компасу не разрешён. Стрелка будет показывать направление относительно севера.");
        return;
      }
    }
    stopCompassListeners();                                   // повторное нажатие не плодит обработчики
    window.addEventListener("deviceorientation", onOrientation, true);
    // Android Chrome отдаёт азимут от севера только в deviceorientationabsolute
    if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onOrientation, true);
    state.compassOn = true;
    toast("Компас включён. Держите телефон горизонтально, экраном вверх. Если данных нет, стрелка останется относительно севера.");
  } catch (err) {
    console.warn(err);
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
  if (acc && acc > 30) {
    el.textContent = `GPS сейчас неточен (погрешность около ${acc} м). Ориентируйтесь по зданию и карте, а не по шагам.`;
    return;
  }
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

/* Кнопки «Предыдущая» / «Следующая точка» (сверху под плеером и дубль внизу карточки) */
function updatePointNav() {
  const pts = state.data.points;
  const i = pts.findIndex(p => p.id === state.currentId);
  if (i < 0) return;
  const prev = pts[i - 1], next = pts[i + 1];
  const ended = !!pl().ended;
  $("#btn-approach-path").addEventListener("click", showPathToCurrent);
  setInterval(() => { if (state.currentId) updateApproach(); }, 5000);   // устаревший GPS → нейтральный текст
  $$(".js-prev").forEach(b => {
    b.classList.toggle("hidden", !prev);
    b.disabled = !prev;
    if (prev) b.querySelector("small").textContent = `${prev.num}. ${prev.title}`;
  });
  $$(".js-next").forEach(b => {
    b.querySelector("b").textContent = next ? "Следующая точка →" : "Завершить прогулку";
    b.querySelector("small").textContent = next ? `${next.num}. ${next.title}` : "К маршруту и итогу";
    b.classList.toggle("is-primary", ended);
  });
  $$(".pt-nav").forEach(n => n.classList.toggle("single", !prev));
}
/* Плашка над «Начать рассказ»: подталкивает подойти к точке. Рассказ она не блокирует. Радиус и точность те же, что у «Я на месте». */
function updateApproach() {
  const box = $("#approach");
  if (!box || !state.data) return;
  const p = currentPoint();
  if (!p) return;
  const st = NavCore.approachState(state.pos, p);
  const title = $("#approach-title"), sub = $("#approach-sub"), arrow = $("#approach-arrow"), path = $("#btn-approach-path");
  const kind = st.kind;
  box.className = "approach " + (kind === "here" ? "here" : kind === "far" ? "far" : "neutral");
  $("#btn-play").classList.toggle("is-here", kind === "here");
  arrow.classList.add("hidden");
  path.classList.add("hidden");
  sub.textContent = "";
  if (kind === "here") {
    title.textContent = "Вы на месте — начните рассказ";
  } else if (kind === "far") {
    title.textContent = `Подойдите к точке · ${fmtDist(st.distance)}`;
    path.classList.remove("hidden");
    if (hasFreshHeading()) {
      arrow.classList.remove("hidden");
      const target = normalizeAngle(st.bearing - state.heading);
      const prev = state.approachAngle == null ? target : state.approachAngle;
      state.approachAngle = prev + angleDelta(prev, target);
      arrow.style.transform = `rotate(${state.approachAngle}deg)`;
      sub.textContent = "Идите по стрелке";
    } else {
      state.approachAngle = null;
      sub.textContent = `Направление: ${dirName(st.bearing)}`;
    }
  } else if (kind === "near") {
    title.textContent = `Вы рядом с точкой · ${fmtDist(st.distance)}`;
    sub.textContent = "Ждём более точный GPS. Рассказ можно начать уже сейчас.";
  } else {
    title.textContent = "Подойдите к точке и начните рассказ";
  }
}
function showPathToCurrent() {
  const p = currentPoint();
  if (!p) return;
  stopNarrationNow();
  stopCamera();
  state.navPref = p.id;
  state.currentId = null;
  showScreen("screen-tour");
  window.scrollTo({ top: 0, behavior: "instant" });
  updateNavigator();
  setTimeout(() => state.map && state.map.invalidateSize(), 200);
  buildWalkingRoute(true);
}
function stopNarrationNow() {
  const a = $("#player");
  clearTimeout(narr.timer);
  narr.wantPlay = false;
  a.pause();
  ttsp.pause();
}
function gotoNeighbor(step) {
  const pts = state.data.points;
  const i = pts.findIndex(p => p.id === state.currentId);
  if (i < 0) return;
  stopNarrationNow();
  stopCamera();
  const j = i + step;
  if (j < 0) return;
  if (j >= pts.length) {   // последняя точка: завершаем прогулку, показываем экран маршрута
    state.navPref = null;
    state.currentId = null;
    showScreen("screen-tour");
    updateNavigator();
    setTimeout(() => state.map && state.map.invalidateSize(), 200);
    const done = pts.filter(p => state.visited[p.id]).length;
    toast(done === pts.length ? "Прогулка завершена. Спасибо!" : `Прогулка завершена. Пройдено ${done} из ${pts.length}.`);
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  state.navPref = pts[j].id;
  updateNavigator();
  openPoint(pts[j].id, false);   // звук сам не включается: «Начать рассказ»
  window.scrollTo({ top: 0, behavior: "instant" });   // сверху карточки сразу, без плавной прокрутки с конца страницы
}

function closePoint() {
  stopNarrationNow();
  stopCamera();
  state.currentId = null;
  showScreen("screen-tour");
  setTimeout(() => state.map && state.map.invalidateSize(), 200);
}

/* ---------- Историческая накладка: камера + старое фото ---------- */
const CAM_MODES = ["then", "overlay", "curtain", "now"];
function camMessage(text) { const el = $("#cam-msg"); if (el) el.textContent = text || ""; }

/* Режим: then — старое фото 100%; now — только камера; overlay — полупрозрачно с ползунком; curtain — вертикальная шторка */
function setCamMode(mode) {
  if (!CAM_MODES.includes(mode)) mode = "overlay";
  state.camMode = mode;
  const ov = $("#overlay-img"), wrap = $("#overlay-wrap");
  wrap.style.clipPath = ""; wrap.style.webkitClipPath = "";
  ov.style.opacity = mode === "now" ? 0 : mode === "overlay" ? state.opacity : 1;
  $("#cam-slider").classList.toggle("hidden", !(state.cameraOn && mode === "overlay"));
  $("#cam-curtain").classList.toggle("hidden", !(state.cameraOn && mode === "curtain"));
  if (mode === "curtain") setCurtain(state.curtain);
  $$("#cam-modes button").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  const hints = { then: "Фото. Нажмите «Сейчас», чтобы увидеть камеру.", now: "Только камера. «Раньше» вернёт старое фото.", overlay: "Двигайте ползунок прозрачности и совместите здания.", curtain: "Тяните полосу пальцем: слева раньше, справа сейчас." };
  if (state.cameraOn) camMessage(hints[mode]);
}
function setCurtain(pct) {
  pct = Math.max(0, Math.min(100, pct));
  state.curtain = pct;
  const ov = $("#overlay-wrap"), c = $("#cam-curtain");
  if (state.camMode === "curtain") { ov.style.clipPath = `inset(0 ${100 - pct}% 0 0)`; ov.style.webkitClipPath = `inset(0 ${100 - pct}% 0 0)`; }
  c.style.left = pct + "%";
  c.setAttribute("aria-valuenow", String(Math.round(pct)));
}
function initCamControls() {
  $$("#cam-modes button").forEach(b => b.addEventListener("click", () => { if (b.dataset.mode === "rephoto") startRephoto(); else setCamMode(b.dataset.mode); }));
  initRephoto();
  initCarousel();
  const hero = $("#hero"), curtain = $("#cam-curtain");
  let drag = false;
  const move = e => { const r = hero.getBoundingClientRect(); setCurtain((e.clientX - r.left) / r.width * 100); };
  hero.addEventListener("pointerdown", e => { if (state.camMode !== "curtain" || !(state.cameraOn || state.rp.noCam) || e.target.closest("button,input,.slider-wrap")) return; drag = true; hero.setPointerCapture(e.pointerId); move(e); });
  hero.addEventListener("pointermove", e => { if (drag) move(e); });
  const end = () => { drag = false; };
  hero.addEventListener("pointerup", end);
  hero.addEventListener("pointercancel", end);
  curtain.addEventListener("keydown", e => { if (e.key === "ArrowLeft") setCurtain(state.curtain - 5); if (e.key === "ArrowRight") setCurtain(state.curtain + 5); });
}
/* ---------- Рефотосъёмка: 1) совместить контур с живой камерой, 2) шторка «тогда/сейчас» на весь экран и снимок ---------- */
state.rp = { on: false, step: 1, scale: 1, x: 0, y: 0, noCam: false, shot: null, saved: null };
function rpReset() { const r = state.rp; r.scale = 1; r.x = 0; r.y = 0; }
function applyRpTransform() {
  const r = state.rp;
  $("#overlay-img").style.transform = (r.scale === 1 && r.x === 0 && r.y === 0) ? "" : `translate(${r.x}px, ${r.y}px) scale(${r.scale})`;
}
function hasNowPhoto() { const ph = currentPhoto(); return !!(ph && ph.now && (ph.now.src || ph.now.remote)); }
function rpBearingText() {
  const ph = currentPhoto(), vp = ph && ph.viewpoint;
  if (!vp || vp.bearing == null || !Number.isFinite(Number(vp.bearing))) return "";   // азимута нет в данных — ничего не придумываем
  const b = Number(vp.bearing);
  let s = `Снимок сделан в сторону: ${dirName(b)} (азимут ${Math.round(b)}°).`;
  if (hasFreshHeading()) s += ` Сейчас телефон смотрит на ${Math.round(state.heading)}°.`;
  return s;
}
function rpUpdateHint() {
  const r = state.rp;
  if (!r.on) return;
  const hint = $("#rp-hint");
  if (r.step === 1) {
    const b = rpBearingText();
    hint.innerHTML = "Двигайте телефон, пока контур не совпадёт со зданием" + `<small>Двумя пальцами — масштаб, одним — сдвиг накладки.${b ? " " + esc(b) : ""}</small>`;
  } else if (r.noCam) {
    hint.innerHTML = "Тяните шторку пальцем<small>Слева старое фото, справа современное.</small>";
  } else {
    hint.innerHTML = "Тяните шторку пальцем<small>Слева старое фото, справа живая камера. «Снимок» сохранит кадр.</small>";
  }
}
function rpLayout(step) {
  const r = state.rp, ph = currentPhoto();
  r.step = step;
  const ov = $("#overlay-img"), wrap = $("#overlay-wrap");
  $("#rp-done").classList.toggle("hidden", step !== 1);
  $("#rp-reset").classList.toggle("hidden", step !== 1);
  $("#rp-shot").classList.toggle("hidden", step !== 2);
  $("#rp-back").classList.toggle("hidden", step !== 2 || r.noCam);
  $("#rp-label-l").classList.toggle("hidden", step !== 2);
  $("#rp-label-r").classList.toggle("hidden", step !== 2);
  $("#rp-label-l").textContent = ph ? String(ph.year) : "Тогда";
  if (step === 1) {
    const src = hasNowPhoto() ? ph.now : ph;   // современный снимок того же ракурса; нет — само историческое фото
    bindImg(ov, src.src, src.remote, "Контур для совмещения");
    ov.classList.remove("hidden");
    state.camMode = "overlay";
    wrap.style.clipPath = ""; wrap.style.webkitClipPath = "";
    ov.style.opacity = 0.35;
    $("#cam-curtain").classList.add("hidden");
    $("#cam-slider").classList.add("hidden");
  } else {
    bindImg(ov, ph.src, ph.remote, ph.title);
    ov.classList.remove("hidden");
    ov.style.opacity = 1;
    state.camMode = "curtain";
    setCurtain(50);
    $("#cam-curtain").classList.remove("hidden");
    $("#cam-slider").classList.add("hidden");
  }
  applyRpTransform();
  $$("#cam-modes button").forEach(b => { const on = step === 2 && b.dataset.mode === "curtain"; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  rpUpdateHint();
}
function rpOpenStage() {
  state.rp.on = true;
  $("#hero").classList.add("rp-full");
  document.body.classList.add("rp-lock");
  $("#rp-ui").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "instant" });
}
function startRephoto() {
  if (!state.cameraOn) return;
  state.rp.noCam = false;
  rpReset();
  rpOpenStage();
  rpLayout(1);
}
/* без камеры: шторка между историческим и современным фото (если современного снимка нет — честно говорим об этом) */
function startRephotoNoCam() {
  const ph = currentPhoto();
  if (!hasNowPhoto()) { toast("Для этого кадра нет современного фото. Включите камеру."); return; }
  state.rp.noCam = true;
  rpReset();
  const now = $("#rp-now-img");
  bindImg(now, ph.now.src, ph.now.remote, "Сейчас");
  now.classList.remove("hidden");
  $("#then-img").classList.add("hidden");
  rpOpenStage();
  rpLayout(2);
}
function exitRephoto(silent) {
  const r = state.rp;
  if (!r.on) return;
  const wasStep = r.step, wasNoCam = r.noCam;
  r.on = false;
  $("#hero").classList.remove("rp-full");
  document.body.classList.remove("rp-lock");
  $("#rp-ui").classList.add("hidden");
  $("#rp-now-img").classList.add("hidden");
  if (wasNoCam) {
    r.noCam = false;
    $("#overlay-img").classList.add("hidden");
    $("#then-img").classList.remove("hidden");
    $("#cam-curtain").classList.add("hidden");
    const wrap = $("#overlay-wrap"); wrap.style.clipPath = ""; wrap.style.webkitClipPath = "";
    rpReset(); applyRpTransform();
    return;
  }
  if (silent) return;
  if (state.cameraOn) {
    const ph = currentPhoto();
    bindImg($("#overlay-img"), ph.src, ph.remote, ph.title);
    if (wasStep === 2) setCamMode("curtain");        // совмещённые масштаб и сдвиг остаются
    else { rpReset(); applyRpTransform(); setCamMode("overlay"); }
  }
}
function rpClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function initRephoto() {
  const hero = $("#hero"), r = state.rp, pts = new Map();
  let base = null;
  const mid = () => { const a = [...pts.values()]; return a.length === 2 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) } : null; };
  const active = () => r.on && r.step === 1 && !r.noCam;
  hero.addEventListener("pointerdown", e => {
    if (!active() || e.target.closest("button")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { hero.setPointerCapture(e.pointerId); } catch {}
    const m = mid();
    base = m ? { d: m.d, scale: r.scale, mx: m.x, my: m.y, x: r.x, y: r.y } : { px: e.clientX, py: e.clientY, x: r.x, y: r.y };
  });
  hero.addEventListener("pointermove", e => {
    if (!active() || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = mid();
    if (m && base && base.d) {
      r.scale = rpClamp(base.scale * m.d / base.d, 0.3, 6);
      r.x = base.x + (m.x - base.mx); r.y = base.y + (m.y - base.my);
    } else if (!m && base && base.px != null) {
      r.x = base.x + (e.clientX - base.px); r.y = base.y + (e.clientY - base.py);
    }
    applyRpTransform();
  });
  const up = e => {
    try { hero.releasePointerCapture(e.pointerId); } catch {}
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const left = [...pts.values()][0];
    base = left ? { px: left.x, py: left.y, x: r.x, y: r.y } : null;   // остался один палец: сдвиг продолжается без скачка
  };
  hero.addEventListener("pointerup", up);
  hero.addEventListener("pointercancel", up);
  hero.addEventListener("wheel", e => { if (!active()) return; e.preventDefault(); r.scale = rpClamp(r.scale * Math.exp(-e.deltaY * 0.002), 0.3, 6); applyRpTransform(); }, { passive: false });
  $("#rp-done").addEventListener("click", () => { r.saved = { scale: r.scale, x: r.x, y: r.y }; rpLayout(2); });
  $("#rp-reset").addEventListener("click", () => { rpReset(); applyRpTransform(); });
  $("#rp-back").addEventListener("click", () => rpLayout(1));
  $("#rp-exit").addEventListener("click", () => exitRephoto());
  $("#rp-shot").addEventListener("click", captureRephoto);
  $("#btn-rp-nocam").addEventListener("click", startRephotoNoCam);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && r.on) exitRephoto(); });
}
function rpLoadImg(img) { return img && img.complete && img.naturalWidth ? img : null; }
/* Кадр со шторкой через canvas: те же cover/contain, масштаб, сдвиг и положение шторки, что на экране */
async function captureRephoto() {
  const r = state.rp, hero = $("#hero"), ph = currentPhoto(), p = currentPoint();
  if (!r.on || !ph) return;
  const box = hero.getBoundingClientRect();
  const W = box.width, H = box.height, k = Math.min(2, 1080 / W), foot = 34;
  const cv = document.createElement("canvas");
  cv.width = Math.round(W * k); cv.height = Math.round((H + foot) * k);
  const c = cv.getContext("2d");
  c.scale(k, k);
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H + foot);
  const fit = (iw, ih, mode) => { const s = (mode === "cover" ? Math.max : Math.min)(W / iw, H / ih); return { w: iw * s, h: ih * s }; };
  try {
    if (r.noCam) {
      const n = rpLoadImg($("#rp-now-img"));
      if (n) { const d = fit(n.naturalWidth, n.naturalHeight, "contain"); c.drawImage(n, (W - d.w) / 2, (H - d.h) / 2, d.w, d.h); }
    } else {
      const v = $("#live-video");
      if (v.videoWidth) { const d = fit(v.videoWidth, v.videoHeight, "cover"); c.drawImage(v, (W - d.w) / 2, (H - d.h) / 2, d.w, d.h); }
    }
    const o = rpLoadImg($("#overlay-img"));
    if (o) {
      c.save();
      c.beginPath(); c.rect(0, 0, W * state.curtain / 100, H); c.clip();
      const d = fit(o.naturalWidth, o.naturalHeight, "contain"), sc = r.noCam ? 1 : r.scale, tx = r.noCam ? 0 : r.x, ty = r.noCam ? 0 : r.y;
      c.translate(W / 2 + tx, H / 2 + ty); c.scale(sc, sc);
      c.drawImage(o, -d.w / 2, -d.h / 2, d.w, d.h);
      c.restore();
    }
    const cx = W * state.curtain / 100;
    c.fillStyle = "#d4b06a"; c.fillRect(cx - 1.5, 0, 3, H);
    c.beginPath(); c.arc(cx, H / 2, 20, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#1c1710"; c.font = "700 18px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("‹ ›", cx, H / 2 + 1);
    const chip = (txt, x, align) => {
      c.font = "700 16px sans-serif"; c.textBaseline = "middle"; c.textAlign = align;
      const w = c.measureText(txt).width + 20, left = align === "left" ? x : x - w;
      c.fillStyle = "rgba(20,12,14,.78)"; c.fillRect(left, 14, w, 30);
      c.fillStyle = "#f6e7c4"; c.fillText(txt, align === "left" ? x + 10 : x - 10, 29);
    };
    chip(String(ph.year), 14, "left"); chip("Сейчас", W - 14, "right");
    c.fillStyle = "#14090b"; c.fillRect(0, H, W, foot);
    c.fillStyle = "#e5ca8c"; c.font = "600 12px sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
    const cap = `Скорбященский храм на Ордынке · ${p ? p.title : ""} · тогда: ${ph.year}, ${shortAuthor(ph.author)}`;
    c.fillText(cap.length > 64 ? cap.slice(0, 63) + "…" : cap, 10, H + foot / 2);
    const blob = await new Promise((res, rej) => { try { cv.toBlob(b => b ? res(b) : rej(new Error("empty")), "image/jpeg", 0.92); } catch (e) { rej(e); } });
    const name = `ordynka-refoto-${p ? p.id : "kadr"}.jpg`;
    const file = new File([blob], name, { type: "image/jpeg" });
    let how = "download";
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Скорбященский храм на Ордынке: тогда и сейчас" }); how = "share"; }
      catch (e) { if (e && e.name === "AbortError") { r.shot = { w: cv.width, h: cv.height, size: blob.size, how: "cancel" }; return; } how = "download"; }
    }
    if (how === "download") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    r.shot = { w: cv.width, h: cv.height, size: blob.size, how, name };
    toast(how === "share" ? "Снимок отправлен." : "Снимок сохранён в загрузки телефона.");
  } catch (e) {
    console.warn(e);
    r.shot = { error: String((e && e.name) || e) };
    toast("Не удалось сохранить снимок: фото с внешнего сайта не разрешает копию. Сделайте обычный скриншот экрана.");
  }
}

function cameraErrorText(e) {
  const n = e && e.name;
  if (!window.isSecureContext) return "Камере нужен защищённый адрес (https). Откройте сайт по https-ссылке.";
  if (n === "NotAllowedError" || n === "SecurityError") return "Доступ к камере запрещён. Разрешите камеру для этого сайта в настройках браузера и нажмите кнопку ещё раз.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "Камера не найдена на этом устройстве.";
  if (n === "NotReadableError" || n === "AbortError") return "Камера занята другим приложением. Закройте его и попробуйте снова.";
  return "Не удалось включить камеру. Сравните снимки ниже.";
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camMessage(window.isSecureContext ? "Камера недоступна в этом браузере. Сравните снимки ниже." : "Камере нужен защищённый адрес (https).");
    toast("Камера недоступна.");
    $("#btn-rp-nocam").classList.toggle("hidden", !hasNowPhoto());
    return;
  }
  const player = pl();
  const wasPlaying = !player.paused && !player.ended;
  camMessage("Включаем камеру…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false     // микрофон не нужен: так камера не трогает звук рассказа
    });
    state.stream = stream;
    state.cameraOn = true;
    const video = $("#live-video");
    video.muted = true; video.defaultMuted = true; video.setAttribute("muted", "");
    video.srcObject = stream;
    video.classList.remove("hidden");
    await video.play();
    $("#then-img").classList.add("hidden");
    $("#hero").classList.add("cam-on");
    $("#overlay-img").classList.remove("hidden");
    $("#btn-camera").textContent = "Выключить камеру";
    $("#btn-camera").classList.add("on");
    $("#cam-modes").classList.remove("hidden");
    $("#btn-rp-nocam").classList.add("hidden");
    state.opacity = 0.55; $("#opacity").value = "0.55"; $("#opacity-val").textContent = "55%";
    state.curtain = 50;
    setCamMode("overlay");
    // на iOS включение камеры иногда ставит звук на паузу: возвращаем, если рассказ играл
    if (wasPlaying && player.paused && !player.ended) player.play().catch(() => {});
    setTimeout(() => { if (wasPlaying && player.paused && !player.ended && state.cameraOn) player.play().catch(() => {}); }, 600);
  } catch (e) {
    console.warn(e);
    camMessage(cameraErrorText(e));
    toast(cameraErrorText(e));
    stopCamera(true);
    $("#btn-rp-nocam").classList.toggle("hidden", !hasNowPhoto());
  }
}

function stopCamera(keepMessage) {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  const video = $("#live-video");
  video.pause();
  video.srcObject = null;
  video.classList.add("hidden");
  state.cameraOn = false;
  const btn = $("#btn-camera");
  btn.textContent = "Совместить с камерой";
  btn.classList.remove("on");
  $("#then-img").classList.remove("hidden");
  $("#hero").classList.remove("cam-on");
  if (state.rp && state.rp.on) exitRephoto(true);
  const ov = $("#overlay-img"), wrap = $("#overlay-wrap");
  ov.classList.add("hidden"); wrap.style.clipPath = ""; wrap.style.webkitClipPath = ""; ov.style.opacity = "";
  rpReset(); applyRpTransform();
  $("#cam-slider").classList.add("hidden");
  $("#cam-curtain").classList.add("hidden");
  $("#cam-modes").classList.add("hidden");
  if (!keepMessage) camMessage("");
}

function imHere() {
  const p = currentPoint();
  if (!p) return;
  state.lastTrigger[p.id] = Date.now();
  try { pl().currentTime = 0; } catch {}
  startNarration();
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


/* Рассказы (~19 МБ) не качаются сами: слушанный рассказ кэшируется service worker'ом при первом проигрывании,
   остальные скачиваются кнопкой «Скачать рассказы для офлайна». */
function audioFiles() { return state.data.points.map(p => p.audioLocal || p.audio).filter(a => a && !/^https?:/.test(a)); }
async function updateOfflineAudioStatus() {
  const el = $("#offline-audio-status");
  if (!el || !("caches" in window)) return;
  const files = audioFiles();
  let have = 0;
  for (const f of files) { try { if (await caches.match(f, { ignoreSearch: true })) have++; } catch {} }
  el.textContent = have === files.length ? "Все рассказы сохранены, работают без интернета." : `Сохранено рассказов: ${have} из ${files.length}.`;
  const btn = $("#btn-offline-audio");
  if (btn) btn.disabled = have === files.length;
}
async function downloadAudioOffline() {
  const btn = $("#btn-offline-audio"), el = $("#offline-audio-status");
  if (!("serviceWorker" in navigator) || location.protocol === "file:") { toast("Офлайн-режим здесь недоступен."); return; }
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sw = reg && (reg.active || navigator.serviceWorker.controller);
  if (!sw) { toast("Офлайн-кэш ещё не готов. Подождите несколько секунд и повторите."); return; }
  btn.disabled = true;
  const ch = new MessageChannel();
  ch.port1.onmessage = e => {
    if (e.data && e.data.progress) el.textContent = `Скачиваем рассказы: ${e.data.progress} из ${e.data.total}…`;
    if (e.data && e.data.done) {
      updateOfflineAudioStatus();
      toast(e.data.ok ? "Рассказы сохранены для работы без интернета." : "Часть рассказов не скачалась. Проверьте сеть и нажмите ещё раз.");
      if (!e.data.ok) btn.disabled = false;
    }
  };
  sw.postMessage({ type: "precache", files: audioFiles(), progress: true }, [ch.port2]);
}

/* offline: service worker caches pages, audio and photos */
function initOffline() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  // Новая версия service worker: перезагружаем страницу один раз, чтобы телефон сразу получил свежие файлы.
  // Не перезагружаем, пока играет рассказ: дождёмся паузы или конца.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const reloadWhenIdle = () => {
    if (reloaded) return;
    const cur = pl();
    if (cur && !cur.paused && !cur.ended) { cur.addEventListener("pause", reloadWhenIdle, { once: true }); cur.addEventListener("ended", reloadWhenIdle, { once: true }); return; }
    reloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) reloadWhenIdle(); });
  navigator.serviceWorker.register("sw.js").then(async reg => {
    reg.update().catch(() => {});
    await navigator.serviceWorker.ready;
    if (lsGet("ordynka-offline") === "v2") return;
    const files = new Set(["data/points.json"]);
    for (const p of state.data.points) {
      files.add(p.script);
      if (p.ttsScript) files.add(p.ttsScript);
      p.photos.forEach(ph => { files.add(ph.src); files.add(thumbOf(ph.src)); if (ph.now) { files.add(ph.now.src); files.add(thumbOf(ph.now.src)); } });
      if (p.nowContext) { files.add(p.nowContext.src); files.add(thumbOf(p.nowContext.src)); }
      if (p.heroNow) { files.add(p.heroNow.src); files.add(thumbOf(p.heroNow.src)); }
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = e => {
      if (e.data && e.data.ok) { lsSet("ordynka-offline", "v2"); toast("Тексты и фото сохранены для работы без интернета."); }
    };
    (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: "precache", files: [...files] }, [ch.port2]);
  }).catch(e => console.warn("sw", e));
}

async function main() {
  await loadData();
  state.rate = 1;
  state.arriveOn = lsGet("ordynka-arrive") !== "0";
  try { state.visited = JSON.parse(lsGet("ordynka-visited") || "{}") || {}; } catch { state.visited = {}; }
  $("#opt-arrive").checked = state.arriveOn;
  // The cover title and editorial introduction are intentionally composed in index.html.
  // Keep them static so the historical opening layout is not flattened by data binding.
  $("#cover-place").textContent = state.data.place;
  initLightbox();
  initCamControls();
  renderList();
  applyHash();

  // «Начать»: открываем рассказ текущей остановки и сразу запускаем звук в этом же нажатии (требование iOS)
  $("#btn-start").addEventListener("click", () => {
    startTour();
    const i = nextUnvisitedIndex();
    if (i >= 0) { openPoint(state.data.points[i].id, true); }
  });
  $("#nav-route").addEventListener("click", focusNextOnMap);
  $("#map-my-location").addEventListener("click", () => {
    if (!state.pos) { enableGps(); toast("Ищем ваше местоположение…"); return; }
    state.map.setView([state.pos.lat,state.pos.lon],18);
  });
  $("#map-fit-route").addEventListener("click", fitFullRoute);
  $("#nav-arrived").addEventListener("click", () => {
    const p = state.data.points[navTargetIndex()];
    if (!p || !NavCore.arrivalState(state.pos, p).ready) return;   // те же пороги, что и у показа кнопки
    markVisited(p.id);
    $("#navigation-hud").classList.add("hidden");
    openPoint(p.id, false);
  });
  $("#nav-open").addEventListener("click", () => {
    const i = navTargetIndex();
    const p = i < 0 ? state.data.points[0] : state.data.points[i];
    openPoint(p.id, true);   // явное нажатие «Рассказ об остановке» — сразу включаем звук
  });
  $("#nav-next").addEventListener("click", () => {
    if (navTargetIndex() < 0) {
      state.navPref = null;
      state.visited = {};
      lsDel("ordynka-visited");
      renderList();
      updateNavigator();
    } else {
      const p = state.data.points[navTargetIndex()];
      state.navPref = null;
      state.visited[p.id] = true;
      saveVisited();
      renderList();
      updateNavigator();
      toast("Точка пропущена. Показали следующую.");
    }
    const p = state.data.points[state.navIndex];
    if (state.markers[p.id] && state.map) state.map.setView([p.lat, p.lon], 18);
  });
  $("#btn-done").addEventListener("click", () => {
    markVisited(state.currentId);
    $("#btn-done").textContent = "Остановка пройдена ✓";
    $("#btn-done").disabled = true;
  });
  $("#btn-about").addEventListener("click", () => showScreen("screen-about"));
  $$("[data-back=tour]").forEach(b => b.addEventListener("click", () => {
    showScreen("screen-tour");
    setTimeout(() => state.map && state.map.invalidateSize(), 200);
  }));
  $("#btn-back-point").addEventListener("click", closePoint);
  $$(".js-prev").forEach(b => b.addEventListener("click", () => gotoNeighbor(-1)));
  $$(".js-next").forEach(b => b.addEventListener("click", () => gotoNeighbor(1)));
  $("#btn-gps").addEventListener("click", enableGps);
  $("#btn-here").addEventListener("click", imHere);
  $("#btn-camera").addEventListener("click", () => { state.cameraOn ? stopCamera() : startCamera(); });
  $("#btn-compass").addEventListener("click", enableCompass);
  $("#nav-compass").addEventListener("click", enableCompass);
  $("#then-img").addEventListener("click", () => openLightboxForCurrent(currentPhoto().src));
  $("#then-img").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightboxForCurrent(currentPhoto().src); } });
  $("#btn-full").addEventListener("click", () => openLightboxForCurrent(currentPhoto().src));
  $("#now-context-img").addEventListener("click", () => { const p = currentPoint(); openLightboxForCurrent(p.nowContext.src); });
  $("#opacity").addEventListener("input", (e) => {
    state.opacity = Number(e.target.value);
    if (state.camMode === "overlay") $("#overlay-img").style.opacity = state.opacity;
    $("#opacity-val").textContent = Math.round(state.opacity * 100) + "%";
  });
  $("#opt-arrive").addEventListener("change", e => {
    state.arriveOn = e.target.checked;
    lsSet("ordynka-arrive", state.arriveOn ? "1" : "0");
  });
  $("#arrive-go").addEventListener("click", () => {
    $("#arrive").classList.add("hidden");
    openPoint(state.arriveId, true);   // started by the tap, so iOS allows playback
  });
  $("#arrive-no").addEventListener("click", () => $("#arrive").classList.add("hidden"));

  const playBtn = $("#btn-play");
  const setPlayLabel = () => {
    const player = pl();
    playBtn.textContent = !player.paused && !player.ended ? "Пауза" : (player.ended ? "Повторить рассказ" : (player.currentTime > 1 ? "Продолжить" : "Начать рассказ"));
    playBtn.classList.toggle("playing", !player.paused && !player.ended);
  };
  playBtn.addEventListener("click", () => {
    const player = pl();
    if (player.paused || player.ended) { if (player.ended) { try { player.currentTime = 0; } catch {} } startNarration(); }
    else { narr.wantPlay = false; clearTimeout(narr.timer); player.pause(); }
  });
  const onEnded = () => {
    narr.wantPlay = false;
    clearTimeout(narr.timer);
    setPlayLabel();
    updatePointNav();
    // решение владельца: остановка отмечается пройденной сама по окончании рассказа, навигация переходит к следующей.
    // Следующий рассказ сам НЕ включается: человек ещё идёт, звук запускается кнопкой «Начать рассказ» или «Я на месте».
    if (state.currentId) {
      const id = state.currentId;
      markVisited(id);
      $("#btn-done").textContent = "Остановка пройдена ✓";
      $("#btn-done").disabled = true;
      const nx = state.data.points[nextUnvisitedIndex()];
      toast(nx ? `Остановка пройдена. Дальше: ${nx.num}. ${nx.title}` : "Остановка пройдена. Это была последняя.");
    }
  };
  for (const el of [$("#player"), ttsp]) {
    const mine = () => pl() === el;
    el.addEventListener("play", () => { if (mine()) setPlayLabel(); });
    el.addEventListener("playing", () => { if (!mine()) return; clearTimeout(narr.timer); setPlayLabel(); });
    el.addEventListener("pause", () => { if (!mine()) return; if (!el.ended) narr.wantPlay = false; setPlayLabel(); });
    el.addEventListener("play", () => { if (mine() && state.currentId) updatePointNav(); });
    el.addEventListener("emptied", () => { if (mine()) setPlayLabel(); });
    el.addEventListener("ended", () => { if (mine()) onEnded(); });
  }
  $("#player").addEventListener("error", onNarrationError);
  $("#player").addEventListener("loadedmetadata", () => { $("#player").playbackRate = state.rate; });
  if (!audioFiles().length) {
    $(".offline-audio").classList.add("hidden");
    $("#offline-audio-none").classList.remove("hidden");
  }
  $("#btn-offline-audio").addEventListener("click", downloadAudioOffline);
  updateOfflineAudioStatus();
  initOffline();
}

main().catch(err => {
  console.error(err);
  toast("Не удалось загрузить данные экскурсии.");
});

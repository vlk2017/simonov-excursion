/* Чистые функции навигации «Веду вас». Не зависят от DOM, поэтому покрыты node-тестами (tests/nav-core.test.js).
   В браузере доступны как глобальный NavCore, в node — через require. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NavCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const R_EARTH = 6371000;
  const toRad = d => d * Math.PI / 180;

  // Пороги прибытия: кнопка «Я на месте» доступна только при обоих условиях.
  const ARRIVE_MAX_DISTANCE_M = 22;
  const ARRIVE_MAX_ACCURACY_M = 20;
  // Уход с маршрута: дальше OFF_ROUTE_DISTANCE_M несколько измерений подряд при приемлемой точности.
  const OFF_ROUTE_DISTANCE_M = 30;
  const OFF_ROUTE_MAX_ACCURACY_M = 30;
  const OFF_ROUTE_FIXES = 3;

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function bearingTo(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  const DIRS = ["север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад"];
  function normalizeAngle(a) { return ((a % 360) + 360) % 360; }
  function dirName(b) { return DIRS[Math.round(normalizeAngle(b) / 45) % 8]; }
  /* кратчайшая разность углов, от -180 до 180 */
  function angleDelta(from, to) { return ((to - from + 540) % 360 + 360) % 360 - 180; }

  function fmtDist(m) {
    if (m == null || !Number.isFinite(m)) return "—";
    if (m < 1000) return `${Math.round(m)} м`;
    return `${(m / 1000).toFixed(1)} км`;
  }

  /* Valhalla отдаёт геометрию в polyline с точностью 1e-6 */
  function decodePolyline6(encoded) {
    if (typeof encoded !== "string") throw new Error("Некорректная геометрия маршрута");
    let index = 0, lat = 0, lon = 0;
    const points = [];
    const readValue = () => {
      let result = 0, shift = 0, byte;
      do {
        if (index >= encoded.length) throw new Error("Некорректная геометрия маршрута");
        byte = encoded.charCodeAt(index++) - 63;
        result += (byte & 0x1f) * Math.pow(2, shift);
        shift += 5;
      } while (byte >= 0x20);
      return (result % 2) ? -(result + 1) / 2 : result / 2;
    };
    while (index < encoded.length) {
      lat += readValue();
      lon += readValue();
      points.push([lat / 1e6, lon / 1e6]);
    }
    return points;
  }

  /* для тестов и фикстур */
  function encodePolyline6(points) {
    let pLat = 0, pLon = 0, out = "";
    const put = v => {
      let n = v < 0 ? ~(v << 1) : (v << 1);
      while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
      out += String.fromCharCode(n + 63);
    };
    for (const [la, lo] of points) {
      const a = Math.round(la * 1e6), b = Math.round(lo * 1e6);
      put(a - pLat); put(b - pLon);
      pLat = a; pLon = b;
    }
    return out;
  }

  function cumulativeDistances(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    return cum;
  }

  /* Проекция точки на отрезок в локальной плоскости (метры). Возвращает {t, dist}. */
  function projectOnSegment(lat, lon, a, b) {
    const k = Math.cos(toRad(lat)) * 111320;
    const ax = (a[1] - lon) * k, ay = (a[0] - lat) * 110540;
    const bx = (b[1] - lon) * k, by = (b[0] - lat) * 110540;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    return { t, dist: Math.hypot(px, py) };
  }

  /* Ближайшая точка маршрута. Прогресс только вперёд в окне [from-back, from+ahead] сегментов:
     так GPS-скачок назад не откатывает подсказку, а петля маршрута не «перепрыгивает» участок.
     Возвращает {index (начало сегмента), t, distance (до линии, м), along (метры от начала)}. */
  function projectOnRoute(coords, cum, pos, fromIndex = 0, opts = {}) {
    if (!coords || coords.length < 2) return null;
    const back = opts.back ?? 2, ahead = opts.ahead ?? 60;
    const last = coords.length - 2;
    const lo = Math.max(0, Math.min(last, fromIndex - back));
    const hi = Math.min(last, Math.max(lo, fromIndex + ahead));
    let best = null, minDist = Infinity;
    for (let i = lo; i <= hi; i++) {
      const pr = projectOnSegment(pos.lat, pos.lon, coords[i], coords[i + 1]);
      // при почти равном расстоянии (стоим точно на вершине поворота) берём более поздний сегмент
      if (!best || pr.dist <= minDist + 0.3) best = { index: i, t: pr.t, distance: pr.dist };
      minDist = Math.min(minDist, pr.dist);
    }
    const segLen = cum[best.index + 1] - cum[best.index];
    best.along = cum[best.index] + best.t * segLen;
    return best;
  }

  /* Ближайший впереди манёвр: тот, чей begin_shape_index лежит дальше начала текущего сегмента.
     Манёвр с begin = index+1 — это поворот в конце текущего сегмента, он ещё впереди. */
  function pickNextManeuver(maneuvers, segIndex) {
    if (!Array.isArray(maneuvers) || !maneuvers.length) return null;
    const next = maneuvers.find(m => Number.isFinite(Number(m.begin_shape_index)) && Number(m.begin_shape_index) > segIndex);
    return next || maneuvers[maneuvers.length - 1];
  }

  function distanceToManeuver(maneuver, cum, projection, coordsLength) {
    if (!maneuver || !Number.isFinite(Number(maneuver.begin_shape_index))) return null;
    const mi = Math.max(0, Math.min(coordsLength - 1, Number(maneuver.begin_shape_index)));
    return Math.max(0, cum[mi] - projection.along);
  }

  function remainingDistance(cum, projection) {
    return Math.max(0, cum[cum.length - 1] - projection.along);
  }

  const WALK_SPEED_M_PER_MIN = 75;
  function walkMinutes(meters) { return Math.max(1, Math.round(meters / WALK_SPEED_M_PER_MIN)); }

  /* Состояние кнопки «Я на месте». acc неизвестна = ненадёжно = кнопка закрыта. */
  function arrivalState(pos, target, opts = {}) {
    const maxD = opts.maxDistance ?? ARRIVE_MAX_DISTANCE_M, maxAcc = opts.maxAccuracy ?? ARRIVE_MAX_ACCURACY_M;
    if (!pos || !target) return { ready: false, reason: "no-position", distance: null };
    const distance = haversine(pos.lat, pos.lon, target.lat, target.lon);
    const maxAge = opts.maxAgeMs ?? 30000, now = opts.now ?? Date.now();
    if (Number.isFinite(pos.t) && now - pos.t > maxAge) return { ready: false, reason: "stale", distance };
    if (!Number.isFinite(pos.acc)) return { ready: false, reason: "no-accuracy", distance };
    if (pos.acc > maxAcc) return { ready: false, reason: "poor-accuracy", distance };
    if (distance > maxD) return { ready: false, reason: "too-far", distance };
    return { ready: true, reason: "ok", distance };
  }

  /* Плашка «Подойдите к точке» над кнопкой «Начать рассказ». Тот же радиус и те же требования к точности, что у «Я на месте».
     kind: here — на месте; far — далеко (distance, bearing); near — близко, но GPS пока неточен; none — места нет или данные устарели. */
  function approachState(pos, target, opts = {}) {
    const a = arrivalState(pos, target, opts);
    if (a.reason === "no-position") return { kind: "none", reason: a.reason, distance: null, bearing: null };
    const bearing = bearingTo(pos.lat, pos.lon, target.lat, target.lon);
    if (a.ready) return { kind: "here", reason: a.reason, distance: a.distance, bearing };
    if (a.reason === "too-far") return { kind: "far", reason: a.reason, distance: a.distance, bearing };
    if (a.reason === "poor-accuracy") return { kind: a.distance > (opts.nearDistance ?? 60) ? "far" : "near", reason: a.reason, distance: a.distance, bearing };
    return { kind: "none", reason: a.reason, distance: a.distance, bearing };
  }

  /* Уровень доверия к GPS для HUD */
  function gpsQuality(acc) {
    if (!Number.isFinite(acc)) return { level: "unknown", label: "GPS: точность неизвестна" };
    if (acc <= ARRIVE_MAX_ACCURACY_M) return { level: "good", label: `GPS ±${Math.round(acc)} м` };
    if (acc <= 50) return { level: "fair", label: `GPS неточный, ±${Math.round(acc)} м` };
    return { level: "poor", label: `GPS очень неточный, ±${Math.round(acc)} м` };
  }

  /* Уход с маршрута: нужно OFF_ROUTE_FIXES измерений подряд дальше порога при приемлемой точности.
     Измерение с плохой точностью ни подтверждает, ни сбрасывает счётчик (шум не должен ничего решать). */
  function createOffRouteTracker(opts = {}) {
    const dist = opts.distance ?? OFF_ROUTE_DISTANCE_M, maxAcc = opts.maxAccuracy ?? OFF_ROUTE_MAX_ACCURACY_M, need = opts.fixes ?? OFF_ROUTE_FIXES;
    let count = 0;
    return {
      update(distanceToRoute, acc) {
        if (!Number.isFinite(distanceToRoute)) return false;
        if (!Number.isFinite(acc) || acc > maxAcc) return count >= need;
        if (distanceToRoute > dist) count++; else count = 0;
        return count >= need;
      },
      reset() { count = 0; },
      get count() { return count; }
    };
  }

  /* Проверка ответа Valhalla. Единицы: units=km → length в км, time в секундах. */
  function parseValhallaRoute(data) {
    const leg = data && data.trip && data.trip.legs && data.trip.legs[0];
    if (!leg || typeof leg.shape !== "string") throw new Error("В ответе нет линии маршрута");
    const coords = decodePolyline6(leg.shape);
    if (coords.length < 2) throw new Error("В ответе нет линии маршрута");
    const summary = leg.summary || data.trip.summary || {};
    const maneuvers = Array.isArray(leg.maneuvers) ? leg.maneuvers : [];
    const cum = cumulativeDistances(coords);
    const geomLen = cum[cum.length - 1];
    const apiLen = Number(summary.length) * 1000;
    return {
      coords, maneuvers, cum,
      distance: Number.isFinite(apiLen) && apiLen > 0 ? apiLen : geomLen,
      duration: Number(summary.time) > 0 ? Number(summary.time) : geomLen / WALK_SPEED_M_PER_MIN * 60
    };
  }

  /* Понятное сообщение по ошибке маршрутизатора */
  function routingErrorMessage(err) {
    if (err && err.name === "AbortError") return "Маршрутизатор не ответил вовремя.";
    if (err && err.status === 429) return "Маршрутизатор перегружен, попробуйте через минуту.";
    if (err && err.status >= 500) return "Маршрутизатор временно недоступен.";
    if (err && err.status >= 400) return "Маршрутизатор не смог построить путь отсюда.";
    return "Нет связи с маршрутизатором. Нужна сеть.";
  }

  /* Круговое сглаживание азимута компаса (0..360) */
  function smoothAngle(prev, next, alpha = 0.25) {
    if (prev == null || !Number.isFinite(prev)) return normalizeAngle(next);
    return normalizeAngle(prev + angleDelta(prev, next) * alpha);
  }

  return {
    ARRIVE_MAX_DISTANCE_M, ARRIVE_MAX_ACCURACY_M, OFF_ROUTE_DISTANCE_M, OFF_ROUTE_MAX_ACCURACY_M, OFF_ROUTE_FIXES,
    haversine, bearingTo, dirName, normalizeAngle, angleDelta, fmtDist,
    decodePolyline6, encodePolyline6, cumulativeDistances, projectOnSegment, projectOnRoute,
    pickNextManeuver, distanceToManeuver, remainingDistance, walkMinutes,
    arrivalState, approachState, gpsQuality, createOffRouteTracker, parseValhallaRoute, routingErrorMessage, smoothAngle
  };
});

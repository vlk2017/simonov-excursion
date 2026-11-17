const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../js/nav-core.js");
const fixture = require("./fixtures/valhalla-stop1-to-stop5.json"); // реальный ответ Valhalla FOSSGIS, pedestrian, units=km

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ожидали ${b}±${eps}, получили ${a}`);
const route = N.parseValhallaRoute(fixture);

/* точка в метрах от (lat, lon): север и восток */
const offset = (lat, lon, northM, eastM) => ({
  lat: lat + northM / 110540,
  lon: lon + eastM / (111320 * Math.cos(lat * Math.PI / 180))
});

test("haversine: ноль, симметрия, градус широты ≈ 111,2 км", () => {
  assert.equal(N.haversine(55.7, 37.6, 55.7, 37.6), 0);
  near(N.haversine(55, 37, 56, 37), 111195, 50);
  near(N.haversine(55.7148, 37.65725, 55.71335, 37.6585), N.haversine(55.71335, 37.6585, 55.7148, 37.65725), 1e-9);
});

test("bearingTo: стороны света", () => {
  near(N.bearingTo(55, 37, 56, 37), 0, 0.01);
  near(N.bearingTo(55, 37, 55, 38), 90, 0.5);
  near(N.bearingTo(55, 37, 54, 37), 180, 0.01);
  near(N.bearingTo(55, 37, 55, 36), 270, 0.5);
});

test("dirName, normalizeAngle, angleDelta", () => {
  assert.equal(N.dirName(0), "север");
  assert.equal(N.dirName(359), "север");
  assert.equal(N.dirName(90), "восток");
  assert.equal(N.dirName(-90), "запад");
  assert.equal(N.dirName(225), "юго-запад");
  assert.equal(N.normalizeAngle(-10), 350);
  assert.equal(N.angleDelta(350, 10), 20);
  assert.equal(N.angleDelta(10, 350), -20);
  near(Math.abs(N.angleDelta(0, 180)), 180, 1e-9);
});

test("fmtDist", () => {
  assert.equal(N.fmtDist(null), "—");
  assert.equal(N.fmtDist(NaN), "—");
  assert.equal(N.fmtDist(Infinity), "—");
  assert.equal(N.fmtDist(0), "0 м");
  assert.equal(N.fmtDist(999.4), "999 м");
  assert.equal(N.fmtDist(1500), "1.5 км");
});

test("decodePolyline6: круговое преобразование, отрицательные и большие координаты", () => {
  const pts = [[55.714855, 37.65706], [55.714901, 37.657112], [-33.868820, 151.209296], [-33.86881, -151.209296], [0, 0]];
  const back = N.decodePolyline6(N.encodePolyline6(pts));
  assert.equal(back.length, pts.length);
  pts.forEach((p, i) => { near(back[i][0], p[0], 1e-6); near(back[i][1], p[1], 1e-6); });
});

test("decodePolyline6: реальная геометрия Valhalla лежит в bbox из summary", () => {
  const s = fixture.trip.summary;
  assert.equal(route.coords.length, 25);
  for (const [la, lo] of route.coords) {
    assert.ok(la >= s.min_lat - 1e-6 && la <= s.max_lat + 2e-6, "lat в bbox");
    assert.ok(lo >= s.min_lon - 2e-6 && lo <= s.max_lon + 2e-6, "lon в bbox");
  }
  near(route.coords[0][0], 55.714855, 1e-6);
  near(route.coords[24][1], 37.658492, 1e-6);
});

test("decodePolyline6: мусор и обрыв строки дают ошибку, пустая строка — пустой массив", () => {
  assert.deepEqual(N.decodePolyline6(""), []);
  assert.throws(() => N.decodePolyline6(null));
  const ok = N.encodePolyline6([[55.7, 37.6]]);
  assert.throws(() => N.decodePolyline6(ok.slice(0, -1)));
  assert.throws(() => N.decodePolyline6("_"));
});

test("parseValhallaRoute: длина по геометрии совпадает со summary.length (км → м)", () => {
  near(route.distance, 376, 0.5);
  near(route.cum[route.cum.length - 1], 376, 376 * 0.02);
  near(route.duration, 276.756, 0.01);
  assert.equal(route.maneuvers.length, 14);
});

test("parseValhallaRoute: плохие ответы бросают ошибку", () => {
  assert.throws(() => N.parseValhallaRoute(null));
  assert.throws(() => N.parseValhallaRoute({}));
  assert.throws(() => N.parseValhallaRoute({ trip: { legs: [] } }));
  assert.throws(() => N.parseValhallaRoute({ trip: { legs: [{ shape: "" }] } }));
  assert.throws(() => N.parseValhallaRoute({ trip: { legs: [{ shape: N.encodePolyline6([[55.7, 37.6]]) }] } }));
});

test("parseValhallaRoute: без summary берёт длину и время из геометрии", () => {
  const shape = N.encodePolyline6([[55.7, 37.6], [55.7009, 37.6]]);
  const r = N.parseValhallaRoute({ trip: { legs: [{ shape }] } });
  near(r.distance, 100, 1);
  near(r.duration, 100 / 75 * 60, 2);
  assert.deepEqual(r.maneuvers, []);
});

test("projectOnRoute: точка на вершине и со смещением вбок", () => {
  const c = route.coords, cum = route.cum;
  const on = N.projectOnRoute(c, cum, { lat: c[5][0], lon: c[5][1] }, 0);
  assert.ok(on.index === 4 || on.index === 5);
  near(on.distance, 0, 0.5);
  near(on.along, cum[5], 0.5);
  // 40 м в сторону, перпендикулярно первому сегменту
  const mid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
  const brg = N.bearingTo(c[0][0], c[0][1], c[1][0], c[1][1]) + 90;
  const p = offset(mid[0], mid[1], 40 * Math.cos(brg * Math.PI / 180), 40 * Math.sin(brg * Math.PI / 180));
  const off = N.projectOnRoute(c, cum, p, 0, { ahead: 0 }); // только первый сегмент: маршрут дальше возвращается рядом
  assert.equal(off.index, 0);
  near(off.distance, 40, 1.5);
  near(off.t, 0.5, 0.05);
});

test("projectOnRoute: along растёт при движении вперёд, окно не откатывает назад далеко", () => {
  const c = route.coords, cum = route.cum;
  let prev = -1;
  for (let i = 0; i < c.length; i++) {
    const r = N.projectOnRoute(c, cum, { lat: c[i][0], lon: c[i][1] }, Math.max(0, i - 1));
    assert.ok(r.along >= prev - 0.5, `along монотонен на вершине ${i}`);
    prev = r.along;
  }
  // позиция у вершины 3, а прогресс уже на 12: окно [10..] не даёт откатиться к 3
  const r = N.projectOnRoute(c, cum, { lat: c[3][0], lon: c[3][1] }, 12);
  assert.ok(r.index >= 10);
});

test("projectOnRoute: вырожденные данные", () => {
  assert.equal(N.projectOnRoute([], [], { lat: 0, lon: 0 }), null);
  assert.equal(N.projectOnRoute([[55, 37]], [0], { lat: 0, lon: 0 }), null);
  const same = [[55, 37], [55, 37]];
  const r = N.projectOnRoute(same, N.cumulativeDistances(same), { lat: 55, lon: 37 }, 0);
  near(r.distance, 0, 1e-6);
});

test("pickNextManeuver: поворот в конце текущего сегмента не пропускается (регрессия begin_shape_index == index+1)", () => {
  const m = route.maneuvers;
  assert.equal(N.pickNextManeuver(m, 0).instruction, "Поверните направо.");
  assert.equal(N.pickNextManeuver(m, 0).begin_shape_index, 1);
  assert.equal(N.pickNextManeuver(m, 1).begin_shape_index, 3);
  assert.equal(N.pickNextManeuver(m, 2).begin_shape_index, 3);
  assert.equal(N.pickNextManeuver(m, 3).begin_shape_index, 4);
});

test("pickNextManeuver: после последнего манёвра — прибытие; пустой список — null", () => {
  const m = route.maneuvers;
  assert.match(N.pickNextManeuver(m, 23).instruction, /прибыли/);
  assert.match(N.pickNextManeuver(m, 99).instruction, /прибыли/);
  assert.equal(N.pickNextManeuver([], 0), null);
  assert.equal(N.pickNextManeuver(null, 0), null);
});

test("distanceToManeuver и remainingDistance на реальной геометрии", () => {
  const c = route.coords, cum = route.cum;
  const start = N.projectOnRoute(c, cum, { lat: c[0][0], lon: c[0][1] }, 0);
  near(N.remainingDistance(cum, start), cum[24], 0.5);
  const first = N.pickNextManeuver(route.maneuvers, start.index);
  near(N.distanceToManeuver(first, cum, start, c.length), cum[1], 0.5);
  const end = N.projectOnRoute(c, cum, { lat: c[24][0], lon: c[24][1] }, 22);
  near(N.remainingDistance(cum, end), 0, 0.5);
  assert.equal(N.distanceToManeuver({}, cum, start, c.length), null);
});

test("walkMinutes: не меньше минуты", () => {
  assert.equal(N.walkMinutes(0), 1);
  assert.equal(N.walkMinutes(75), 1);
  assert.equal(N.walkMinutes(376), 5);
});

test("arrivalState: пороги точности 5 / 15 / 25 / 50 м при расстоянии 10 м", () => {
  const target = { lat: 55.7148, lon: 37.65725 };
  const p = offset(target.lat, target.lon, 10, 0);
  const at = acc => N.arrivalState({ ...p, acc }, target);
  assert.equal(at(5).ready, true);
  assert.equal(at(15).ready, true);
  assert.equal(at(20).ready, true);
  assert.equal(at(25).ready, false);
  assert.equal(at(25).reason, "poor-accuracy");
  assert.equal(at(50).ready, false);
});

test("arrivalState: далеко, нет точности, нет позиции, устаревшая позиция", () => {
  const target = { lat: 55.7148, lon: 37.65725 };
  const far = offset(target.lat, target.lon, 30, 0);
  assert.equal(N.arrivalState({ ...far, acc: 5 }, target).reason, "too-far");
  const close = offset(target.lat, target.lon, 5, 0);
  assert.equal(N.arrivalState({ ...close, acc: null }, target).reason, "no-accuracy");
  assert.equal(N.arrivalState({ ...close, acc: undefined }, target).ready, false);
  assert.equal(N.arrivalState({ ...close, acc: NaN }, target).ready, false);
  assert.equal(N.arrivalState(null, target).reason, "no-position");
  assert.equal(N.arrivalState(close, null).reason, "no-position");
  const t0 = 1_000_000;
  assert.equal(N.arrivalState({ ...close, acc: 5, t: t0 }, target, { now: t0 + 31000 }).reason, "stale");
  assert.equal(N.arrivalState({ ...close, acc: 5, t: t0 }, target, { now: t0 + 5000 }).ready, true);
});

test("arrivalState: граница расстояния 22 м", () => {
  const target = { lat: 55.7148, lon: 37.65725 };
  assert.equal(N.arrivalState({ ...offset(target.lat, target.lon, 21, 0), acc: 5 }, target).ready, true);
  assert.equal(N.arrivalState({ ...offset(target.lat, target.lon, 23, 0), acc: 5 }, target).ready, false);
});

test("gpsQuality", () => {
  assert.equal(N.gpsQuality(5).level, "good");
  assert.equal(N.gpsQuality(20).level, "good");
  assert.equal(N.gpsQuality(35).level, "fair");
  assert.equal(N.gpsQuality(80).level, "poor");
  assert.equal(N.gpsQuality(null).level, "unknown");
  assert.match(N.gpsQuality(12.4).label, /±12 м/);
});

test("offRouteTracker: одиночный скачок не срабатывает, три подряд — срабатывает, возврат сбрасывает", () => {
  const t = N.createOffRouteTracker();
  assert.equal(t.update(80, 10), false);
  assert.equal(t.update(3, 10), false);   // вернулся — счётчик обнулён
  assert.equal(t.count, 0);
  assert.equal(t.update(40, 10), false);
  assert.equal(t.update(41, 10), false);
  assert.equal(t.update(42, 10), true);
  t.reset();
  assert.equal(t.count, 0);
});

test("offRouteTracker: неточные измерения ничего не решают, граница 30 м", () => {
  const t = N.createOffRouteTracker();
  t.update(60, 10); t.update(60, 10);
  assert.equal(t.update(5, 80), false);    // плохая точность не сбрасывает счётчик
  assert.equal(t.count, 2);
  assert.equal(t.update(60, 80), false);   // и не подтверждает уход
  assert.equal(t.update(60, null), false);
  assert.equal(t.update(60, 10), true);
  const t2 = N.createOffRouteTracker();
  for (let i = 0; i < 5; i++) assert.equal(t2.update(30, 5), false); // ровно 30 м — ещё на маршруте
  assert.equal(t2.update(NaN, 5), false);
});

test("routingErrorMessage: таймаут, 429, 5xx, 4xx, нет сети", () => {
  assert.match(N.routingErrorMessage({ name: "AbortError" }), /вовремя/);
  assert.match(N.routingErrorMessage({ status: 429 }), /перегружен/);
  assert.match(N.routingErrorMessage({ status: 503 }), /недоступен/);
  assert.match(N.routingErrorMessage({ status: 400 }), /не смог/);
  assert.match(N.routingErrorMessage(new TypeError("Failed to fetch")), /сеть/);
});

test("smoothAngle: проходит через 0°, а не через 180°", () => {
  const r = N.smoothAngle(350, 10, 0.5);
  assert.ok(r >= 355 || r <= 5, `получили ${r}`);
  near(N.smoothAngle(null, 123), 123, 1e-9);
  near(N.smoothAngle(90, 90), 90, 1e-9);
  assert.ok(N.smoothAngle(10, 350, 0.5) > 355 || N.smoothAngle(10, 350, 0.5) < 5);
});

test("поворот ровно на вершине: позиция на вершине 1 считается началом следующего сегмента, подсказка уже про следующий манёвр", () => {
  const c = route.coords, cum = route.cum;
  const r = N.projectOnRoute(c, cum, { lat: c[1][0], lon: c[1][1] }, 0);
  assert.equal(r.index, 1);
  assert.equal(N.pickNextManeuver(route.maneuvers, r.index).begin_shape_index, 3);
});

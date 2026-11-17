/* Статическая проверка целостности: DOM id, подключённые файлы, локальные ресурсы данных, координаты не пустые. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const html = read("index.html");
const app = read("js/app.js");
const data = JSON.parse(read("data/points.json"));

test("все #id из app.js есть в index.html", () => {
  const htmlIds = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const used = new Set([...app.matchAll(/\$\$?\("#([\w-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(id => !htmlIds.has(id));
  assert.deepEqual(missing, [], "нет в разметке: " + missing.join(", "));
});

test("index.html: id уникальны", () => {
  const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, []);
});

test("локальные скрипты подключены и существуют, nav-core раньше app", () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  assert.deepEqual(scripts, ["js/nav-core.js", "js/app.js"]);
  scripts.forEach(s => assert.ok(fs.existsSync(path.join(root, s)), s));
});

test("service worker кэширует nav-core.js и все файлы CORE существуют", () => {
  const sw = read("sw.js");
  const core = JSON.parse(sw.match(/const CORE = (\[.*?\]);/s)[1]);
  assert.ok(core.includes("js/nav-core.js"));
  core.filter(f => f !== "./").forEach(f => assert.ok(fs.existsSync(path.join(root, f)), f));
});

test("локальные ресурсы из points.json существуют (внешние http(s) пропускаются)", () => {
  const missing = [];
  const check = v => {
    if (typeof v !== "string" || /^https?:/.test(v)) return;
    if (/^(img|audio|scripts)\//.test(v) && !fs.existsSync(path.join(root, v))) missing.push(v);
  };
  const walk = o => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") Object.entries(o).forEach(([k, v]) => (typeof v === "string" ? check(v) : walk(v)));
  };
  walk(data);
  assert.deepEqual(missing, []);
});

test("points.json: 8 остановок, уникальные id и номера, координаты рядом с монастырём", () => {
  const pts = data.points;
  assert.equal(pts.length, 8);
  assert.equal(new Set(pts.map(p => p.id)).size, 8);
  assert.deepEqual(pts.map(p => p.num), [1, 2, 3, 4, 5, 6, 7, 8]);
  const [cLat, cLon] = data.mapCenter;
  for (const p of pts) {
    assert.equal(typeof p.lat, "number");
    assert.equal(typeof p.lon, "number");
    assert.ok(Math.abs(p.lat - cLat) < 0.005 && Math.abs(p.lon - cLon) < 0.005, `${p.id} вне ~500 м от центра карты`);
    assert.ok(p.title && p.audio && p.script);
  }
});

test("app.js не содержит прямых вызовов localStorage вне обёрток и дублей чистых функций", () => {
  const body = app.replace(/function ls(Get|Set|Del)[^\n]*\n/g, "");
  assert.ok(!/localStorage\./.test(body), "используйте lsGet/lsSet/lsDel");
  assert.ok(!/function (haversine|bearingTo|decodePolyline6|dirName|fmtDist)\b/.test(app), "чистые функции живут в nav-core.js");
});

test("запрос к Valhalla: только pedestrian, есть таймаут и AbortController", () => {
  assert.match(app, /costing: "pedestrian"/);
  assert.ok(!/costing: "auto"/.test(app));
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /ROUTE_TIMEOUT_MS/);
  assert.match(app, /"X-Client-Id"/);
});

test("аудио: все рассказы лежат локально (audio/heygen/*.mp3), внешних ссылок нет, файлы не пустые", () => {
  for (const p of data.points) {
    assert.ok(!/^https?:/.test(p.audio), `${p.id}: внешняя ссылка на аудио`);
    assert.match(p.audio, /^audio\/heygen\/0\d-.+\.mp3$/);
    const f = path.join(root, p.audio);
    assert.ok(fs.existsSync(f), `${p.audio} не найден`);
    assert.ok(fs.statSync(f).size > 1_000_000, `${p.audio} подозрительно мал`);
    const head = fs.readFileSync(f).subarray(0, 3);
    assert.ok(head.toString("latin1") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0), `${p.audio}: это не mp3`);
  }
  assert.equal(new Set(data.points.map(p => p.audio)).size, 8);
});

test("старые локальные audio/*.mp3 не удалены", () => {
  for (const f of ["01-osnovanie", "02-kolokolnya", "03-sobor-dkzil", "04-tikhvin", "05-solevaya", "06-kuznechnaya-stena", "07-dulo", "08-1930"])
    assert.ok(fs.existsSync(path.join(root, `audio/${f}.mp3`)), f);
});

test("sw.js: версия кэша поднята до v4, прогресс предзагрузки поддержан; app.js предзагружает аудио по кнопке", () => {
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "simonov-v4"/);
  assert.match(sw, /progress/);
  assert.match(app, /downloadAudioOffline/);
  assert.match(app, /"simonov-offline"\) === "v4"/);
  assert.ok(html.includes('id="btn-offline-audio"') && html.includes('id="offline-audio-status"'));
});

test("конец рассказа отмечает остановку и переключает навигацию (решение владельца)", () => {
  const m = app.match(/player\.addEventListener\("ended", \(\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(m, "обработчик ended не найден");
  assert.match(m[0], /markVisited\(state\.currentId\)/);
  assert.match(m[0], /nextUnvisitedIndex\(\)/);
});

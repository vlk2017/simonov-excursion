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

test("аудио: основной источник — внешний (HeyGen), запасной — локальный audio/heygen/*.mp3, оба на месте", () => {
  for (const p of data.points) {
    assert.match(p.audio, /^https:\/\/resource2\.heygen\.ai\/.+\.mp3$/, `${p.id}: основной источник должен быть внешним`);
    assert.match(p.audioLocal, /^audio\/heygen\/0\d-.+\.mp3$/, `${p.id}: нет локального запасного файла`);
    const f = path.join(root, p.audioLocal);
    assert.ok(fs.existsSync(f), `${p.audioLocal} не найден`);
    assert.ok(fs.statSync(f).size > 1_000_000, `${p.audioLocal} подозрительно мал`);
    const head = fs.readFileSync(f).subarray(0, 3);
    assert.ok(head.toString("latin1") === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0), `${p.audioLocal}: это не mp3`);
  }
  assert.equal(new Set(data.points.map(p => p.audio)).size, 8);
  assert.equal(new Set(data.points.map(p => p.audioLocal)).size, 8);
});

test("плеер: переключение на запасной источник при ошибке, сторожевой таймер, плеер стоит сразу под фото", () => {
  assert.match(app, /function switchNarrationSource/);
  assert.match(app, /player\.addEventListener\("error", onNarrationError\)/);
  assert.match(app, /AUDIO_START_TIMEOUT_MS/);
  const iHero = html.indexOf('id="hero"'), iAudio = html.indexOf('id="player"'), iThumbs = html.indexOf('id="photo-caption"'), iStand = html.indexOf('id="stand"'), iText = html.indexOf('id="script-text"');
  assert.ok(iHero < iAudio && iAudio < iThumbs && iAudio < iStand && iAudio < iText, "плеер должен стоять сразу после фото, до текста и остального");
  assert.ok(/id="player"[^>]*playsinline/.test(html), "playsinline для iOS");
});

test("старые локальные audio/*.mp3 не удалены", () => {
  for (const f of ["01-osnovanie", "02-kolokolnya", "03-sobor-dkzil", "04-tikhvin", "05-solevaya", "06-kuznechnaya-stena", "07-dulo", "08-1930"])
    assert.ok(fs.existsSync(path.join(root, `audio/${f}.mp3`)), f);
});

test("sw.js: версия кэша v14, прогресс предзагрузки поддержан; app.js предзагружает аудио по кнопке", () => {
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "simonov-v14"/);
  assert.match(sw, /progress/);
  assert.match(app, /downloadAudioOffline/);
  assert.match(app, /"simonov-offline"\) === "v14"/);
  assert.match(sw, /controllerchange|skipWaiting/);
  assert.match(app, /controllerchange/);
  assert.ok(html.includes('id="btn-offline-audio"') && html.includes('id="offline-audio-status"'));
});

test("конец рассказа отмечает остановку и переключает навигацию (решение владельца)", () => {
  const m = app.match(/player\.addEventListener\("ended", \(\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(m, "обработчик ended не найден");
  assert.match(m[0], /markVisited\(id\)/);
  assert.ok(!/startNarration|openPoint/.test(m[0]), "после конца рассказа следующий сам не включается");
  assert.match(m[0], /nextUnvisitedIndex\(\)/);
});

test("карточка остановки: сверху накладка (камера, компас), затем фото, плеер, архив; кнопки камеры не дублируются внизу", () => {
  const pos = id => { const i = html.indexOf(`id="${id}"`); assert.ok(i > 0, id); return i; };
  assert.ok(pos("overlay-bar") < pos("btn-camera") && pos("btn-camera") < pos("hero"), "кнопка камеры выше hero");
  assert.ok(pos("btn-compass") < pos("hero"), "компас выше hero");
  assert.ok(pos("hero") < pos("audio-box") && pos("audio-box") < pos("photo-caption") && pos("photo-caption") < pos("stand") && pos("stand") < html.indexOf(`class="point-body"`));
  assert.ok(!html.includes('id="compare"'), "старый блок «ползунок под фото» убран: шторка теперь в первом кадре карусели");
  assert.equal(html.split('id="btn-camera"').length - 1, 1);
  assert.equal(html.split('id="btn-compass"').length - 1, 1);
  const row = html.slice(html.indexOf('class="row-btns"'), html.indexOf('id="btn-done"'));
  assert.ok(!/btn-camera|btn-compass/.test(row), "в нижнем ряду кнопок камеры больше нет");
});

test("накладка: четыре режима, шторка, ползунок прозрачности, сообщения об отказе камеры, звук не отключается", () => {
  for (const m of ["then", "overlay", "curtain", "now"]) assert.ok(html.includes(`data-mode="${m}"`), m);
  for (const id of ["cam-modes", "cam-curtain", "cam-slider", "opacity", "cam-msg"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(app, /function setCamMode/);
  assert.match(app, /function setCurtain/);
  assert.match(app, /NotAllowedError/);
  assert.match(app, /audio: false/);
  assert.match(html, /<video id="live-video"[^>]*\bmuted\b[^>]*playsinline|<video id="live-video"[^>]*playsinline[^>]*\bmuted\b/);
});

test("карточка остановки: кнопки «Предыдущая»/«Следующая точка» сверху под плеером и дубль внизу, логика перехода в app.js", () => {
  const i = s => { const k = html.indexOf(s); assert.ok(k > 0, s); return k; };
  const top = i('id="pt-nav-top"'), bottom = i('id="pt-nav-bottom"');
  assert.ok(i('id="player"') < top && top < i('id="photo-caption"'), "верхняя панель сразу под плеером");
  assert.ok(bottom > i('id="photo-meta"'), "нижний дубль в конце карточки");
  assert.equal(html.split("js-prev").length - 1, 2);
  assert.equal(html.split("js-next").length - 1, 2);
  assert.match(app, /function gotoNeighbor/);
  assert.match(app, /Завершить прогулку/);
  assert.match(app, /is-primary/);
  assert.match(app, /state\.navPref = pts\[j\]\.id/);
  assert.match(app, /openPoint\(pts\[j\]\.id, false\)/, "соседняя точка открывается без автозвука");
});

test("плашка «Подойдите к точке»: над «Начать рассказ», та же логика прибытия, не блокирует рассказ, нейтральный текст без GPS", () => {
  const i = s => { const k = html.indexOf(s); assert.ok(k > 0, s); return k; };
  assert.ok(i('id="audio-box"') < i('id="approach"') && i('id="approach"') < i('id="btn-play"'));
  assert.ok(html.includes('id="btn-approach-path"') && html.includes("Показать путь"));
  assert.ok(html.includes("Подойдите к точке и начните рассказ"), "нейтральный текст по умолчанию");
  assert.match(app, /NavCore\.approachState\(state\.pos, p\)/);
  assert.match(app, /Вы на месте — начните рассказ/);
  assert.match(app, /Подойдите к точке · /);
  assert.match(app, /classList\.toggle\("is-here"/);
  const f = app.match(/function updateApproach\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.ok(!/disabled|\.pause\(|startNarration/.test(f), "плашка ничего не блокирует и не включает");
});

test("рефотосъёмка: два шага, жесты, шторка на весь экран, снимок через canvas, режим без камеры; старые режимы сохранены", () => {
  for (const m of ["then", "overlay", "curtain", "now", "rephoto"]) assert.ok(html.includes(`data-mode="${m}"`), m);
  for (const id of ["rp-ui", "rp-hint", "rp-done", "rp-shot", "rp-back", "rp-exit", "rp-label-l", "rp-label-r", "overlay-wrap", "rp-now-img", "btn-rp-nocam"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes("Совмещено ✓") && html.includes("Снимок"));
  assert.match(app, /Двигайте телефон, пока контур не совпадёт со зданием/);
  assert.match(app, /function startRephoto/);
  assert.match(app, /function startRephotoNoCam/);
  assert.match(app, /async function captureRephoto/);
  assert.match(app, /toBlob/);
  assert.match(app, /navigator\.canShare/);
  assert.match(app, /opacity = 0\.35/, "накладка на шаге 1 ~35%");
  assert.match(app, /vp\.bearing == null/, "азимут показывается только если он есть в данных");
  assert.match(app, /state\.camMode = "curtain"/, "после совмещения по умолчанию шторка");
});

test("карусель архивных фото: scroll-snap, стрелки, точки, один слайд — без управления; миниатюр-списка нет", () => {
  for (const id of ["car", "car-track", "car-prev", "car-next", "car-dots", "hero-count"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('id="thumbs"'), "список миниатюр убран");
  assert.ok(html.indexOf('id="car"') > html.indexOf('id="hero"') && html.indexOf('id="car"') < html.indexOf('id="player"'), "карусель в верхней рамке над плеером");
  assert.ok(html.indexOf('id="overlay-bar"') < html.indexOf('id="hero"'), "блок накладки остаётся сверху");
  const css = read("css/style.css");
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /\.car\.single \.car-arrow, \.car\.single \.car-dots \{ display:none; \}/);
  assert.match(css, /\.hero\.cam-on \.car/);
  assert.match(app, /function buildCarousel/);
  assert.match(app, /classList\.toggle\("single", n < 2\)/);
  assert.match(app, /openLightboxForCurrent\(ph\.src\)/, "тап по слайду открывает фото на весь экран");
});

test("первый кадр точки: современное фото + шторка со старым, открытая пополам; без камеры; шторка тянется пальцем", () => {
  assert.match(app, /function buildSlides/);
  assert.match(app, /kind: i === 0 && ph\.now \? "cmp" : "old"/, "первый слайд — пара «тогда/сейчас»");
  assert.match(app, /setCmpOn\(s, 50\)|setCmpOn\(slide, 50\)/, "по умолчанию шторка открыта на 50%");
  assert.match(app, /touch|pointerdown/);
  assert.match(app, /class="cmp-handle" role="slider"/);
  assert.match(app, /cmp-tag cmp-tag-r">Сейчас/, "подпись «Сейчас»");
  assert.match(app, /cmp-tag cmp-tag-l">\$\{esc\(ph\.year\)\}/, "подпись с годом старого фото");
  const css = read("css/style.css");
  assert.match(css, /\.cmp-handle \{[^}]*touch-action:none/, "ручка шторки не отдаёт жест карусели");
  assert.match(css, /clip-path:inset\(0 50% 0 0\)/);
});

test("данные: у каждой точки есть современный кадр; пары и источники с автором, годом, лицензией и ссылкой; файлы на месте", () => {
  const fs = require("node:fs");
  const data = JSON.parse(read("data/points.json"));
  assert.equal(data.points.length, 8);
  for (const p of data.points) {
    const hero = p.photos[0] && p.photos[0].now ? p.photos[0].now : p.heroNow;
    assert.ok(hero, `${p.id}: нет современного кадра`);
    for (const k of ["src", "author", "year", "license", "commons", "note"]) assert.ok(hero[k], `${p.id}: у современного фото нет ${k}`);
    assert.match(hero.license, /CC BY|CC0|Public domain|общественное/i, `${p.id}: лицензия`);
    assert.ok(fs.existsSync(hero.src), `${p.id}: нет файла ${hero.src}`);
    if (!p.photos[0].now) assert.ok(p.heroNow.missingThen, `${p.id}: нет честной пометки, что старого снимка нет`);
    for (const ph of p.photos) {
      for (const k of ["title", "year", "author", "license", "rights", "commons"]) assert.ok(ph[k], `${p.id}: у старого фото нет ${k}`);
      if (!/^https?:/.test(ph.src)) assert.ok(fs.existsSync(ph.src), `${p.id}: нет файла ${ph.src}`);
    }
  }
  const rights = read("RIGHTS.md");
  for (const f of ["zil-facade-lawn-2023", "zil-bay-2023", "zil-park-2023", "vostochnaya-wall-2010", "solevaya-street-2008", "bakarev-1805-east"]) assert.ok(rights.includes(f), `RIGHTS.md: ${f}`);
});

test("аудит фото: снимки Старого Симонова не в первом кадре, ворота — не у Дуло, сад — не у Кузнечной", () => {
  const data = JSON.parse(read("data/points.json"));
  const by = id => data.points.find(p => p.id === id);
  assert.ok(!/staroe-simonovo/.test(by("osnovanie").photos[0].src), "первый кадр точки 1 — монастырь, а не храм в Старом Симонове");
  assert.ok(by("osnovanie").photos.slice(-2).every(p => /staroe-simonovo/.test(p.src)), "храм в конце карусели с пометкой «в 400 м отсюда»");
  assert.ok(!by("dulo").photos.some(p => /ostroumov-1893-0[78]|nisevin|Nisevin|%D0%9D%D0%B8%D1%81%D0%B5%D0%B2%D0%B8%D0%BD/i.test(p.src)), "западные ворота — не на точке Дуло");
  assert.ok(!by("kuznechnaya-stena").photos.some(p => /03a-sad/.test(p.src)), "сад — не на точке Кузнечной");
  assert.ok(!by("tikhvin").photos.some(p => /view-from-belltower/.test(p.src)), "вид с колокольни — не на точке трапезной");
});

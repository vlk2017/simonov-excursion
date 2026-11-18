/* Статическая проверка экскурсии «Ордынка»: DOM id, файлы, источники, права, голос, изоляция от Симонова. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const exists = f => fs.existsSync(path.join(root, f));
const html = read("index.html");
const app = read("js/app.js");
const sw = read("sw.js");
const css = read("css/style.css");
const data = JSON.parse(read("data/points.json"));
const pts = data.points;

test("все #id из app.js есть в index.html, id уникальны", () => {
  const htmlIds = [...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]);
  const used = new Set([...app.matchAll(/\$\$?\("#([\w-]+)/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(id => !htmlIds.includes(id)), []);
  assert.deepEqual(htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i), []);
});

test("скрипты подключены, nav-core раньше app; service worker кэширует все CORE-файлы", () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  assert.deepEqual(scripts, ["js/nav-core.js", "js/app.js"]);
  const core = JSON.parse(sw.match(/const CORE = (\[.*?\]);/s)[1]);
  assert.ok(core.includes("js/nav-core.js"));
  core.filter(f => f !== "./").forEach(f => assert.ok(exists(f), f));
  for (const m of html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)) assert.ok(exists(m[1]), m[1]);
});

test("изоляция от Симонова: свой кэш, свои ключи localStorage, чистка только своих кэшей", () => {
  assert.match(sw, /const CACHE = "ordynka-v\d+"/);
  assert.match(sw, /startsWith\("ordynka-"\)/);
  assert.ok(!/simonov-v\d/.test(sw), "кэш Симонова не трогаем");
  const keys = [...app.matchAll(/ls(?:Get|Set|Del)\("([\w-]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 3);
  keys.forEach(k => assert.ok(k.startsWith("ordynka-"), "ключ localStorage без префикса ordynka-: " + k));
  assert.ok(!/Симонов монастырь|simonov-refoto/.test(app), "в app.js остались подписи Симонова");
});

test("локальные ресурсы из points.json существуют", () => {
  const missing = [];
  const walk = o => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") Object.values(o).forEach(v => {
      if (typeof v === "string") { if (/^(img|audio|scripts|tts)\//.test(v) && !exists(v)) missing.push(v); } else walk(v);
    });
  };
  walk(data);
  assert.deepEqual(missing, []);
  for (const p of pts) for (const x of [p.heroNow, p.nowContext].concat(p.photos.map(ph => ph.now)).filter(Boolean)) {
    assert.ok(exists(x.src), x.src);
    assert.ok(exists(x.src.replace(/^img\/now\/(.+)\.jpg$/, "img/thumbs/$1-now.jpg")), "нет миниатюры " + x.src);
  }
  for (const p of pts) for (const ph of p.photos) {
    const th = ph.src.replace(/^img\/then\//, "img/thumbs/").replace(/^img\/now\/(.+)\.jpg$/, "img/thumbs/$1-now.jpg");
    assert.ok(exists(th), "нет миниатюры " + th);
  }
});

test("points.json: 8 точек, номера, координаты из OpenStreetMap с узлом-источником", () => {
  assert.equal(pts.length, 8);
  assert.deepEqual(pts.map(p => p.num), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(pts.map(p => p.id)).size, 8);
  const [cLat, cLon] = data.mapCenter;
  for (const p of pts) {
    assert.ok(Math.abs(p.lat - cLat) < 0.0015 && Math.abs(p.lon - cLon) < 0.0025, `${p.id} вне ~150 м от центра`);
    assert.equal(p.coordSource.source, "OpenStreetMap");
    assert.match(p.coordSource.node, /^\d+$/);
    assert.ok(p.coordSource.url.endsWith(p.coordSource.node));
    assert.ok(p.title && p.script && p.summary && p.dir);
  }
});

test("у каждой точки: проверяемые источники, сайт-источники по ссылкам, оговорки и безопасный подход", () => {
  for (const p of pts) {
    const s = p.scene;
    assert.ok(s && s.sources.length >= 2, p.id + ": мало источников");
    s.sources.forEach(x => assert.match(x.url, /^https:\/\//));
    ["where", "look", "notice", "then", "confidence"].forEach(k => assert.ok(s[k] && s[k].length > 20, `${p.id}.${k}`));
  }
  const crossing = pts.map(p => p.scene.where).join(" ");
  assert.match(crossing, /пешеходному переходу/, "про переход улицы по переходу сказано");
  assert.ok(!/через дорогу/.test(crossing));
});

test("права на фото: у каждого автор, год, лицензия, карточка Викисклада; лицензия свободная", () => {
  const free = /^(Общественное достояние|CC BY(-SA)? [\d.]+|Free Art License)$/;
  let n = 0;
  for (const p of pts) for (const ph of p.photos.concat(p.photos.filter(x => x.now).map(x => x.now), p.heroNow ? [p.heroNow] : [])) {
    n++;
    assert.ok(ph.author && ph.year && ph.license, `${p.id}: нет автора, года или лицензии`);
    assert.match(ph.license, free, `${p.id}: лицензия «${ph.license}» не из списка свободных`);
    assert.match(ph.commons, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
  assert.ok(n >= 16);
  for (const p of pts) if (p.nowContext) {
    assert.match(p.nowContext.license, free);
    assert.match(p.nowContext.commons, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
  assert.ok(pts[7].photos[0].modern, "современный снимок дома Ахматовой помечен как современный");
});

test("первый кадр каждой точки: современное фото со шторкой старого, либо честная плашка без шторки", () => {
  for (const p of pts) {
    const ph0 = p.photos[0];
    if (ph0.now) {
      assert.ok(!ph0.modern && !p.heroNow, p.id + ": шторка и плашка вместе");
      assert.ok(ph0.now.src && ph0.now.year && ph0.now.author && ph0.now.license && ph0.now.note, p.id + ": у современного кадра нет подписи");
    } else {
      assert.ok(p.heroNow && p.heroNow.src && p.heroNow.missingThen, p.id + ": нет ни пары, ни честной плашки");
      assert.equal(p.id, "akhmatova", "плашка без шторки допустима только там, где старого снимка нет");
    }
    for (const f of [ph0.focal, ph0.now && ph0.now.focal, p.heroNow && p.heroNow.focal].filter(Boolean)) {
      assert.ok(f.x >= 0 && f.x <= 100 && f.y >= 0 && f.y <= 100 && f.z >= 1 && f.z <= 3, p.id + ": focal вне допустимого");
    }
    assert.ok(!p.photos.some(x => x.align), p.id + ": остался устаревший align");
  }
  assert.ok(!html.includes('id="compare"'), "старый блок #compare убран, шторка внутри карусели");
  for (const re of [/cmp-handle/, /touch-action:\s*none/]) assert.match(css, re);
  assert.match(app, /function focalStyle/);
  assert.match(app, /lsGet\("ordynka-offline"\) === "v2"/);
});

test("видео: водяных превью нет, у точки 7 карточка со ссылками и честным пояснением", () => {
  const films = pts.filter(p => p.archivalFilm);
  assert.equal(films.length, 1);
  assert.equal(films[0].id, "xx-vek");
  const f = films[0].archivalFilm;
  assert.ok(f.sources.length >= 1 && f.description.includes("водяные знаки не убираем"));
  assert.ok(!/<iframe|<video[^>]*src/.test(JSON.stringify(data)), "никаких встроенных превью");
  assert.ok(exists("docs/VIDEO.md"));
});

test("голос: пока нет mp3 — временный голос браузера с подписью; audioLocal только при наличии файла", () => {
  for (const p of pts) {
    if (p.audioLocal) assert.ok(exists(p.audioLocal) && fs.statSync(path.join(root, p.audioLocal)).size > 100_000, p.audioLocal);
    assert.ok(p.ttsScript && exists(p.ttsScript), p.id + ": нет текста озвучки");
    assert.ok(exists(p.script), p.script);
  }
  assert.ok(html.includes('id="tts-note"') && html.includes("Голос Григорий"));
  assert.match(app, /speechSynthesis/);
  assert.match(app, /ru-RU/);
  assert.match(app, /const ttsp = /);
  assert.ok(!/speed|playbackRate-btn|btn-rate/i.test(html), "кнопок скорости нет");
});

test("тексты рассказов: 1,5–3 минуты, без цифр-дат в озвучке, без ударений", () => {
  for (const p of pts) {
    const words = read(p.script).trim().split(/\s+/).length;
    assert.ok(words >= 200 && words <= 480, `${p.id}: ${words} слов`);
    const tts = read(p.ttsScript);
    assert.ok(!/\d/.test(tts), `${p.id}: в тексте озвучки остались цифры`);
    assert.ok(!/\u0301/.test(tts));
  }
});

test("конец рассказа отмечает остановку, следующий сам не включается; плеер сразу под фото", () => {
  const m = app.match(/const onEnded = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(m);
  assert.match(m[0], /markVisited\(id\)/);
  assert.ok(!/startNarration|openPoint/.test(m[0]));
  assert.match(m[0], /nextUnvisitedIndex\(\)/);
  assert.match(app, /ttsp\.addEventListener|for \(const el of \[\$\("#player"\), ttsp\]\)/);
  const iHero = html.indexOf('id="hero"'), iAudio = html.indexOf('id="player"'), iText = html.indexOf('id="script-text"');
  assert.ok(iHero < iAudio && iAudio < iText);
});

test("все возможности Симонова на месте: навигация, плашка, камера, рефото, карусель, офлайн", () => {
  for (const id of ["btn-play", "approach", "btn-approach-path", "pt-nav-top", "pt-nav-bottom", "cam-modes", "cam-curtain", "cam-slider", "rp-ui", "rp-shot", "car", "car-track", "btn-offline-audio", "map"])
    assert.ok(html.includes(`id="${id}"`), id);
  assert.equal(html.split("js-prev").length - 1, 2);
  assert.equal(html.split("js-next").length - 1, 2);
  for (const m of ["then", "overlay", "curtain", "now", "rephoto"]) assert.ok(html.includes(`data-mode="${m}"`), m);
  for (const re of [/function gotoNeighbor/, /NavCore\.approachState\(state\.pos, p\)/, /function startRephoto/, /function buildSlides/, /function downloadAudioOffline/, /costing: "pedestrian"/, /controllerchange/])
    assert.match(app, re);
});

test("ссылки на соседние экскурсии: из Ордынки на Симонова", () => {
  assert.ok(html.includes('href="../"'));
});

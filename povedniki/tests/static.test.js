/* Статическая проверка экскурсии «Храм исповедников в Поведниках»: DOM id, файлы, источники, права, голос, изоляция от Симонова. */
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
  assert.match(sw, /const CACHE = "povedniki-v\d+"/);
  assert.match(sw, /startsWith\("povedniki-"\)/);
  assert.ok(!/simonov-v\d/.test(sw), "кэш Симонова не трогаем");
  const keys = [...app.matchAll(/ls(?:Get|Set|Del)\("([\w-]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 3);
  keys.forEach(k => assert.ok(k.startsWith("povedniki-"), "ключ localStorage без префикса povedniki-: " + k));
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
    assert.ok(Math.abs(p.lat - cLat) < 0.004 && Math.abs(p.lon - cLon) < 0.005, `${p.id} вне ~450 м от центра`);
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

test("права на фото: у каждого автор, год, лицензия или пометка «с указанием источника», карточка-источник и оригинал", () => {
  const free = /^(Общественное достояние|CC BY(-SA)? [\d.]+|Free Art License|CC0 1\.0)$/;
  const attrib = "без свободной лицензии, с указанием источника";
  let n = 0, nAttr = 0;
  for (const p of pts) for (const ph of p.photos.concat(p.photos.filter(x => x.now).map(x => x.now), p.heroNow ? [p.heroNow] : [])) {
    n++;
    assert.ok(ph.author && ph.year && ph.license, `${p.id}: нет автора, года или лицензии`);
    if (ph.license === attrib) {
      nAttr++;
      assert.match(ph.commons, /^https:\/\/(pastvu\.com|sobory\.ru|yandex\.com|berezky\.ru|moskva-volga\.ru|commons\.wikimedia\.org)\//, `${p.id}: карточка-источник`);
      assert.ok(ph.sourceName || ph.archive, `${p.id}: не указан источник`);
    } else {
      assert.match(ph.license, free, `${p.id}: лицензия «${ph.license}» не из списка`);
      assert.match(ph.commons, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  }
  assert.ok(n >= 25 && nAttr >= 15, `снимков ${n}, без свободной лицензии ${nAttr}`);
  const rights = read("RIGHTS.md");
  assert.match(rights, /используется с указанием источника/);
  assert.match(rights, /не убирались, не обрезались и не ретушировались/);
  for (const f of ["data/photo-sources.json", "data/photo-audit.md", "docs/PHOTO_AUDIT.md"]) assert.ok(exists(f), f);
  const reg = JSON.parse(read("data/photo-sources.json"));
  assert.ok(reg.photos.length >= 30 && reg.rejected.length >= 5);
  assert.ok(pts[7].photos[0].modern, "современный снимок храма помечен как современный");
});

test("снимки: каждый файл на месте, у каждого миниатюра; PastVu-снимки помечены wm (плашка не обрезается)", () => {
  for (const p of pts) for (const ph of p.photos.concat(p.photos.filter(x => x.now).map(x => x.now), p.heroNow ? [p.heroNow] : [])) {
    assert.ok(exists(ph.src), `${p.id}: нет файла ${ph.src}`);
    const th = ph.src.replace("img/then/", "img/thumbs/").replace("img/now/", "img/thumbs/").replace(/\.jpg$/, ph.src.includes("img/now/") ? "-now.jpg" : ".jpg");
    assert.ok(exists(th) || exists(ph.src.replace("img/", "img/thumbs/")), `${p.id}: нет миниатюры для ${ph.src}`);
    if (/pastvu\.com/.test(ph.commons || "")) assert.ok(ph.wm, `${p.id}: ${ph.src} без пометки wm`);
  }
  assert.match(css, /\.car-slide\.car-cmp\.wm img/);
});

test("первый кадр точки: шторка тогда—сейчас, либо современное фото с плашкой; блоки накладки включены только там, где есть пара", () => {
  for (const p of pts) {
    const ph0 = p.photos[0];
    if (p.heroNow) {
      assert.ok(p.heroNow.src && p.heroNow.missingThen, p.id + ": у плашки нет пояснения");
      assert.match(p.heroNow.missingThen, /Старого снимка|старого снимка|нет|не нашли|Архивных|архивных/, p.id + ": плашка без пояснения");
    }
    for (const f of [ph0.focal, ph0.now && ph0.now.focal, p.heroNow && p.heroNow.focal].filter(Boolean)) {
      assert.ok(f.x >= 0 && f.x <= 100 && f.y >= 0 && f.y <= 100 && f.z >= 1 && f.z <= 3, p.id + ": focal вне допустимого");
    }
    assert.ok(!p.photos.some(x => x.align), p.id + ": остался устаревший align");
    assert.ok(p.photos.length >= 2 || p.heroNow, p.id + ": мало снимков");
  }
  assert.ok(!html.includes('id="compare"'), "старый блок #compare убран, шторка внутри карусели");
  for (const re of [/cmp-handle/, /touch-action:\s*none/]) assert.match(css, re);
  assert.match(app, /function focalStyle/);
  assert.match(app, /lsGet\("povedniki-offline"\) === "v1"/);
});

test("видео: нет встроенных превью и нет выдуманной хроники; есть docs/VIDEO.md с честным пояснением", () => {
  assert.equal(pts.filter(p => p.archivalFilm).length, 0);
  assert.ok(!/<iframe|<video[^>]*src/.test(JSON.stringify(data)), "никаких встроенных превью");
  assert.ok(exists("docs/VIDEO.md"));
  assert.match(read("docs/VIDEO.md"), /Видео на сайте нет/);
  assert.ok(exists("docs/PHOTO_AUDIT.md"));
});

test("пары «тогда — сейчас»: шторка только там, где есть сопоставимый современный вид; снимки других мест подписаны как контекст", () => {
  const withNow = pts.flatMap(p => p.photos.filter(x => x.now).map(x => [p.id, x]));
  const ids = withNow.map(x => x[0]).sort();
  assert.deepEqual(ids, ["chasovnya", "chiverevo", "chiverevo"], "пары: две в Чиверёве и одна у часовни");
  for (const [id, ph] of withNow) {
    assert.ok(ph.now.src && ph.now.author && ph.now.year && ph.now.license, id + ": подпись современного кадра");
    assert.ok(!ph.modern, id + ": кадр с шторкой не может быть «современным»");
  }
  const ctx = pts.flatMap(p => p.photos.filter(x => x.kind === "context").map(x => [p.id, x]));
  assert.ok(ctx.length >= 2);
  ctx.forEach(([id, x]) => assert.match(x.stand + " " + x.title, /Не Поведники|не Поведники|не из Поведников|не относится|общий|Общий|контекст|другой|олень|Олень|канал|не школа|на снимке нет|Соседн/i, id + ": контекстный снимок без оговорки"));
  assert.ok(pts.find(p => p.id === "chasovnya").photos[0].viewpoint || /ракурс/i.test(pts.find(p => p.id === "chasovnya").photos[0].stand + pts.find(p => p.id === "chasovnya").photos[0].now.note), "у пары часовни сказано про разные ракурсы");
});

test("точки не ближе 26 м друг к другу (радиус 22 м)", () => {
  const d = (a, b) => Math.hypot((a.lat - b.lat) * 111200, (a.lon - b.lon) * 111200 * Math.cos(a.lat * Math.PI / 180));
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    assert.ok(d(pts[i], pts[j]) >= 26, `${pts[i].id} и ${pts[j].id}: ${d(pts[i], pts[j]).toFixed(1)} м`);
});

test("голос: Grigory в HeyGen, локальная копия каждого mp3; запасной голос браузера остаётся", () => {
  assert.equal(data.voice.status, "heygen");
  assert.equal(data.voice.voiceName, "Grigory - Warm & Expressive");
  for (const p of pts) {
    assert.match(p.audio, /^https:\/\/resource2\.heygen\.ai\/text_to_speech\/.+\.mp3$/, p.id);
    assert.ok(p.audioLocal && exists(p.audioLocal) && fs.statSync(path.join(root, p.audioLocal)).size > 100_000, p.audioLocal);
    assert.ok(p.ttsScript && exists(p.ttsScript), p.id + ": нет текста озвучки");
    assert.ok(exists(p.script), p.script);
  }
  assert.equal(new Set(pts.map(p => p.audio)).size, 8);
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

test("ссылки на соседние экскурсии: из Поведников на Симонова, Ордынку и Крутицы", () => {
  assert.ok(html.includes('href="../"') && html.includes('href="../ordynka/"') && html.includes('href="../krutitsy/"'));
});

test("в экскурсии не осталось следов Крутиц", () => {
  for (const [name, s] of [["index.html", html], ["app.js", app], ["sw.js", sw], ["points.json", JSON.stringify(data)], ["style.css", css]])
    assert.ok(!/крутиц|krutitsy|kruticy/i.test(s.replace(/href="\.\.\/krutitsy\/">Крутицкое подворье/, "")), name);
});

test("в экскурсии не осталось следов Ордынки", () => {
  for (const [name, s] of [["index.html", html], ["app.js", app], ["sw.js", sw], ["points.json", JSON.stringify(data)], ["style.css", css]])
    assert.ok(!/ордын|ordynka|скорбя|скорбящ/i.test(s.replace(/href="\.\.\/ordynka\/">Храм на Ордынке/, "")), name);
});

test("кнопка «Как устроена прогулка» без конфликта data-back/onclick; блок накладки скрывается без пар; подсказка про расстояния верна", () => {
  const m = html.match(/<button[^>]*id="btn-about-2"[^>]*>/);
  assert.ok(m && !/data-back|onclick/.test(m[0]), "btn-about-2 не должен одновременно вести назад и на «О прогулке»");
  assert.match(app, /\$\("#btn-about-2"\)\.addEventListener\("click"/);
  assert.match(app, /\$\("#overlay-bar"\)\.classList\.toggle\("hidden", !p\.photos\.some\(ph => ph\.now\)\)/);
  assert.ok(!/20–35 метрах/.test(html), "в подсказке остались расстояния Крутиц");
  assert.match(sw, /povedniki-v3/);
});

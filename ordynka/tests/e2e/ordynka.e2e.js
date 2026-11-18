/* E2E экскурсии «Ордынка» (iPhone 13, 390 px, фейковый GPS, фейковая камера, подменённый speechSynthesis).
   Не входит в npm test. Запуск: из КОРНЯ репозитория `python3 -m http.server 8099`, затем
   `PUPPETEER=/tmp/e2e/node_modules/puppeteer-core CHROME=/usr/bin/google-chrome node ordynka/tests/e2e/ordynka.e2e.js`
   (переменные: SHOT_DIR — куда класть скриншоты). */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const fs = require("fs"), path = require("path");
const points = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/points.json"), "utf8")).points;
const P1 = points[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const ORIGIN = "http://127.0.0.1:8099";
const BASE = ORIGIN + "/ordynka/";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp";
const M = 1 / 111320;
const tap = async (page, sel) => { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center", behavior: "instant" }), sel); await sleep(350); await (await page.$(sel)).tap(); await sleep(350); };
const gone = (page, ms = 15000) => page.waitForFunction(() => true, { timeout: ms });

/* Подмена озвучки: speak() записывает фразы и «читает» их за delay мс; cancel() прерывает чтение с ошибкой canceled, как в Chrome. */
const mockTts = () => {
  window.__spoken = []; window.__delay = 20; let cur = null, timer = null;
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.lang = ""; this.voice = null; this.rate = 1; };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speaking: false, pending: false,
    getVoices: () => [{ lang: "ru-RU", name: "Mock RU", localService: true }],
    speak(u) { if (u.text === "") return; cur = u; this.speaking = true; window.__spoken.push({ text: u.text, lang: u.lang, ru: !!(u.voice && /^ru/.test(u.voice.lang)) });
      timer = setTimeout(() => { this.speaking = false; const c = cur; cur = null; c.onend && c.onend({}); }, window.__delay); },
    cancel() { clearTimeout(timer); this.speaking = false; const c = cur; cur = null; if (c && c.onerror) c.onerror({ error: "canceled" }); },
  } });
};

const info = page => page.evaluate(() => { const g = s => document.querySelector(s); const vis = s => { const e = g(s); return !!e && getComputedStyle(e).display !== "none"; };
  const pl = narr.tts ? ttsp : g("#player");
  return { id: state.currentId, screen: g(".screen.active").id, label: g("#point-num-label") && g("#point-num-label").textContent, title: g("#point-title").textContent, play: g("#btn-play").textContent,
    paused: pl.paused, ended: pl.ended, tts: narr.tts, ttsNote: vis("#tts-note"), player: vis("#player"), visited: Object.keys(state.visited).length, sw: document.documentElement.scrollWidth,
    spoken: window.__spoken.length, camera: state.cameraOn, scroll: Math.round(scrollY) }; });

async function open(browser, { geo, offline } = {}) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(ORIGIN, geo ? ["geolocation", "camera"] : ["camera"]);
  const page = await ctx.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
  const errors = [], req404 = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(ORIGIN)) req404.push(r.status() + " " + r.url()); });
  await page.setRequestInterception(true);
  page.on("request", r => /tile\.openstreetmap\.org|valhalla1|heygen|fonts\.g|unpkg/.test(r.url()) ? r.abort() : r.continue());
  if (geo) await page.setGeolocation(geo);
  await page.evaluateOnNewDocument(mockTts);
  await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem("__init")) { localStorage.clear(); sessionStorage.setItem("__init", "1"); } });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  return { ctx, page, errors, req404 };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });

  /* ---- сценарий 1: обложка, точка, временный голос ---- */
  {
    const { ctx, page, errors, req404 } = await open(browser, { geo: { latitude: P1.lat + 4 * M, longitude: P1.lon, accuracy: 8 } });
    const cover = await page.evaluate(() => ({ h1: document.querySelector("#cover-title").innerText.replace(/\s+/g, " "), place: document.querySelector("#cover-place").textContent, marquee: document.querySelector(".date-marquee").innerText, title: document.title, sw: document.documentElement.scrollWidth }));
    ok("Обложка: «Скорбященский храм», адрес, даты Ордынки, нет Симонова", /Скорбященский храм/.test(cover.h1) && /Ордынка, 20/.test(cover.place) && /1948/.test(cover.marquee) && !/Симонов|монастыр/.test(cover.h1 + cover.place + cover.marquee + cover.title), JSON.stringify(cover).slice(0, 300));
    ok("Обложка 390 px без горизонтального скролла", cover.sw <= 391, "sw=" + cover.sw);
    await sleep(6000);   // тост про офлайн уходит
    await page.screenshot({ path: path.join(SHOT_DIR, "ordynka_cover_390.png") });
    await page.evaluate(() => { window.__delay = 400; });
    await tap(page, "#btn-start");
    await sleep(1500);
    let s = await info(page);
    ok("«Начать»: открыта точка 1 и рассказ сам заиграл (временный голос читает)", s.id === "vorota" && s.label === "Точка 1 из 8" && !s.paused && s.spoken >= 1 && s.play === "Пауза", JSON.stringify(s));
    ok("Временный голос: подпись видна, <audio> скрыт", s.tts && s.ttsNote && !s.player);
    await sleep(3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    const approach = await page.evaluate(() => ({ title: document.querySelector("#approach-title").textContent, cls: document.querySelector("#approach").className }));
    ok("Плашка «Вы на месте» у точки 1 с фейковым GPS в 4 м", /Вы на месте/.test(approach.title) && /here/.test(approach.cls), JSON.stringify(approach));
    await page.screenshot({ path: path.join(SHOT_DIR, "ordynka_card_390.png") });
    // пауза и продолжение
    await tap(page, "#btn-play");
    s = await info(page);
    ok("Пауза: чтение остановлено, кнопка «Продолжить»", s.paused && !s.ended && s.play === "Продолжить", s.play);
    const n1 = s.spoken;
    await sleep(1000);
    ok("На паузе новые фразы не читаются", (await info(page)).spoken === n1);
    await tap(page, "#btn-play");
    await sleep(500);
    s = await info(page);
    ok("Продолжить: чтение идёт, кнопка «Пауза»", !s.paused && s.play === "Пауза" && s.spoken > n1, s.play);
    // слушаем до конца
    await page.evaluate(() => { window.__delay = 5; });
    await page.waitForFunction(() => ttsp.ended, { timeout: 40000 }).catch(() => {});
    await sleep(500);
    s = await info(page);
    const spoken = await page.evaluate(() => window.__spoken);
    ok("Озвучка: фразы на ru-RU с русским голосом, прочитан весь текст", spoken.length > 8 && spoken.every(x => x.lang === "ru-RU" && x.ru), "фраз: " + spoken.length);
    ok("Конец рассказа: остановка 1 отмечена сама, кнопка «Повторить рассказ»", s.ended && s.visited === 1 && s.play === "Повторить рассказ", JSON.stringify({ ended: s.ended, v: s.visited, play: s.play }));
    const before = s.spoken;
    await sleep(1500);
    s = await info(page);
    ok("Следующий рассказ сам не включается; остаёмся на точке 1", s.spoken === before && s.id === "vorota");
    ok("Нет JS-ошибок и 404 на файлах сайта", errors.length === 0 && req404.length === 0, errors.concat(req404).join(" | "));
    // переход вперёд во время чтения: чтение останавливается, следующий сам не включается
    await page.evaluate(() => { window.__delay = 400; });
    await tap(page, "#btn-play");
    await sleep(700);
    ok("«Повторить рассказ» запускает чтение заново", !(await info(page)).paused);
    await tap(page, "#pt-nav-top .js-next");
    s = await info(page);
    ok("«Следующая точка»: точка 2, чтение остановлено, прокрутка вверх", s.label === "Точка 2 из 8" && s.paused && s.scroll < 5, JSON.stringify(s));
    const nn = s.spoken; await sleep(1200);
    ok("Точка 2: звук сам не включился", (await info(page)).spoken === nn);
    await tap(page, "#pt-nav-top .js-prev");
    s = await info(page);
    ok("«Предыдущая»: снова точка 1, остановка осталась отмеченной", s.label === "Точка 1 из 8" && s.visited === 1);
    // карусель точки 1
    const car = await page.evaluate(() => ({ slides: document.querySelectorAll("#car-track > *").length, dots: document.querySelectorAll("#car-dots > *").length, single: document.querySelector("#car").classList.contains("single"), cmp: getComputedStyle(document.querySelector("#compare")).display !== "none" }));
    ok("Карусель точки 1: 2 фото; пара «тогда — сейчас» есть", car.slides === 2 && !car.single && car.cmp, JSON.stringify(car));
    // камера
    await tap(page, "#btn-camera");
    await page.waitForFunction(() => state.cameraOn, { timeout: 10000 }).catch(() => {});
    s = await info(page);
    ok("Камера включается (фейковая), режимы доступны", s.camera && await page.evaluate(() => document.querySelectorAll("#cam-modes button").length >= 4));
    for (const m of ["overlay", "curtain", "now", "then"]) { await page.evaluate(m => document.querySelector(`#cam-modes [data-mode=${m}]`).click(), m); await sleep(150); }
    ok("Режимы камеры переключаются без ошибок", errors.length === 0, errors.join("|"));
    await page.evaluate(() => document.querySelector("#cam-modes [data-mode=rephoto]").click());
    await sleep(600);
    const rp = await page.evaluate(() => ({ on: !!(state.rephoto && state.rephoto.on) || document.body.classList.contains("rp-lock") }));
    ok("Рефотосъёмка запускается", rp.on, JSON.stringify(rp));
    await page.evaluate(() => document.querySelector("#rp-exit").click());
    await sleep(400);
    ok("Выход из рефото, ошибок нет", errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  /* ---- сценарий 2: все 8 точек открываются, фото, права, 390 px ---- */
  {
    const { ctx, page, errors, req404 } = await open(browser);
    await tap(page, "#btn-start");
    await sleep(800);
    for (let n = 1; n <= 8; n++) {
      await page.waitForFunction(() => { const i = document.querySelector("#car-track img"); return i && i.complete && i.naturalWidth > 100; }, { timeout: 6000 }).catch(() => {});
      const d = await page.evaluate(() => { const g = s => document.querySelector(s); return { label: g("#point-num-label").textContent, title: g("#point-title").textContent, text: g("#script-text").textContent.length, scene: g("#scene-where").textContent.length,
        meta: g("#photo-meta").innerText, imgOk: !!document.querySelector("#car-track img") && document.querySelector("#car-track img").complete && document.querySelector("#car-track img").naturalWidth > 100, sw: document.documentElement.scrollWidth, src: g("#scene-sources").querySelectorAll("a").length,
        film: getComputedStyle(g("#archival-film")).display !== "none" }; });
      ok(`Точка ${n}: «${d.title}» — текст, «где встать», источники, права, фото, без горизонтального скролла`, d.label === `Точка ${n} из 8` && d.text > 800 && d.scene > 40 && d.src >= 2 && /Викисклад/.test(d.meta) && /(Общественное достояние|CC BY|Free Art)/.test(d.meta) && d.imgOk && d.sw <= 391, JSON.stringify({ t: d.text, s: d.scene, src: d.src, img: d.imgOk, sw: d.sw }));
      if (n === 7) ok("Точка 7: карточка «видео нет, вот ссылки», без встроенных превью", d.film && await page.evaluate(() => !document.querySelector("#archival-film iframe, #archival-film video") && document.querySelectorAll("#film-links a").length >= 2));
      if (n === 8) ok("Точка 8: современное фото помечено «Современное фото»", /Современное фото/.test(d.meta), d.meta.slice(0, 80));
      if (n < 8) await tap(page, "#pt-nav-top .js-next");
    }
    ok("Все 8 точек: нет JS-ошибок и 404", errors.length === 0 && req404.length === 0, errors.concat(req404).join(" | "));
    await ctx.close();
  }

  /* ---- сценарий 3: офлайн и изоляция кэшей ---- */
  {
    const { ctx, page, errors } = await open(browser);
    await tap(page, "#btn-start");
    await page.waitForFunction(() => navigator.serviceWorker.controller || false, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => caches.open("simonov-v13").then(c => c.put("/marker", new Response("x"))));   // «кэш Симонова» не должен пропасть
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(3000);   // предзагрузка текстов и фото
    const c = await page.evaluate(async () => ({ keys: await caches.keys(), ls: Object.keys(localStorage), reg: (await navigator.serviceWorker.getRegistrations()).map(r => r.scope), ordSize: (await (await caches.open("ordynka-v1")).keys()).length }));
    ok("Свой service worker со scope /ordynka/ и кэш ordynka-v1; кэш Симонова не удалён", c.keys.includes("ordynka-v1") && c.keys.includes("simonov-v13") && c.reg.every(s => /\/ordynka\/$/.test(s)), JSON.stringify(c).slice(0, 300));
    ok("Ключи localStorage с префиксом ordynka-", c.ls.every(k => k.startsWith("ordynka-")), c.ls.join(","));
    ok("Предзагружены тексты, озвучка и фото (≥ 40 файлов)", c.ordSize >= 40, "файлов в кэше: " + c.ordSize);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(1500);
    await tap(page, "#btn-start");
    await sleep(1000);
    const off = await page.evaluate(() => ({ t: document.querySelector("#point-title").textContent, text: document.querySelector("#script-text").textContent.length, img: [...document.querySelectorAll("#car-track img")].some(i => i.complete && i.naturalWidth > 100) }));
    ok("Офлайн: страница, текст и фото точки 1 открываются", off.t.length > 3 && off.text > 800 && off.img, JSON.stringify(off));
    await page.evaluate(() => { window.__delay = 5; });
    await page.waitForFunction(() => ttsp.ended || ttsp.paused, { timeout: 30000 }).catch(() => {});
    if (!await page.evaluate(() => ttsp.ended)) { await tap(page, "#btn-play"); await page.waitForFunction(() => ttsp.ended, { timeout: 30000 }).catch(() => {}); }
    ok("Офлайн: временный голос читает рассказ до конца", await page.evaluate(() => ttsp.ended));
    await page.setOfflineMode(false);
    ok("Офлайн-сценарий без JS-ошибок", errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  /* ---- сценарий 4: точка далеко — плашка и подсказка пути ---- */
  {
    const { ctx, page } = await open(browser, { geo: { latitude: P1.lat - 120 * M, longitude: P1.lon, accuracy: 8 } });
    await tap(page, "#btn-start");
    await page.waitForFunction(() => /Подойдите к точке · /.test(document.querySelector("#approach-title").textContent), { timeout: 12000 }).catch(() => {});
    const t = await page.evaluate(() => document.querySelector("#approach-title").textContent);
    ok("Вдали от точки: «Подойдите к точке · ~120 м»", /^Подойдите к точке · 1[12]\d м$/.test(t), t);
    await ctx.close();
  }

  await browser.close();
  let fail = 0;
  for (const [st, n, x] of results) { if (st === "FAIL") fail++; console.log(st, n, st === "FAIL" ? "  → " + x : ""); }
  console.log(`\nИтого: ${results.length - fail} из ${results.length}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

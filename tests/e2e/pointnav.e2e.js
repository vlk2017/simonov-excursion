/* E2E кнопок перехода между точками (iPhone 13, 390 px, фейковая камера). Не входит в npm test.
   Запуск: из корня `python3 -m http.server 8099`, затем `node tests/e2e/pointnav.e2e.js` (PUPPETEER, CHROME, SHOT) */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const BASE = "http://127.0.0.1:8099/";
const tap = async (page, sel) => { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center", behavior: "instant" }), sel); await sleep(400); await (await page.$(sel)).tap(); await sleep(350); };
const info = page => page.evaluate(() => { const a = document.querySelector("#player"); const vis = s => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return { show: getComputedStyle(e).display !== "none", top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), h: Math.round(b.height) }; };
  return { id: state.currentId, label: document.querySelector("#point-num-label").textContent, title: document.querySelector("#point-title").textContent, scroll: Math.round(scrollY), paused: a.paused, t: a.currentTime, camera: state.cameraOn, navTitle: document.querySelector("#nav-title").textContent, navStep: document.querySelector("#nav-step").textContent,
    prev: vis("#pt-nav-top .js-prev"), next: vis("#pt-nav-top .js-next"), nextTxt: document.querySelector("#pt-nav-top .js-next").innerText.replace(/\s+/g, " "), nextPrimary: document.querySelector("#pt-nav-top .js-next").classList.contains("is-primary"), prevTxt: document.querySelector("#pt-nav-top .js-prev").innerText.replace(/\s+/g, " "),
    audioBox: vis("#audio-box"), bar: vis("#pt-nav-top"), bottom: vis("#pt-nav-bottom"), vh: innerHeight, screen: document.querySelector(".screen.active").id, sw: document.documentElement.scrollWidth }; });

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", r => /tile\.openstreetmap\.org|valhalla1|heygen/.test(r.url()) ? r.abort() : r.continue());
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: "networkidle2" });
  // «Начать»: открывается точка 1 и играет звук
  await tap(page, "#btn-start");
  await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3; }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(4200);   // тост уйдёт
  let s = await info(page);
  ok("Точка 1: «Предыдущая» скрыта, «Следующая точка →» с названием точки 2", !s.prev.show && s.next.show && /Следующая точка/.test(s.nextTxt) && /^.*2\. /.test(s.nextTxt), s.nextTxt);
  ok("Кнопки сразу под плеером и видны на первом экране 390×844 без прокрутки", s.bar.top >= s.audioBox.bottom - 2 && s.bar.top - s.audioBox.bottom < 30 && s.next.bottom <= s.vh && s.next.h >= 56, JSON.stringify({ bar: s.bar, box: s.audioBox, vh: s.vh }));
  ok("Нижний дубль есть и ниже верхней панели", s.bottom.show && s.bottom.top > s.bar.bottom + 300);
  ok("Звук играет на точке 1, нет горизонтального скролла", !s.paused && s.sw <= 391);
  await page.screenshot({ path: process.env.SHOT || "/tmp/nav_buttons_390.png" });
  // включаем камеру, затем «Следующая»
  await tap(page, "#btn-camera");
  await page.waitForFunction(() => state.cameraOn, { timeout: 10000 }).catch(() => {});
  s = await info(page);
  ok("Камера включена перед переходом", s.camera);
  const seen = [s.id];
  await tap(page, "#pt-nav-top .js-next");
  s = await info(page);
  seen.push(s.id);
  ok("→ точка 2: звук остановлен, камера выключена, прокрутка вверх, навигация на точку 2, звук сам не включился", s.label === "Точка 2 из 8" && s.paused && !s.camera && s.scroll < 5 && s.navStep === "02" && s.prev.show, JSON.stringify(s).slice(0, 400));
  ok("Звук не включился сам и спустя секунду", await (async () => { await sleep(1000); return (await info(page)).paused; })());
  // листаем вперёд до 8, не включая звук, но с прокруткой вниз и нижней кнопкой
  for (let n = 3; n <= 8; n++) {
    await tap(page, n % 2 ? "#pt-nav-bottom .js-next" : "#pt-nav-top .js-next");
    s = await info(page);
    seen.push(s.id);
    ok(`→ точка ${n}`, s.label === `Точка ${n} из 8` && s.scroll < 5 && s.paused && s.navStep === String(n).padStart(2, "0"), s.label + " " + s.navStep + " scroll=" + s.scroll);
  }
  ok("Все 8 точек разные", new Set(seen).size === 8);
  ok("На последней точке «Следующая» превратилась в «Завершить прогулку»", /Завершить прогулку/.test(s.nextTxt), s.nextTxt);
  // назад
  await tap(page, "#pt-nav-top .js-prev");
  s = await info(page);
  ok("← назад: точка 7, навигация на 7", s.label === "Точка 7 из 8" && s.navStep === "07", s.label + s.navStep);
  // звук на точке 7 и «Предыдущая»: звук должен остановиться
  await tap(page, "#btn-play");
  await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3; }, { timeout: 15000 }).catch(() => {});
  s = await info(page);
  ok("«Начать рассказ» запускает звук", !s.paused);
  await tap(page, "#pt-nav-top .js-prev");
  s = await info(page);
  ok("«Предыдущая» останавливает звук", s.label === "Точка 6 из 8" && s.paused, s.label);
  // «Следующая» выделяется primary после конца рассказа
  await page.evaluate(() => { const a = document.querySelector("#player"); a.muted = true; a.playbackRate = 16; });
  await tap(page, "#btn-play");
  await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.duration > 0 && a.buffered.length && a.buffered.end(a.buffered.length - 1) >= a.duration - 0.5; }, { timeout: 30000 }).catch(() => {});   // дожидаемся полной буферизации: сервер без Range не умеет перемотку
  await page.evaluate(() => { const a = document.querySelector("#player"); a.playbackRate = 16; if (a.seekable.length) a.currentTime = Math.max(0, a.duration - 1); });   // приложение сбрасывает скорость на loadedmetadata, поэтому ставим 16× уже после старта
  await page.waitForFunction(() => document.querySelector("#player").ended, { timeout: 45000 }).catch(() => {});
  await sleep(500);
  s = await info(page);
  s.dbg = await page.evaluate(() => { const a = document.querySelector("#player"); return { ended: a.ended, paused: a.paused, t: a.currentTime, d: a.duration, rate: a.playbackRate, src: a.currentSrc.slice(-30), err: a.error && a.error.code, rs: a.readyState, seekable: a.seekable.length && a.seekable.end(0) }; }); s.ended = s.dbg.ended;
  ok("После конца рассказа «Следующая точка →» выделена (primary)", s.nextPrimary, JSON.stringify({ dbg: s.dbg, primary: s.nextPrimary }));
  await tap(page, "#pt-nav-top .js-next");
  s = await info(page);
  ok("После перехода выделение снято (новая точка)", s.label === "Точка 7 из 8" && !s.nextPrimary);
  await tap(page, "#pt-nav-top .js-next");   // 8
  await tap(page, "#pt-nav-top .js-next");   // завершить
  s = await info(page);
  ok("«Завершить прогулку» ведёт на экран маршрута", s.screen === "screen-tour", s.screen);
  ok("Нет ошибок страницы", errors.length === 0, errors.join("|"));
  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.error("E2E crashed", e); process.exit(1); });

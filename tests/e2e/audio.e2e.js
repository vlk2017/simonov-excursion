/* Браузерный E2E рассказа (эмуляция iPhone 13, 390 px): плеер под фото, «Начать» → звук, ended → остановка отмечена,
   сбой/зависание внешней ссылки → играет запасной локальный файл. Не входит в npm test.
   Запуск: из корня репозитория `python3 -m http.server 8099`, затем `node tests/e2e/audio.e2e.js`
   (нужны puppeteer-core и Chrome; CHROME=путь, SHOT=путь к скриншоту). Нужен выход в интернет для внешних ссылок HeyGen. */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const BASE = "http://127.0.0.1:8099/";
const SHOT = process.env.SHOT || "/tmp/stop_card_390.png";

async function session(browser, extMode) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  await page.setRequestInterception(true);
  page.on("request", req => {
    const u = req.url();
    if (/tile\.openstreetmap\.org/.test(u)) return req.abort();
    if (/heygen\.ai/.test(u)) {
      if (extMode === "fail") return req.respond({ status: 404, body: "nope" });
      if (extMode === "hang") return;   // не отвечаем
    }
    req.continue();
  });
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: "networkidle2" });
  return { page, ctx, errors };
}
const tap = async (page, sel) => { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center" }), sel); await sleep(150); const h = await page.$(sel); await h.tap ? h.tap() : h.click(); };
const state = page => page.evaluate(() => { const a = document.querySelector("#player"); return { paused: a.paused, t: a.currentTime, src: a.currentSrc, ready: a.readyState, err: a.error && a.error.code }; });

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });

  // 1. Внешняя ссылка жива: «Начать» сразу включает звук с HeyGen
  {
    const { page, ctx, errors } = await session(browser, "pass");
    await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
    await tap(page, "#btn-start");
    await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3; }, { timeout: 15000 }).catch(() => {});
    const s = await state(page);
    ok("«Начать» → звук играет (paused=false, currentTime>0)", !s.paused && s.t > 0.3, JSON.stringify(s));
    ok("Играет основной внешний источник HeyGen", /heygen\.ai/.test(s.src), s.src);
    ok("Открыта карточка остановки 1", await page.evaluate(() => document.querySelector(".screen.active").id === "screen-point" && /Точка 1/.test(document.querySelector("#point-num-label").textContent)));
    const lay = await page.evaluate(() => { const r = id => document.querySelector(id).getBoundingClientRect(); const hero = r("#hero"), box = r("#audio-box"), th = r("#photo-caption"), st = r("#stand"), btn = r("#btn-play"), au = r("#player"); return { heroBottom: Math.round(hero.bottom + scrollY), boxTop: Math.round(box.top + scrollY), boxBottom: Math.round(box.bottom + scrollY), thumbsTop: Math.round(th.top + scrollY), standTop: Math.round(st.top + scrollY), btnH: Math.round(btn.height), btnW: Math.round(btn.width), audioH: Math.round(au.height), vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
    ok("Плеер сразу под фото (до подписи, «где стоял фотограф», текста)", lay.boxTop >= lay.heroBottom && lay.boxTop - lay.heroBottom < 40 && lay.boxBottom <= lay.thumbsTop + 2 && lay.boxBottom <= lay.standTop, JSON.stringify(lay));
    ok("Кнопка крупная (≥56 px высота, почти на всю ширину), виден системный плеер ≥44 px", lay.btnH >= 56 && lay.btnW > lay.vw - 70 && lay.audioH >= 44, JSON.stringify(lay));
    ok("Нет горизонтального скролла на 390 px", lay.vw === 390 && lay.sw <= 391, JSON.stringify({ vw: lay.vw, sw: lay.sw }));
    ok("Плеер целиком виден на первом экране без прокрутки", lay.boxBottom <= lay.vh, JSON.stringify(lay));
    ok("Подпись кнопки «Пауза» во время воспроизведения", (await page.$eval("#btn-play", b => b.textContent.trim())) === "Пауза");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.querySelector("#toast").classList.contains("show"), { timeout: 8000 }).catch(() => {});
    await sleep(300);
    await page.screenshot({ path: SHOT });
    // 2. ended → остановка отмечена, следующая не включается сама
    await page.evaluate(() => { const a = document.querySelector("#player"); a.currentTime = Math.max(0, a.duration - 0.4); });
    await page.waitForFunction(() => document.querySelector("#player").ended, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const e = await page.evaluate(() => ({ ended: document.querySelector("#player").ended, visited: Object.keys(state.visited), next: state.data.points[nextUnvisitedIndex()].num, navStep: document.querySelector("#nav-step").textContent, toast: document.querySelector("#toast").textContent, paused: document.querySelector("#player").paused, btn: document.querySelector("#btn-play").textContent.trim(), done: document.querySelector("#btn-done").textContent }));
    ok("Конец рассказа (HeyGen): остановка 1 отмечена, навигация на 2", e.ended && e.visited.length === 1 && e.next === 2 && e.navStep === "02", JSON.stringify(e));
    ok("После конца следующий рассказ сам не включается; кнопка «Повторить рассказ»", e.paused && /Повторить/.test(e.btn), JSON.stringify(e));
    // 3. следующая точка: звук только по «Начать рассказ»
    await page.evaluate(() => document.querySelector("#btn-back-point").click());
    await page.evaluate(() => document.querySelector("#nav-open").click());
    await sleep(1500);
    const n = await state(page);
    ok("«Рассказ об остановке» (явное нажатие) включает рассказ точки 2", !n.paused || n.t > 0, JSON.stringify(n));
    ok("Нет неожиданных ошибок страницы", errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  // 4. Внешняя ссылка отдаёт ошибку → играет запасной локальный
  {
    const { page, ctx } = await session(browser, "fail");
    await tap(page, "#btn-start");
    await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3 && /audio\/heygen\//.test(a.currentSrc) && !/heygen\.ai/.test(a.currentSrc); }, { timeout: 15000 }).catch(() => {});
    const s = await state(page);
    ok("Сбой внешней ссылки (404) → играет запасной локальный файл", !s.paused && s.t > 0.3 && /audio\/heygen\/01-osnovanie\.mp3/.test(s.src) && !/heygen\.ai/.test(s.src), JSON.stringify(s));
    // python http.server не умеет Range (перемотка невозможна), поэтому проигрываем на максимальной скорости до конца
    await page.evaluate(() => { document.querySelector("#player").playbackRate = 16; });
    await page.waitForFunction(() => document.querySelector("#player").ended, { timeout: 40000 }).catch(() => {});
    await sleep(400);
    ok("Конец рассказа (запасной файл): остановка отмечена", await page.evaluate(() => Object.keys(state.visited).length === 1 && state.data.points[nextUnvisitedIndex()].num === 2));
    await ctx.close();
  }

  // 5. Внешняя ссылка зависла → через 8 с запасной
  {
    const { page, ctx } = await session(browser, "hang");
    const t0 = Date.now();
    await tap(page, "#btn-start");
    await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3 && !/heygen\.ai/.test(a.currentSrc); }, { timeout: 20000 }).catch(() => {});
    const s = await state(page), dt = Date.now() - t0;
    ok("Зависшая внешняя ссылка → через ~8 с играет запасной файл", !s.paused && s.t > 0.3 && !/heygen\.ai/.test(s.src) && dt > 7000 && dt < 16000, dt + " мс " + JSON.stringify(s));
    await ctx.close();
  }

  // 6. Без сети (офлайн): сначала локальный
  {
    const { page, ctx } = await session(browser, "pass");
    const first = await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }); return narrationSources(state.data.points[0]); });
    ok("Без сети первым идёт локальный файл", /^audio\/heygen\//.test(first[0]) && /^https:/.test(first[1]), JSON.stringify(first));
    await ctx.close();
  }

  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.error("E2E crashed", e); process.exit(1); });

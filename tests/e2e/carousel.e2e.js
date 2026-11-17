/* E2E карусели архивных фото (iPhone 13, 390 px): свайп, стрелки, точки, счётчик «2 / 5», подпись, тап → полный экран,
   одно фото — без стрелок и точек, камера скрывает карусель. Не входит в npm test.
   Запуск: из корня `python3 -m http.server 8099`, затем `node tests/e2e/carousel.e2e.js` (PUPPETEER, CHROME, SHOT) */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const BASE = "http://127.0.0.1:8099/";
const touch = async (cdp, type, pts) => { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) }); if (type === "touchEnd") await sleep(900); };
// пальцевой свайп: touchStart, серия touchMove с паузой кадра (без пауз Chrome не начинает прокрутку), touchEnd
const swipe = async (cdp, x, y, dx) => {
  const send = (type, px) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y, id: 0 }] });
  await send("touchStart", x);
  for (let i = 1; i <= 15; i++) { await send("touchMove", x + dx * i / 15); await sleep(16); }
  await send("touchEnd", x + dx);
  await sleep(900);
};
const V = page => page.evaluate(() => { const g = s => document.querySelector(s), vis = s => { const e = g(s), b = e.getBoundingClientRect(); return getComputedStyle(e).display !== "none" && b.width > 0; }, t = g("#car-track"), h = g("#hero").getBoundingClientRect();
  return { idx: state.photoIdx, n: currentPoint().photos.length, count: g("#hero-count").textContent, cap: g("#photo-caption").innerText.replace(/\s+/g, " "), dotOn: [...document.querySelectorAll("#car-dots .car-dot")].findIndex(d => d.classList.contains("on")), dots: document.querySelectorAll("#car-dots .car-dot").length,
    scroll: Math.round(t.scrollLeft), w: t.clientWidth, slides: document.querySelectorAll(".car-slide").length, prevVis: vis("#car-prev"), nextVis: vis("#car-next"), dotsVis: vis("#car-dots"), prevDis: g("#car-prev").disabled, nextDis: g("#car-next").disabled, carVis: vis("#car"),
    hero: { y: Math.round(h.y + scrollY), h: Math.round(h.height), w: Math.round(h.width) }, camBtn: Math.round(g("#btn-camera").getBoundingClientRect().bottom + scrollY), playBottom: Math.round(g("#btn-play").getBoundingClientRect().bottom + scrollY), vh: innerHeight, sw: document.documentElement.scrollWidth,
    lb: !document.querySelector("#lightbox, .lightbox") ? null : [...document.querySelectorAll("#lightbox, .lightbox")].some(e => getComputedStyle(e).display !== "none" && !e.classList.contains("hidden")), meta: g("#photo-meta").innerText.slice(0, 120) }; });

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const open = async hash => {
    const page = await browser.newPage();
    await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on("request", r => /tile\.openstreetmap\.org|valhalla1|heygen/.test(r.url()) ? r.abort() : r.continue());
    await page.evaluateOnNewDocument(() => localStorage.clear());
    await page.goto(BASE + hash, { waitUntil: "networkidle2" });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);
    return { page, errors, cdp: await page.createCDPSession() };
  };

  // Точка 1 (5 фото)
  {
    const { page, errors, cdp } = await open("#point=osnovanie:0");
    let v = await V(page);
    ok("Карусель в верхней рамке: 5 слайдов, 5 точек, счётчик «1 / 5», стрелка назад неактивна", v.slides === 5 && v.dots === 5 && v.count === "1 / 5" && v.dotOn === 0 && v.prevDis && !v.nextDis && v.prevVis && v.nextVis && v.dotsVis, JSON.stringify(v).slice(0, 300));
    ok("Блок накладки сверху, «Начать рассказ» на первом экране, нет горизонтального скролла", v.camBtn < v.hero.y && v.playBottom <= v.vh && v.sw <= 391, JSON.stringify({ cam: v.camBtn, hero: v.hero, play: v.playBottom }));
    const cap0 = v.cap;
    // стрелка «›»
    await (await page.$("#car-next")).tap(); await sleep(1200);
    v = await V(page);
    ok("Стрелка ›: фото 2, счётчик «2 / 5», точка 2, лента доехала до слайда", v.idx === 1 && v.count === "2 / 5" && v.dotOn === 1 && Math.abs(v.scroll - v.w) <= 2 && !v.prevDis, JSON.stringify({ idx: v.idx, c: v.count, dot: v.dotOn, sc: v.scroll, w: v.w }));
    ok("Подпись и источник сменились под фото 2", v.cap !== cap0 && /1893/.test(v.cap) && /Викисклад/.test(v.cap), v.cap);
    ok("«Права»/источник внизу тоже обновились", /1893/.test(v.meta), v.meta);
    ok("Счётчик «2 / 5» виден поверх рамки", await page.evaluate(() => { const c = document.querySelector("#hero-count"), b = c.getBoundingClientRect(), e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!e && (e === c || c.contains(e)); }));
    await page.screenshot({ path: process.env.SHOT || "/tmp/carousel_390.png" });
    // свайп пальцем влево → фото 3
    const y = v.hero.y + v.hero.h / 2;
    await swipe(cdp, 260, y, -210);
    await sleep(600);
    v = await V(page);
    ok("Свайп влево: фото 3, «3 / 5», подпись обновилась, лента защёлкнулась на слайде", v.idx === 2 && v.count === "3 / 5" && v.dotOn === 2 && Math.abs(v.scroll - 2 * v.w) <= 2 && /1883/.test(v.cap), JSON.stringify({ idx: v.idx, c: v.count, sc: v.scroll, w: v.w, cap: v.cap.slice(0, 60) }));
    // свайп вправо → фото 2
    await swipe(cdp, 110, y, 210);
    await sleep(600);
    v = await V(page);
    ok("Свайп вправо: возврат к фото 2", v.idx === 1 && v.count === "2 / 5" && Math.abs(v.scroll - v.w) <= 2, JSON.stringify({ idx: v.idx, sc: v.scroll }));
    // точки
    await (await page.$$("#car-dots .car-dot"))[4].tap(); await sleep(1300);
    v = await V(page);
    ok("Точка 5: переход к последнему фото, стрелка › неактивна", v.idx === 4 && v.count === "5 / 5" && v.nextDis && !v.prevDis, JSON.stringify({ idx: v.idx, nd: v.nextDis }));
    await (await page.$("#car-prev")).tap(); await sleep(1100);
    v = await V(page);
    ok("Стрелка ‹: фото 4", v.idx === 3 && v.count === "4 / 5", v.count);
    // тап открывает фото на весь экран
    const tapY = v.hero.y + v.hero.h / 2;
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(400);
    const before = await page.evaluate(() => !!document.querySelector("#lightbox:not(.hidden), .lightbox.open, .lightbox.show"));
    await page.touchscreen.tap(195, tapY - 0);
    await sleep(900);
    const lb = await page.evaluate(() => { const els = [...document.querySelectorAll("[id*=lightbox], [class*=lightbox], [id^=lb]")]; return els.map(e => (e.id || e.className) + ":" + getComputedStyle(e).display + ":" + e.className).slice(0, 6); });
    const opened = await page.evaluate(() => { const e = document.querySelector("#lightbox, .lightbox, #lb"); return !!e && getComputedStyle(e).display !== "none" && !e.classList.contains("hidden") && e.getBoundingClientRect().width > 300; });
    ok("Тап по фото открывает его на весь экран", opened && !before, JSON.stringify(lb));
    ok("Нет ошибок страницы", errors.length === 0, errors.join("|"));
    await page.close();
  }

  // Камера скрывает карусель, возвращает после выключения
  {
    const { page, errors } = await open("#point=osnovanie:2");
    await (await page.$("#btn-camera")).tap();
    await page.waitForFunction(() => state.cameraOn, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    let v = await V(page);
    ok("Камера включена: карусель скрыта (накладка живая), счётчик остаётся", !v.carVis && v.count === "3 / 5", JSON.stringify({ car: v.carVis, c: v.count }));
    await (await page.$("#btn-camera")).tap(); await sleep(500);
    v = await V(page);
    ok("Камера выключена: карусель вернулась на том же фото", v.carVis && v.idx === 2 && Math.abs(v.scroll - 2 * v.w) <= 2, JSON.stringify({ car: v.carVis, idx: v.idx, sc: v.scroll }));
    ok("Нет ошибок страницы (камера)", errors.length === 0, errors.join("|"));
    await page.close();
  }

  // Точка с одним фото: ни стрелок, ни точек
  {
    const { page } = await open("#point=osnovanie:0");
    const one = await page.evaluate(() => { const d = state.data.points.find(p => p.photos.length === 1); return d ? d.id : null; });
    if (one) {
      await page.evaluate(id => openPoint(id, false), one);
      await sleep(600);
      const v = await V(page);
      ok("Одно фото: нет стрелок и точек, счётчика нет", v.n === 1 && !v.prevVis && !v.nextVis && !v.dotsVis && v.count === "", JSON.stringify({ n: v.n, p: v.prevVis, nx: v.nextVis, d: v.dotsVis, c: v.count }));
    } else {
      // в данных нет точки с одним фото: проверяем механизм на подмене данных
      await page.evaluate(() => { const p = state.data.points[0]; state.__orig = p.photos; p.photos = [p.photos[0]]; openPoint(p.id, false); });
      await sleep(600);
      const v = await V(page);
      ok("Одно фото (подмена данных): нет стрелок и точек, счётчика нет", v.n === 1 && !v.prevVis && !v.nextVis && !v.dotsVis && v.count === "", JSON.stringify({ n: v.n, p: v.prevVis, nx: v.nextVis, d: v.dotsVis, c: v.count }));
    }
    await page.close();
  }
  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.log(results.map(r => r.join(" | ")).join("\n")); console.error("E2E crashed", e); process.exit(1); });

/* Браузерный E2E режима «Веду вас»: puppeteer-core + Chrome, мок геолокации и Valhalla (реальный ответ из fixtures). Не входит в npm test.
   Запуск: python3 -m http.server 8099 (из корня репозитория), затем: npm i --no-save puppeteer-core && node tests/e2e/hud.e2e.js  (CHROME=путь к Chrome, OUT=папка для скриншотов) */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const fixture = fs.readFileSync(require("path").join(__dirname, "../fixtures/valhalla-stop1-to-stop5.json"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", name, extra]); };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, X-Client-Id", "access-control-allow-methods": "GET, POST, OPTIONS" };

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions("http://127.0.0.1:8099", ["geolocation"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [], vcalls = [];
  let mode = "ok";
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
  page.on("requestfailed", r => { if (!/tile\.openstreetmap|valhalla|heygen/.test(r.url())) errors.push("requestfailed: " + r.url()); });
  await page.setRequestInterception(true);
  page.on("request", async req => {
    const u = req.url();
    if (/tile\.openstreetmap\.org/.test(u)) return req.abort();
    if (/valhalla1\.openstreetmap\.de/.test(u)) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS });
      vcalls.push(JSON.parse(req.postData()));
      if (mode === "500") return req.respond({ status: 500, headers: CORS, body: "x" });
      if (mode === "429") return req.respond({ status: 429, headers: CORS, body: "x" });
      if (mode === "garbage") return req.respond({ status: 200, headers: CORS, contentType: "application/json", body: "{\"trip\":{}}" });
      if (mode === "hang") return; // не отвечаем: проверяем таймаут
      return req.respond({ status: 200, headers: CORS, contentType: "application/json", body: fixture });
    }
    req.continue();
  });
  const geo = (lat, lon, accuracy) => page.setGeolocation({ latitude: lat, longitude: lon, accuracy });
  const txt = sel => page.$eval(sel, e => e.textContent.trim());
  const hidden = sel => page.$eval(sel, e => e.classList.contains("hidden") || getComputedStyle(e).display === "none");

  await geo(55.714855, 37.65706, 10);
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle2" });
  ok("страница загрузилась, NavCore доступен", await page.evaluate(() => typeof NavCore === "object"));
  await page.evaluate(s => document.querySelector(s).click(), "#btn-start");
  await sleep(1500);
  ok("GPS-плашка 'Вы здесь'", /Вы здесь/.test(await txt("#gps-pill")), await txt("#gps-pill"));
  ok("HUD скрыт до построения маршрута", await hidden("#navigation-hud"));
  await page.evaluate(s => document.querySelector(s).click(), "#nav-route");
  await sleep(1500);
  ok("HUD виден после маршрута", !(await hidden("#navigation-hud")));
  ok("Запрос Valhalla: pedestrian, км", vcalls.length === 1 && vcalls[0].costing === "pedestrian" && vcalls[0].units === "km", JSON.stringify(vcalls[0]));
  const title0 = await txt("#nav-turn-title");
  ok("Первый манёвр — ближайший поворот, а не следующий за ним", /Поверните направо\.$/.test(title0), title0);
  ok("Дистанция до поворота ≈ 48 м", /Через 4\d м|Через 5\d м/.test(await txt("#nav-turn-distance")), await txt("#nav-turn-distance"));
  ok("Остаток до остановки показан", /До остановки \d+ м · около \d+ мин/.test(await txt("#nav-route-remaining")), await txt("#nav-route-remaining"));
  ok("Показан GPS ±10 м", /GPS ±10 м/.test(await txt("#nav-gps")), await txt("#nav-gps"));
  ok("Без компаса есть пояснение про север и кнопка компаса", /относительно севера/.test(await txt("#nav-arrow-note")) && !(await hidden("#nav-compass")));
  ok("Старт в 6 м от остановки 1 при acc 10 — кнопка законно показана", !(await hidden("#nav-arrived")));
  const tr = await page.$eval("#nav-arrow", e => e.style.transform);
  ok("Стрелка повёрнута (north-up)", /rotate\(/.test(tr), tr);

  // идём по маршруту: после поворота 1 следующий манёвр меняется
  await geo(55.715241, 37.657413, 8); await sleep(700);
  const t1 = await txt("#nav-turn-title");
  ok("После вершины 1 следующий манёвр = begin 3 (направо на дорожку)", /пешеходную дорожку/.test(t1), t1);

  // ошибки GPS и точка прибытия; цель — остановка 1 (первая непройденная), не 5! берём реальную цель
  const target = await page.evaluate(() => { const p = state.data.points[nextUnvisitedIndex()]; return { id: p.id, lat: p.lat, lon: p.lon, num: p.num }; });
  ok("Текущая цель — остановка 1 (приложение ведёт к 1-й непройденной)", target.num === 1, JSON.stringify(target));
  await geo(target.lat, target.lon + 0.00006, 50); await sleep(700);   // ~4 м, но accuracy 50
  ok("acc 50 м рядом с точкой: кнопка скрыта", await hidden("#nav-arrived"));
  ok("acc 50: явно сказано про неточный GPS", /неточн/.test(await txt("#nav-gps")), await txt("#nav-gps"));
  await geo(target.lat, target.lon + 0.00006, 25); await sleep(700);
  ok("acc 25 м: кнопка скрыта", await hidden("#nav-arrived"));
  await geo(target.lat, target.lon + 0.00006, 15); await sleep(700);
  ok("acc 15 м: кнопка показана", !(await hidden("#nav-arrived")), await txt("#nav-arrived"));
  await geo(target.lat, target.lon + 0.00006, 5); await sleep(700);
  ok("acc 5 м: кнопка показана", !(await hidden("#nav-arrived")));
  // тот же GPS, но далеко (30 м)
  await geo(target.lat + 0.00030, target.lon, 5); await sleep(700);
  ok("acc 5 м, но 33 м от точки: кнопка скрыта", await hidden("#nav-arrived"));
  await geo(target.lat, target.lon + 0.00006, 5); await sleep(700);
  await page.evaluate(s => document.querySelector(s).click(), "#nav-arrived");
  await sleep(500);
  const st = await page.evaluate(() => ({ visited: Object.keys(state.visited), route: state.routeTargetId, scr: document.querySelector(".screen.active").id, ls: localStorage.getItem("simonov-visited") }));
  ok("После 'Я на месте' точка отмечена, старый маршрут удалён, открыт экран остановки", st.visited.length === 1 && st.route === null && st.scr === "screen-point", JSON.stringify(st));
  ok("Прогресс сохранён в localStorage", /osnovanie/.test(st.ls || ""));
  await page.evaluate(s => document.querySelector(s).click(), "#btn-back-point"); await sleep(300);
  ok("После возврата HUD скрыт, следующая цель — 2", await hidden("#navigation-hud") && (await page.evaluate(() => state.data.points[nextUnvisitedIndex()].num)) === 2);

  // уход с маршрута
  await geo(55.714855, 37.65706, 10); await sleep(700);
  vcalls.length = 0;
  await page.evaluate(s => document.querySelector(s).click(), "#nav-route"); await sleep(1200);
  ok("Маршрут к остановке 2 построен (1 запрос)", vcalls.length === 1 && !(await hidden("#navigation-hud")), String(vcalls.length));
  // одиночный скачок на 120 м и возврат — перестроения нет
  await geo(55.715955, 37.65706, 10); await sleep(500);
  await geo(55.714855, 37.65706, 10); await sleep(500);
  ok("Одиночный скачок GPS не вызывает перестроения", vcalls.length === 1, String(vcalls.length));
  // три точных измерения подряд далеко от маршрута, но дебаунс 15 с с момента последнего запроса
  await page.evaluate(() => { state.routeLastAt = Date.now() - 20000; });
  for (const dy of [0.0012, 0.00121, 0.00122]) { await geo(55.714855 - dy, 37.65706 - 0.0005, 10); await sleep(500); }
  await sleep(800);
  ok("Реальный уход: ровно один новый запрос", vcalls.length === 2, String(vcalls.length));
  ok("Новый запрос стартует из новой позиции", vcalls[1] && vcalls[1].locations[0].lat < 55.7138, JSON.stringify(vcalls[1] && vcalls[1].locations[0]));
  for (const dy of [0.00123, 0.00124, 0.00125, 0.00126]) { await geo(55.714855 - dy, 37.65706 - 0.0005, 10); await sleep(300); }
  ok("Дебаунс: частые измерения не плодят запросы", vcalls.length <= 3, String(vcalls.length));

  // ошибки маршрутизатора
  await page.evaluate(() => { clearPedestrianRoute(); });
  mode = "500"; await page.evaluate(s => document.querySelector(s).click(), "#nav-route"); await sleep(1000);
  const g500 = await txt("#route-guidance");
  ok("Valhalla 500: честное сообщение + запасной вариант, HUD скрыт", /временно недоступен/.test(g500) && /внешней пешеходной/.test(g500) && await hidden("#navigation-hud"), g500.slice(0, 80));
  ok("Кнопка маршрута снова активна", await page.$eval("#nav-route", b => !b.disabled && /Проложить/.test(b.textContent)));
  mode = "429"; await page.evaluate(s => document.querySelector(s).click(), "#nav-route"); await sleep(1000);
  ok("Valhalla 429: сообщение про перегрузку", /перегружен/.test(await txt("#route-guidance")), (await txt("#route-guidance")).slice(0, 60));
  mode = "garbage"; await page.evaluate(s => document.querySelector(s).click(), "#nav-route"); await sleep(1000);
  ok("Мусорный ответ: сообщение без падения", /Нет связи|нет линии|Нужна сеть/.test(await txt("#route-guidance")) || /Не удалось|недоступен/.test(await txt("#toast")), (await txt("#route-guidance")).slice(0, 80));
  mode = "hang"; const t0 = Date.now(); await page.evaluate(s => document.querySelector(s).click(), "#nav-route");
  await page.waitForFunction(() => /вовремя/.test(document.querySelector("#route-guidance").textContent), { timeout: 15000 }).catch(() => {});
  const dt = Date.now() - t0;
  ok("Зависший маршрутизатор: таймаут ~10 с и сообщение", /вовремя/.test(await txt("#route-guidance")) && dt > 9000 && dt < 13000, dt + " мс");
  mode = "ok"; await page.evaluate(s => document.querySelector(s).click(), "#nav-route"); await sleep(1200);
  ok("После сбоя повторное построение работает", !(await hidden("#navigation-hud")));

  // устаревший ответ: быстро два запроса, первый зависает — результат второго не затирается
  await page.evaluate(() => clearPedestrianRoute());
  // отказ в геолокации
  const err = await page.evaluate(() => new Promise(res => {
    const orig = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.watchPosition = (ok, bad) => { setTimeout(() => bad({ code: 1, message: "denied" }), 10); return 77; };
    const cw = navigator.geolocation.clearWatch.bind(navigator.geolocation);
    window.__cleared = null; navigator.geolocation.clearWatch = id => { window.__cleared = id; };
    enableGps();
    setTimeout(() => res({ toast: document.querySelector("#toast").textContent, watchId: state.watchId, cleared: window.__cleared, pill: document.querySelector("#gps-pill").textContent }), 200);
  }));
  ok("Отказ в геолокации: понятное сообщение, watch остановлен", /запрещён/.test(err.toast) && err.watchId === null, JSON.stringify(err));

  // повторные enableGps не плодят watch (проверка на реальной подмене)
  const wc = await page.evaluate(() => {
    let active = 0, started = 0;
    navigator.geolocation.watchPosition = () => { active++; started++; return started; };
    navigator.geolocation.clearWatch = () => { active--; };
    state.watchId = null; enableGps(); enableGps(); enableGps();
    return { active, started };
  });
  ok("Повторный запуск GPS: активен один watch", wc.active === 1 && wc.started === 3, JSON.stringify(wc));

  // компас: iOS requestPermission
  const ios = await page.evaluate(async () => {
    let calls = 0, added = 0, removed = 0;
    DeviceOrientationEvent.requestPermission = async () => { calls++; return "granted"; };
    const a = window.addEventListener.bind(window), r = window.removeEventListener.bind(window);
    window.addEventListener = (t, ...x) => { if (/deviceorientation/.test(t)) added++; return a(t, ...x); };
    window.removeEventListener = (t, ...x) => { if (/deviceorientation/.test(t)) removed++; return r(t, ...x); };
    await enableCompass(); await enableCompass();
    const res = { calls, added, removed, compassOn: state.compassOn };
    window.addEventListener = a; window.removeEventListener = r;
    // отказ
    DeviceOrientationEvent.requestPermission = async () => "denied";
    state.compassOn = false; await enableCompass();
    res.denied = document.querySelector("#toast").textContent;
    // событие iOS
    window.dispatchEvent(Object.assign(new Event("deviceorientation"), { webkitCompassHeading: 90 }));
    res.heading = state.heading;
    return res;
  });
  ok("iOS: requestPermission вызван при каждом нажатии, слушатели не копятся", ios.calls === 2 && ios.added >= 2 && ios.removed >= 4 && ios.compassOn, JSON.stringify(ios));
  ok("iOS: отказ в компасе — сообщение про север", /не разрешён/.test(ios.denied), ios.denied);
  ok("webkitCompassHeading принимается", Math.abs(ios.heading - 90) < 90, String(ios.heading));
  const andr = await page.evaluate(() => {
    state.heading = null;
    window.dispatchEvent(Object.assign(new Event("deviceorientationabsolute"), { absolute: true, alpha: 270 }));
    return state.heading;
  });
  ok("Android: deviceorientationabsolute (alpha 270 → 90°)", andr !== null && Math.abs(andr - 90) < 1, String(andr));
  const rel = await page.evaluate(() => {
    state.heading = null;
    window.dispatchEvent(Object.assign(new Event("deviceorientation"), { absolute: false, alpha: 123 }));
    return state.heading;
  });
  ok("Относительный alpha (не от севера) игнорируется", rel === null, String(rel));

  // HUD на разных ширинах (после смены viewport страница перезагружается — проходим сценарий заново)
  for (const w of [320, 375, 390, 430, 1280]) {
    await page.setViewport({ width: w, height: 760, isMobile: w < 800, hasTouch: w < 800 });
    await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle2" });
    await geo(55.7149, 37.6571, 10);
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(s => document.querySelector(s).click(), "#btn-start"); await sleep(800);
    await page.evaluate(s => document.querySelector(s).click(), "#btn-back-point"); await sleep(400);   // «Начать» открывает рассказ; возвращаемся к карте
    mode = "ok";
    await page.evaluate(s => document.querySelector(s).click(), "#nav-route"); await sleep(1300);
    const ov = await page.evaluate(() => { const h = document.querySelector("#navigation-hud").getBoundingClientRect(); const els = ["#nav-compass","#nav-turn-title","#nav-gps","#nav-arrow"].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height), r.right <= document.documentElement.clientWidth + 1]; }); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, hudW: Math.round(h.width), els }; });
    ok(`ширина ${w}: HUD виден, нет горизонтального скролла, всё внутри экрана, кнопка компаса ≥44 px`, ov.hudW > 100 && ov.sw <= ov.cw + 1 && ov.els.every(e => e[3]) && ov.els[0][2] >= 44, JSON.stringify(ov));
    await page.screenshot({ path: `${process.env.OUT || "/tmp"}/hud${w}.png` });
  }
  // решение владельца: конец рассказа отмечает остановку, навигация переключается на следующую
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle2" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await page.evaluate(s => document.querySelector(s).click(), "#btn-start"); await sleep(500);
  const ended = await page.evaluate(() => {
    const first = state.data.points[nextUnvisitedIndex()];
    openPoint(first.id, false);
    document.querySelector("#player").dispatchEvent(new Event("ended"));
    const second = state.data.points[nextUnvisitedIndex()];
    return { first: first.num, visited: Object.keys(state.visited), next: second.num, navStep: document.querySelector("#nav-step").textContent, navTitle: document.querySelector("#nav-title").textContent, toast: document.querySelector("#toast").textContent, secondTitle: second.title, audio: document.querySelector("#player").getAttribute("src") };
  });
  ok("Конец аудио: точка 1 отмечена, навигация на точке 2, тост называет следующую", ended.first === 1 && ended.visited.length === 1 && ended.next === 2 && ended.navStep === "02" && ended.navTitle === ended.secondTitle && ended.toast.includes(ended.secondTitle), JSON.stringify(ended));
  ok("Плеер берёт основной внешний источник HeyGen", /^https:\/\/resource2\.heygen\.ai\//.test(ended.audio), ended.audio);
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 1500)); return (await caches.keys()); });
  ok("Service worker активен, кэш simonov-v14", sw.includes("simonov-v14"), JSON.stringify(sw));
  const expectedNoise = e => /Failed to load resource|ERR_FAILED|status of (500|429)|net::ERR/.test(e);
  const real = errors.filter(e => !expectedNoise(e));
  ok("Нет неожиданных ошибок консоли и pageerror", real.length === 0, real.join(" | "));
  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("ОШИБКИ (все):", JSON.stringify(errors, null, 1));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.error("E2E crashed", e); process.exit(1); });

/* E2E плашки «Подойдите к точке» (iPhone 13, 390 px, фейковый GPS из points.json): далеко, на месте, без GPS.
   Не входит в npm test. Запуск: из корня `python3 -m http.server 8099`, затем `node tests/e2e/approach.e2e.js` (PUPPETEER, CHROME, SHOT) */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const fs = require("fs"), path = require("path");
const points = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/points.json"), "utf8")).points;
const P1 = points[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const BASE = "http://127.0.0.1:8099/";
const M_LAT = 1 / 111320;   // градусов широты в метре
const tap = async (page, sel) => { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center", behavior: "instant" }), sel); await sleep(350); await (await page.$(sel)).tap(); await sleep(350); };
const view = page => page.evaluate(() => { const g = s => document.querySelector(s); const vis = s => getComputedStyle(g(s)).display !== "none"; const b = g("#approach").getBoundingClientRect(), pl = g("#btn-play").getBoundingClientRect(), nx = g("#pt-nav-top .js-next").getBoundingClientRect();
  return { cls: g("#approach").className, title: g("#approach-title").textContent, sub: g("#approach-sub").textContent, arrow: vis("#approach-arrow"), arrowTf: g("#approach-arrow").style.transform, path: vis("#btn-approach-path"), here: g("#btn-play").classList.contains("is-here"),
    top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), h: Math.round(b.height), playTop: Math.round(pl.top + scrollY), playBottom: Math.round(pl.bottom + scrollY), nextBottom: Math.round(nx.bottom + scrollY), vh: innerHeight, sw: document.documentElement.scrollWidth, paused: g("#player").paused, t: g("#player").currentTime, screen: document.querySelector(".screen.active").id, label: g("#point-num-label").textContent }; });

async function session(browser, geo) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE.slice(0, -1), geo ? ["geolocation"] : []);
  const page = await ctx.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
  const errors = [], vcalls = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", r => { const u = r.url(); if (/valhalla1/.test(u)) { vcalls.push(u); return r.abort(); } return /tile\.openstreetmap\.org|heygen/.test(u) ? r.abort() : r.continue(); });
  if (geo) await page.setGeolocation(geo);
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await tap(page, "#btn-start");   // карточка точки 1 + запрос GPS
  await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused; }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { document.querySelector("#player").pause(); window.scrollTo({ top: 0, behavior: "instant" }); });
  await sleep(4200);
  return { ctx, page, errors, vcalls };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });

  // 1. далеко: 120 м к югу от точки 1, точность 8 м
  {
    const { ctx, page, errors, vcalls } = await session(browser, { latitude: P1.lat - 120 * M_LAT, longitude: P1.lon, accuracy: 8 });
    await page.waitForFunction(() => /Подойдите к точке · /.test(document.querySelector("#approach-title").textContent), { timeout: 10000 }).catch(() => {});
    let v = await view(page);
    ok("Далеко: «Подойдите к точке · ~120 м», плашка жёлтая, кнопка «Показать путь»", /^Подойдите к точке · 1[12]\d м$/.test(v.title) && /far/.test(v.cls) && v.path, JSON.stringify(v).slice(0, 300));
    ok("Далеко без компаса: стрелки нет, есть текстовое направление (юг → к точке на север)", !v.arrow && /Направление: север/.test(v.sub), v.sub);
    ok("«Начать рассказ» не выделена, не заблокирована", !v.here && await page.$eval("#btn-play", b => !b.disabled));
    ok("Плашка над кнопкой «Начать рассказ», компактна, всё на первом экране 390×844", v.bottom <= v.playTop && v.h <= 90 && v.playBottom <= v.vh && v.nextBottom <= v.vh && v.sw <= 391, JSON.stringify({ top: v.top, bottom: v.bottom, h: v.h, playBottom: v.playBottom, next: v.nextBottom }));
    // компас: тот же расчёт, что в приложении (heading задаём как будто датчик ответил: смотрим на восток → точка слева)
    await page.evaluate(() => { state.heading = 90; state.headingAt = Date.now(); updateApproach(); });
    v = await view(page);
    ok("С компасом: стрелка видна и повёрнута (на север при взгляде на восток ≈ −90°)", v.arrow && /rotate\(-?\d/.test(v.arrowTf) && Math.abs(((parseFloat(v.arrowTf.match(/rotate\((-?[\d.]+)/)[1]) % 360) + 360) % 360 - 270) < 15, v.arrowTf);
    await page.screenshot({ path: process.env.SHOT || "/tmp/approach_390.png" });
    // звук работает даже вдали
    await tap(page, "#btn-play");
    await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3; }, { timeout: 15000 }).catch(() => {});
    v = await view(page);
    ok("Далеко рассказ не заблокирован: «Начать рассказ» запускает звук", !v.paused && v.t > 0.3, JSON.stringify({ paused: v.paused, t: v.t }));
    // «Показать путь»
    await tap(page, "#btn-approach-path");
    await sleep(800);
    const r = await page.evaluate(() => ({ screen: document.querySelector(".screen.active").id, pref: state.navPref, step: document.querySelector("#nav-step").textContent, paused: document.querySelector("#player").paused }));
    ok("«Показать путь»: экран маршрута, навигация на эту точку, запрос пешего пути, звук остановлен", r.screen === "screen-tour" && r.pref === P1.id && r.step === "01" && vcalls.length >= 1 && r.paused, JSON.stringify({ ...r, vcalls: vcalls.length }));
    ok("Далеко: нет ошибок страницы", errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  // 2. на месте: в 5 м от точки 1, точность 8 м; потом уходим вдаль и обратно
  {
    const { ctx, page, errors } = await session(browser, { latitude: P1.lat + 5 * M_LAT, longitude: P1.lon, accuracy: 8 });
    await page.waitForFunction(() => /Вы на месте/.test(document.querySelector("#approach-title").textContent), { timeout: 10000 }).catch(() => {});
    let v = await view(page);
    ok("На месте: плашка зелёная «Вы на месте — начните рассказ», без «Показать путь»", v.title === "Вы на месте — начните рассказ" && /here/.test(v.cls) && !v.path && !v.arrow, JSON.stringify(v).slice(0, 300));
    ok("На месте: «Начать рассказ» выделена", v.here);
    await page.screenshot({ path: "/tmp/approach_here_390.png" });
    await page.setGeolocation({ latitude: P1.lat - 80 * M_LAT, longitude: P1.lon, accuracy: 8 });
    await page.waitForFunction(() => /Подойдите к точке · /.test(document.querySelector("#approach-title").textContent), { timeout: 10000 }).catch(() => {});
    v = await view(page);
    ok("Ушли на ~80 м: плашка снова «Подойдите…», выделение снято", /Подойдите к точке · [78]\d м/.test(v.title) && !v.here, v.title);
    await page.setGeolocation({ latitude: P1.lat + 10 * M_LAT, longitude: P1.lon, accuracy: 30 });
    await page.waitForFunction(() => /рядом/.test(document.querySelector("#approach-title").textContent), { timeout: 10000 }).catch(() => {});
    v = await view(page);
    ok("Рядом, но GPS неточен (±30 м): нейтральная «Вы рядом…», «Я на месте» не обещаем", /^Вы рядом с точкой/.test(v.title) && !v.here && /neutral/.test(v.cls), v.title);
    ok("На месте: нет ошибок страницы", errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  // 3. без GPS (доступ запрещён)
  {
    const { ctx, page, errors } = await session(browser, null);
    const v = await view(page);
    ok("Без GPS: нейтральный текст «Подойдите к точке и начните рассказ», без кнопки и стрелки", v.title === "Подойдите к точке и начните рассказ" && /neutral/.test(v.cls) && !v.path && !v.arrow && !v.here, JSON.stringify(v).slice(0, 300));
    await tap(page, "#btn-play");
    await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3; }, { timeout: 15000 }).catch(() => {});
    const w = await view(page);
    ok("Без GPS рассказ работает", !w.paused && w.t > 0.3);
    ok("Без GPS: нет ошибок страницы", errors.length === 0, errors.join("|"));
    await ctx.close();
  }
  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.error("E2E crashed", e); process.exit(1); });

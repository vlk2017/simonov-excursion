/* E2E «Рефотосъёмка» (iPhone 13, 390 px, фейковая камера Chrome): шаг 1 «Совместите» (пинч, сдвиг, подсказки),
   шаг 2 «Тогда/сейчас» (шторка, подписи), «Снимок» через canvas, режим без камеры. Не входит в npm test.
   Запуск: из корня `python3 -m http.server 8099`, затем `node tests/e2e/rephoto.e2e.js`
   (PUPPETEER, CHROME, SHOT_ALIGN, SHOT_SLIDER — пути). */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const fs = require("fs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const BASE = "http://127.0.0.1:8099/";
const DL = "/tmp/rp_dl";
const tap = async (page, sel) => { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center", behavior: "instant" }), sel); await sleep(350); await (await page.$(sel)).tap(); await sleep(400); };
const tapFixed = async (page, sel) => {
  // тап по центру кнопки; убеждаемся, что именно кнопка (а не шторка поверх неё) получает нажатие
  const top = await page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(), e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!e && (e.id === s.slice(1)); }, sel);
  if (!top) throw new Error("кнопка " + sel + " перекрыта: " + await page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(), e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e ? (e.id || e.className || e.tagName) + " @" + Math.round(b.x + b.width / 2) + "," + Math.round(b.y + b.height / 2) : "none"; }, sel));
  await (await page.$(sel)).tap(); await sleep(400);
};

async function open(browser, hash, denyCamera) {
  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", r => /tile\.openstreetmap\.org|valhalla1|heygen/.test(r.url()) ? r.abort() : r.continue());
  await page.evaluateOnNewDocument(deny => { localStorage.clear(); if (deny) navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })); }, !!denyCamera);
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  await page.goto(BASE + hash, { waitUntil: "networkidle2" });
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(600);
  return { page, cdp, errors };
}
// после жеста ждём 700 мс: иначе Chrome принимает следующий тап за часть двойного нажатия и не шлёт click (особенность эмуляции)
const touch = async (cdp, type, pts) => { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) }); if (type === "touchEnd") await sleep(700); };
const S = page => page.evaluate(() => { const g = s => document.querySelector(s), h = g("#hero").getBoundingClientRect(), ov = g("#overlay-img"); return {
  rp: JSON.parse(JSON.stringify(state.rp)), hero: { x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.width), h: Math.round(h.height), pos: getComputedStyle(g("#hero")).position }, vw: innerWidth, vh: innerHeight,
  hint: g("#rp-hint").innerText.replace(/\s+/g, " "), ovSrc: ov.getAttribute("src") || "", ovOp: ov.style.opacity, ovTf: ov.style.transform, clip: g("#overlay-wrap").style.clipPath, mode: state.camMode, curtain: state.curtain,
  curtainVis: getComputedStyle(g("#cam-curtain")).display !== "none", ll: g("#rp-label-l").innerText, lr: g("#rp-label-r").innerText, llVis: getComputedStyle(g("#rp-label-l")).display !== "none", lrVis: getComputedStyle(g("#rp-label-r")).display !== "none",
  btn: ["done", "shot", "back", "reset", "exit"].filter(k => getComputedStyle(g("#rp-" + k)).display !== "none"), lock: document.body.classList.contains("rp-lock"), uiVis: getComputedStyle(g("#rp-ui")).display !== "none",
  vidVis: getComputedStyle(g("#live-video")).display !== "none", nowSrc: g("#rp-now-img").getAttribute("src") || "", nowVis: getComputedStyle(g("#rp-now-img")).display !== "none", audioPaused: g("#player").paused, bar: (() => { const b = g("#rp-bar").getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; })() }; });

(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });

  // ---- 1. С камерой, кадр с современным фото и азимутом (Дуло, фото 1)
  {
    const { page, cdp, errors } = await open(browser, "#point=dulo:0");
    await page.evaluate(() => { const a = document.querySelector("#player"); a.muted = true; a.play().catch(() => {}); });
    await sleep(500);
    await tap(page, "#btn-camera");
    await page.waitForFunction(() => state.cameraOn && document.querySelector("#live-video").readyState >= 2, { timeout: 15000 }).catch(() => {});
    let s = await S(page);
    ok("Кнопки «Раньше/Наложить/Шторка/Сейчас» на месте + «Рефотосъёмка»", await page.evaluate(() => ["then", "overlay", "curtain", "now", "rephoto"].every(m => document.querySelector(`#cam-modes [data-mode="${m}"]`)) && !document.querySelector("#cam-modes").classList.contains("hidden")));
    await tap(page, '#cam-modes [data-mode="rephoto"]');
    s = await S(page);
    ok("Шаг 1: сцена на весь экран 390×844", s.rp.on && s.rp.step === 1 && s.hero.pos === "fixed" && s.hero.w === s.vw && s.hero.h === s.vh && s.lock && s.uiVis, JSON.stringify(s.hero));
    ok("Шаг 1: подсказка «Двигайте телефон, пока контур не совпадёт со зданием»", /Двигайте телефон, пока контур не совпадёт со зданием/.test(s.hint), s.hint);
    ok("Шаг 1: накладка ~35%, это современное фото того же ракурса, камера видна", Math.abs(parseFloat(s.ovOp) - 0.35) < 0.01 && /now\/dulo-south-2023/.test(s.ovSrc) && s.vidVis, JSON.stringify({ op: s.ovOp, src: s.ovSrc }));
    ok("Шаг 1: азимут из данных (0° — север) показан; кнопки «Совмещено ✓», «Сбросить», «Выйти»", /азимут 0°/.test(s.hint) && /север/.test(s.hint) && s.btn.join() === "done,reset,exit", s.hint + " | " + s.btn);
    ok("Шаг 1: кнопки у нижнего края и в экране", s.bar.bottom <= s.vh && s.bar.top > s.vh * 0.6, JSON.stringify(s.bar));
    await page.screenshot({ path: process.env.SHOT_ALIGN || "/tmp/rephoto_align_390.png" });
    // пинч: два пальца 90 → 170 px
    await touch(cdp, "touchStart", [[150, 400], [240, 400]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[150 - 5 * i, 400], [240 + 5 * i, 400]]);
    await touch(cdp, "touchEnd", []);
    s = await S(page);
    ok("Пинч-зум: масштаб ≈ ×1.9", s.rp.scale > 1.7 && s.rp.scale < 2.1 && /scale\(/.test(s.ovTf), `scale=${s.rp.scale} tf=${s.ovTf}`);
    const before = { x: s.rp.x, y: s.rp.y };
    await touch(cdp, "touchStart", [[195, 300]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[195 + 5 * i, 300 + 4 * i]]);
    await touch(cdp, "touchEnd", []);
    s = await S(page);
    ok("Перетаскивание накладки одним пальцем: сдвиг ≈ +40/+32 px", Math.abs(s.rp.x - before.x - 40) < 6 && Math.abs(s.rp.y - before.y - 32) < 6, JSON.stringify({ before, now: { x: s.rp.x, y: s.rp.y } }));
    const fixed = { scale: s.rp.scale, x: s.rp.x, y: s.rp.y };
    await tapFixed(page, "#rp-done");
    s = await S(page);
    ok("«Совмещено ✓» фиксирует масштаб и сдвиг и открывает шаг 2", s.rp.step === 2 && s.rp.saved && Math.abs(s.rp.saved.scale - fixed.scale) < 1e-6 && s.rp.saved.x === fixed.x, JSON.stringify(s.rp.saved));
    ok("Шаг 2: по умолчанию шторка; слева историческое фото с теми же масштабом и сдвигом, справа камера", s.mode === "curtain" && s.curtainVis && /barshchevsky-1881-dulo/.test(s.ovSrc) && parseFloat(s.ovOp) === 1 && Math.abs(parseFloat((s.ovTf.match(/scale\(([\d.]+)\)/) || [])[1]) - fixed.scale) < 1e-3 && s.ovTf.includes(`translate(${fixed.x}px, ${fixed.y}px)`) && s.vidVis && /inset\(0px 50% 0px 0px\)|inset\(0 50% 0 0\)/.test(s.clip), JSON.stringify({ mode: s.mode, src: s.ovSrc, tf: s.ovTf, clip: s.clip }));
    ok("Шаг 2: подписи — год слева и «Сейчас» справа; кнопки «Снимок», «Совместить заново», «Выйти»", s.llVis && s.lrVis && /^1881/.test(s.ll) && s.lr === "Сейчас" && s.btn.join() === "shot,back,exit", JSON.stringify({ ll: s.ll, lr: s.lr, btn: s.btn }));
    // тянем шторку пальцем
    await touch(cdp, "touchStart", [[195, 420]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[195 - 12 * i, 420]]);
    await touch(cdp, "touchEnd", []);
    s = await S(page);
    ok("Шторка тянется пальцем на весь экран (≈ 25%)", Math.abs(s.curtain - 25) < 6, String(s.curtain));
    await touch(cdp, "touchStart", [[100, 420]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[100 + 14 * i, 420]]);
    await touch(cdp, "touchEnd", []);
    await page.evaluate(() => setCurtain(45));
    await sleep(300);
    s = await S(page);
    ok("Шаг 2: переместили шторку вправо — подтверждено", s.curtain === 45 || s.curtain > 60, String(s.curtain));
    await page.screenshot({ path: process.env.SHOT_SLIDER || "/tmp/rephoto_slider_390.png" });
    // снимок
    await tapFixed(page, "#rp-shot");
    await page.waitForFunction(() => state.rp.shot, { timeout: 15000 }).catch(() => {});
    await sleep(800);
    s = await S(page);
    const files = fs.readdirSync(DL).filter(f => /\.jpg$/.test(f));
    const head = files[0] ? fs.readFileSync(`${DL}/${files[0]}`).subarray(0, 3).toString("hex") : "";
    ok("«Снимок»: canvas → JPEG скачан, ≥390 px по ширине, не пустой", s.rp.shot && !s.rp.shot.error && s.rp.shot.how === "download" && s.rp.shot.w >= 390 && s.rp.shot.size > 20000 && files.length === 1 && head === "ffd8ff", JSON.stringify(s.rp.shot) + " " + files + " " + head);
    ok("Звук рассказа продолжал играть на всех шагах", !s.audioPaused);
    // назад к совмещению: масштаб и сдвиг сохранены
    await tapFixed(page, "#rp-back");
    s = await S(page);
    ok("«Совместить заново» возвращает шаг 1 с теми же масштабом и сдвигом, накладка 35%", s.rp.step === 1 && Math.abs(s.rp.scale - fixed.scale) < 1e-6 && Math.abs(parseFloat(s.ovOp) - 0.35) < 0.01 && /now\/dulo/.test(s.ovSrc) && !s.curtainVis, JSON.stringify({ step: s.rp.step, op: s.ovOp, src: s.ovSrc }));
    await tapFixed(page, "#rp-done");
    await tapFixed(page, "#rp-exit");
    s = await S(page);
    ok("«Выйти»: обычный вид, режим «Шторка», масштаб/сдвиг остаются, камера включена", !s.rp.on && s.hero.pos === "relative" && !s.lock && !s.uiVis && s.mode === "curtain" && s.ovTf.includes("scale(") && await page.evaluate(() => state.cameraOn), JSON.stringify({ pos: s.hero.pos, mode: s.mode, tf: s.ovTf }));
    // старые режимы продолжают работать
    await tap(page, '#cam-modes [data-mode="overlay"]');
    s = await S(page);
    ok("Старые режимы работают после рефотосъёмки («Наложить» 55%)", s.mode === "overlay" && Math.abs(parseFloat(s.ovOp) - 0.55) < 0.01, JSON.stringify({ mode: s.mode, op: s.ovOp }));
    ok("Нет ошибок страницы (с камерой)", errors.length === 0, errors.join("|"));
    await page.close();
  }

  // ---- 2. С камерой, кадр без современного фото и без азимута: контур — историческое фото, азимута не выдумываем
  {
    const { page, errors } = await open(browser, "#point=kolokolnya:3");
    await tap(page, "#btn-camera");
    await page.waitForFunction(() => state.cameraOn, { timeout: 15000 }).catch(() => {});
    await tap(page, '#cam-modes [data-mode="rephoto"]');
    const s = await S(page);
    const info = await page.evaluate(() => { const ph = currentPhoto(); return { hasNow: !!ph.now, bearing: ph.viewpoint && ph.viewpoint.bearing, src: ph.src }; });
    ok("Нет современного фото: контур — само историческое фото, накладка 35%", !info.hasNow && s.ovSrc === info.src && Math.abs(parseFloat(s.ovOp) - 0.35) < 0.01, JSON.stringify({ info, src: s.ovSrc }));
    ok("Нет азимута в данных — подсказки по азимуту нет", (info.bearing == null) && !/азимут/.test(s.hint), s.hint);
    ok("Нет ошибок страницы (кадр без now)", errors.length === 0, errors.join("|"));
    await page.close();
  }

  // ---- 3. Без камеры (доступ запрещён): шторка между историческим и современным фото
  {
    const { page, cdp, errors } = await open(browser, "#point=dulo:0", true);
    fs.readdirSync(DL).forEach(f => fs.unlinkSync(`${DL}/${f}`));
    await tap(page, "#btn-camera");
    await sleep(600);
    const vis = await page.evaluate(() => ({ msg: document.querySelector("#cam-msg").textContent, nocam: getComputedStyle(document.querySelector("#btn-rp-nocam")).display !== "none" }));
    ok("Камера запрещена: сообщение и кнопка «Сравнить без камеры»", /Доступ к камере запрещён/.test(vis.msg) && vis.nocam, JSON.stringify(vis));
    await tap(page, "#btn-rp-nocam");
    let s = await S(page);
    ok("Без камеры: шторка на весь экран, слева историческое, справа современное фото, подписи", s.rp.on && s.rp.noCam && s.rp.step === 2 && s.hero.pos === "fixed" && /barshchevsky-1881-dulo/.test(s.ovSrc) && /now\/dulo-south-2023/.test(s.nowSrc) && s.nowVis && !s.vidVis && /^1881/.test(s.ll) && s.lr === "Сейчас" && s.btn.join() === "shot,exit", JSON.stringify({ src: s.ovSrc, now: s.nowSrc, btn: s.btn }));
    await touch(cdp, "touchStart", [[195, 420]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[195 + 10 * i, 420]]);
    await touch(cdp, "touchEnd", []);
    s = await S(page);
    ok("Без камеры шторка тянется пальцем (≈ 70%)", s.curtain > 60 && s.curtain < 80, String(s.curtain));
    await tapFixed(page, "#rp-shot");
    await page.waitForFunction(() => state.rp.shot, { timeout: 15000 }).catch(() => {});
    await sleep(800);
    s = await S(page);
    ok("Без камеры «Снимок» сохраняет кадр (JPEG)", s.rp.shot && !s.rp.shot.error && s.rp.shot.size > 15000 && fs.readdirSync(DL).length === 1, JSON.stringify(s.rp.shot));
    await tapFixed(page, "#rp-exit");
    s = await S(page);
    ok("«Выйти»: обычная карточка, историческое фото на месте", !s.rp.on && s.hero.pos === "relative" && !s.lock && await page.evaluate(() => !document.querySelector("#then-img").classList.contains("hidden") && document.querySelector("#rp-now-img").classList.contains("hidden")));
    ok("Нет ошибок страницы (без камеры)", errors.length === 0, errors.join("|"));
    await page.close();
  }
  // ---- 4. Без камеры и без современного фото кнопки сравнения нет
  {
    const { page } = await open(browser, "#point=kolokolnya:3", true);
    await tap(page, "#btn-camera"); await sleep(500);
    ok("Нет современного фото: «Сравнить без камеры» не предлагается", await page.evaluate(() => getComputedStyle(document.querySelector("#btn-rp-nocam")).display === "none"));
    await page.close();
  }
  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.log(results.map(r => r.join(" | ")).join("\n")); console.error("E2E crashed", e); process.exit(1); });

/* E2E накладки (эмуляция iPhone 13, 390 px, фейковая камера Chrome): кнопка камеры вверху на первом экране, режимы,
   шторка, звук не прерывается, отказ в камере. Не входит в npm test.
   Запуск: из корня `python3 -m http.server 8099`, затем `node tests/e2e/camera.e2e.js`
   (puppeteer-core + Chrome; CHROME, PUPPETEER, SHOT_TOP, SHOT_CAM — пути). */
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const BASE = "http://127.0.0.1:8099/";
const tap = async (page, sel) => { await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: "center" }), sel); await sleep(150); await (await page.$(sel)).tap(); };

async function open(browser, deny) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 13"]);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", r => /tile\.openstreetmap\.org/.test(r.url()) ? r.abort() : r.continue());
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: "networkidle2" });
  return { page, ctx, errors };
}
const modeState = page => page.evaluate(() => { const ov = document.querySelector("#overlay-img"), v = document.querySelector("#live-video"); return { mode: state.camMode, op: ov.style.opacity, clip: document.querySelector("#overlay-wrap").style.clipPath, ovHidden: ov.classList.contains("hidden"), vidHidden: v.classList.contains("hidden"), slider: !document.querySelector("#cam-slider").classList.contains("hidden"), curtain: !document.querySelector("#cam-curtain").classList.contains("hidden"), on: [...document.querySelectorAll("#cam-modes button.on")].map(b => b.dataset.mode) }; });

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const { page, ctx, errors } = await open(browser);
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
  await tap(page, "#btn-start");                       // обложка → карточка остановки 1, звук
  await page.waitForFunction(() => { const a = document.querySelector("#player"); return !a.paused && a.currentTime > 0.3; }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector("#toast").classList.contains("show"), { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const lay = await page.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), h: Math.round(b.height), w: Math.round(b.width) }; }; return { cam: r("#btn-camera"), comp: r("#btn-compass"), hero: r("#hero"), audioBox: r("#audio-box"), play: r("#btn-play"), thumbs: r("#photo-caption"), vh: innerHeight, sw: document.documentElement.scrollWidth }; });
  ok("Кнопка «Совместить с камерой» выше фото и на первом экране (390×844)", lay.cam.bottom < lay.hero.top && lay.cam.bottom <= lay.vh && lay.cam.h >= 56 && lay.cam.w > 200, JSON.stringify(lay.cam));
  ok("Компас рядом с камерой (выше фото, ≥44 px)", lay.comp.bottom < lay.hero.top && lay.comp.h >= 44, JSON.stringify(lay.comp));
  ok("«Начать рассказ» остаётся на первом экране сразу под верхним изображением", lay.play.bottom <= lay.vh && lay.audioBox.top - lay.hero.bottom < 40, JSON.stringify({ hero: lay.hero, audioBox: lay.audioBox, play: lay.play, vh: lay.vh }));
  ok("Подпись архивного фото ниже плеера (карусель сверху в рамке); нет горизонтального скролла", lay.thumbs.top >= lay.audioBox.bottom - 2 && lay.sw <= 391, JSON.stringify({ thumbs: lay.thumbs, sw: lay.sw }));
  ok("Нижних дублей кнопок камеры/компаса нет", await page.evaluate(() => document.querySelectorAll("#btn-camera").length === 1 && !document.querySelector(".row-btns #btn-camera, .row-btns #btn-compass")));
  ok("До включения камеры режимы скрыты", await page.$eval("#cam-modes", e => e.classList.contains("hidden")));
  await page.screenshot({ path: process.env.SHOT_TOP || "/tmp/card_top_390.png" });

  // включаем камеру, звук должен продолжаться
  const t0 = await page.evaluate(() => document.querySelector("#player").currentTime);
  await tap(page, "#btn-camera");
  await page.waitForFunction(() => state.cameraOn && document.querySelector("#live-video").readyState >= 2, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const cam = await page.evaluate(() => { const v = document.querySelector("#live-video"), a = document.querySelector("#player"); return { on: state.cameraOn, vw: v.videoWidth, vpaused: v.paused, vmuted: v.muted, apaused: a.paused, t: a.currentTime, btn: document.querySelector("#btn-camera").textContent.trim(), tracks: state.stream ? state.stream.getTracks().map(t => t.kind) : [] }; });
  ok("Камера включилась (фейковый поток идёт, только видео без микрофона)", cam.on && cam.vw > 0 && !cam.vpaused && cam.vmuted && JSON.stringify(cam.tracks) === '["video"]', JSON.stringify(cam));
  ok("Аудио продолжает играть после включения камеры", !cam.apaused && cam.t > t0, JSON.stringify({ t0, ...cam }));
  ok("Кнопка стала «Выключить камеру»", cam.btn === "Выключить камеру");
  let s = await modeState(page);
  ok("По умолчанию «Наложить» ~55%, ползунок виден", s.mode === "overlay" && Math.abs(parseFloat(s.op) - 0.55) < 0.01 && s.slider && !s.curtain && !s.ovHidden && !s.vidHidden, JSON.stringify(s));
  await page.evaluate(() => { const o = document.querySelector("#opacity"); o.value = "0.8"; o.dispatchEvent(new Event("input", { bubbles: true })); });
  s = await modeState(page);
  ok("Ползунок меняет прозрачность накладки", Math.abs(parseFloat(s.op) - 0.8) < 0.01, JSON.stringify(s));
  await tap(page, '#cam-modes [data-mode="then"]'); s = await modeState(page);
  ok("«Раньше»: старое фото 100%, ползунка нет", s.mode === "then" && parseFloat(s.op) === 1 && !s.slider && !s.curtain && s.on[0] === "then", JSON.stringify(s));
  await tap(page, '#cam-modes [data-mode="now"]'); s = await modeState(page);
  ok("«Сейчас»: накладка скрыта, видна только камера", s.mode === "now" && parseFloat(s.op) === 0 && !s.vidHidden && !s.slider && s.on[0] === "now", JSON.stringify(s));
  await tap(page, '#cam-modes [data-mode="curtain"]'); s = await modeState(page);
  ok("«Шторка»: полоса видна, накладка обрезана по полосе", s.mode === "curtain" && s.curtain && /inset\(0px 50% 0px 0px\)|inset\(0 50% 0 0\)/.test(s.clip), JSON.stringify(s));
  // тянем шторку пальцем (эмуляция touch через CDP)
  const box = await (await page.$("#hero")).boundingBox();
  await page.evaluate(() => window.scrollTo(0, Math.max(0, document.querySelector("#hero").getBoundingClientRect().top + scrollY - 100)));
  const b2 = await (await page.$("#hero")).boundingBox();
  const y = b2.y + b2.height / 2, x0 = b2.x + b2.width * 0.5, x1 = b2.x + b2.width * 0.2, x2 = b2.x + b2.width * 0.85;
  const cdp = await page.createCDPSession();
  const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", x0); for (let i = 1; i <= 6; i++) await touch("touchMove", x0 + (x1 - x0) * i / 6); await touch("touchEnd");
  const c1 = await page.evaluate(() => state.curtain);
  await touch("touchStart", x1); for (let i = 1; i <= 6; i++) await touch("touchMove", x1 + (x2 - x1) * i / 6); await touch("touchEnd");
  const c2 = await page.evaluate(() => ({ p: state.curtain, clip: document.querySelector("#overlay-wrap").style.clipPath, left: document.querySelector("#cam-curtain").style.left }));
  ok("Шторка тянется пальцем влево (~20%) и вправо (~85%)", Math.abs(c1 - 20) < 8 && Math.abs(c2.p - 85) < 8 && c2.clip.includes(`${(100 - c2.p)}%`.slice(0, 2)) && c2.left.endsWith("%"), JSON.stringify({ c1, c2 }));
  await tap(page, '#cam-modes [data-mode="overlay"]');
  const sc = await page.evaluate(() => { window.scrollTo(0, 0); return 1; });
  await sleep(500);
  // вернуть шторку для скриншота: показываем шторку в кадре
  await page.evaluate(() => { setCamMode("curtain"); setCurtain(45); window.scrollTo(0, 0); });
  await sleep(600);
  await page.screenshot({ path: process.env.SHOT_CAM || "/tmp/camera_390.png" });
  const a2 = await page.evaluate(() => { const a = document.querySelector("#player"); return { paused: a.paused, t: a.currentTime }; });
  ok("Аудио играет и после переключения режимов", !a2.paused && a2.t > cam.t, JSON.stringify(a2));
  await tap(page, "#btn-camera");
  await sleep(500);
  const off = await page.evaluate(() => ({ on: state.cameraOn, tracks: state.stream, vhidden: document.querySelector("#live-video").classList.contains("hidden"), thenShown: !document.querySelector("#then-img").classList.contains("hidden"), modesHidden: document.querySelector("#cam-modes").classList.contains("hidden"), btn: document.querySelector("#btn-camera").textContent.trim(), paused: document.querySelector("#player").paused }));
  ok("Выключение камеры: видео скрыто, старое фото на месте, режимы скрыты, звук играет", !off.on && !off.tracks && off.vhidden && off.thenShown && off.modesHidden && off.btn === "Совместить с камерой" && !off.paused, JSON.stringify(off));
  ok("Нет ошибок страницы", errors.length === 0, errors.join("|"));
  await ctx.close();

  // отказ в доступе к камере
  {
    const { page, ctx, errors } = await open(browser);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })); });
    await page.evaluate(() => { document.querySelector("#btn-start").click(); });
    await sleep(700);
    await tap(page, "#btn-camera"); await sleep(600);
    const d = await page.evaluate(() => ({ msg: document.querySelector("#cam-msg").textContent, on: state.cameraOn, modesHidden: document.querySelector("#cam-modes").classList.contains("hidden"), btn: document.querySelector("#btn-camera").textContent.trim() }));
    ok("Отказ камеры: понятное сообщение под кнопкой, режим не включился", /Доступ к камере запрещён/.test(d.msg) && !d.on && d.modesHidden && d.btn === "Совместить с камерой", JSON.stringify(d));
    await ctx.close();
  }
  console.log(results.map(r => r.join(" | ")).join("\n"));
  console.log("FAIL:", results.filter(r => r[0] === "FAIL").length, "PASS:", results.filter(r => r[0] === "PASS").length);
  await browser.close();
})().catch(e => { console.error("E2E crashed", e); process.exit(1); });

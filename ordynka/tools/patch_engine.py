#!/usr/bin/env python3
"""Воспроизводимо превращает движок Симонова (../js/app.js, ../index.html, ../manifest) в движок «Ордынки».
Запуск из папки ordynka: python3 tools/patch_engine.py"""
import re, shutil
from pathlib import Path
B = Path(__file__).resolve().parent.parent
R = B.parent

def sub(text, old, new, count=1):
    assert old in text, "не найдено: " + old[:70]
    return text.replace(old, new) if count == 0 else text.replace(old, new, count)

# ---------- app.js ----------
t = (R / "js" / "app.js").read_text(encoding="utf-8")
for k in ("visited", "arrive"):
    t = t.replace(f'"simonov-{k}"', f'"ordynka-{k}"')
t = sub(t, '"simonov-offline") === "v13"', '"ordynka-offline") === "v1"')
t = sub(t, 'lsSet("simonov-offline", "v13")', 'lsSet("ordynka-offline", "v1")')
t = sub(t, "Симонов монастырь · ${p ? p.title", "Скорбященский храм на Ордынке · ${p ? p.title")
t = sub(t, "`simonov-refoto-", "`ordynka-refoto-")
t = sub(t, 'title: "Симонов монастырь: тогда и сейчас"', 'title: "Скорбященский храм на Ордынке: тогда и сейчас"')
t = sub(t, '"X-Client-Id": "simonov-excursion.github.io"', '"X-Client-Id": "simonov-excursion.github.io/ordynka"')
t = sub(t, "const RADIUS = 25;", "const RADIUS = 22;")

# файлы для офлайна: тексты озвучки тоже
t = sub(t, "      files.add(p.script);\n", "      files.add(p.script);\n      if (p.ttsScript) files.add(p.ttsScript);\n")
t = sub(t, " Рассказы можно скачать кнопкой на экране маршрута.", "")

# подпись фото: современное фото помечаем честно
t = sub(t, "<p><b>Старое фото.</b> ${esc(ph.year)}.", "<p><b>${ph.modern ? \"Современное фото.\" : \"Старое фото.\"}</b> ${esc(ph.year)}.")
t = sub(t, 'const hints = { then: "Старое фото. Нажмите «Сейчас», чтобы увидеть камеру."',
           'const hints = { then: "Фото. Нажмите «Сейчас», чтобы увидеть камеру."')

# ---------- временный голос (озвучка браузера) ----------
TTS = r'''
/* ---------- Временный голос ----------
   Пока нет записи диктора (audio/*.mp3), рассказ читает озвучка браузера (speechSynthesis, ru-RU).
   Адаптер ведёт себя как <audio>: paused, ended, currentTime, play(), pause() и события play/pause/ended/emptied.
   Благодаря этому вся логика Симонова (кнопка «Начать», пауза, конец рассказа → остановка пройдена) работает без изменений. */
const ttsp = (() => {
  const et = new EventTarget();
  const s = { chunks: [], idx: 0, speaking: false, ended: false, paused: true, token: 0, loading: null, startOnLoad: false };
  const sy = () => ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") ? window.speechSynthesis : null;
  const emit = n => et.dispatchEvent(new Event(n));
  function splitChunks(text) {
    const sentences = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) || [];
    const out = [];
    for (let sent of sentences) {
      sent = sent.trim();
      while (sent.length > 200) {
        let cut = sent.lastIndexOf(",", 190);
        if (cut < 60) cut = sent.lastIndexOf(" ", 190);
        if (cut < 1) cut = 190;
        out.push(sent.slice(0, cut + 1).trim());
        sent = sent.slice(cut + 1).trim();
      }
      if (sent) out.push(sent);
    }
    return out;
  }
  function ruVoice() {
    const v = sy() ? sy().getVoices() : [];
    const ru = v.filter(x => /^ru([-_]|$)/i.test(x.lang));
    return ru.find(x => x.localService) || ru[0] || null;
  }
  function speakNext(tok) {
    const syn = sy();
    if (!syn || tok !== s.token || !s.speaking) return;
    if (s.idx >= s.chunks.length) { s.speaking = false; s.paused = true; s.ended = true; emit("ended"); return; }
    const u = new SpeechSynthesisUtterance(s.chunks[s.idx]);
    u.lang = "ru-RU";
    const v = ruVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.onend = () => { if (tok !== s.token || !s.speaking) return; s.idx++; speakNext(tok); };
    u.onerror = e => {
      if (tok !== s.token || (e && (e.error === "canceled" || e.error === "interrupted"))) return;
      s.speaking = false; s.paused = true; emit("pause");
      toast("Голос телефона не смог прочитать рассказ. Прочитайте текст на экране.");
    };
    syn.speak(u);
  }
  // Object.assign превратил бы геттеры в обычные значения, поэтому переносим дескрипторы
  return Object.defineProperties(et, Object.getOwnPropertyDescriptors({
    get paused() { return s.paused; },
    get ended() { return s.ended; },
    get currentTime() { return s.idx * 5; },
    set currentTime(v) { if (v === 0) { s.token++; if (sy()) sy().cancel(); s.speaking = false; s.idx = 0; s.ended = false; s.paused = true; } },
    get available() { return !!sy(); },
    get hasRussianVoice() { return !sy() || !sy().getVoices().length || !!ruVoice(); },
    load(textPromise) {
      this.stop();
      s.chunks = []; s.idx = 0; s.ended = false; s.paused = true;
      const mine = s.loading = Promise.resolve(textPromise).then(txt => { if (s.loading === mine) s.chunks = splitChunks(txt); }).catch(() => {});
      emit("emptied");
    },
    play() {
      const syn = sy();
      if (!syn) { toast("В этом браузере нет озвучки. Прочитайте текст на экране."); return Promise.resolve(); }
      if (s.ended) { s.idx = 0; s.ended = false; }
      const tok = ++s.token;
      s.speaking = true; s.paused = false;
      emit("play"); emit("playing");
      const go = () => {
        if (tok !== s.token) return;
        if (!s.chunks.length) { s.speaking = false; s.paused = true; emit("pause"); toast("Текст рассказа не загрузился. Проверьте интернет."); return; }
        if (!this.hasRussianVoice) toast("На телефоне нет русского голоса. Его можно добавить в настройках, или дождитесь записи диктора.");
        if (syn.speaking || syn.pending) { syn.cancel(); setTimeout(() => speakNext(tok), 80); } else speakNext(tok);
      };
      if (s.chunks.length) go(); else { try { syn.speak(new SpeechSynthesisUtterance("")); } catch {} s.loading.then(go); }
      return Promise.resolve();
    },
    pause() {
      if (s.paused && !s.speaking) return;
      s.token++; s.speaking = false; s.paused = true;
      if (sy()) sy().cancel();
      emit("pause");
    },
    stop() { s.token++; s.speaking = false; s.paused = true; if (sy()) sy().cancel(); },
  }));
})();
/* текущий «плеер»: озвучка браузера, пока у точки нет mp3 */
function pl() { return narr.tts ? ttsp : $("#player"); }
'''
t = sub(t, "/* Порядок источников: без сети сначала локальный", TTS + "\n/* Порядок источников: без сети сначала локальный")

# loadNarration
t = sub(t, '''  audio.src = narr.sources[0] || "";
  audio.load();
  audio.playbackRate = state.rate;
}''', '''  narr.tts = !narr.sources.length;
  $("#tts-note").classList.toggle("hidden", !narr.tts);
  audio.classList.toggle("hidden", narr.tts);
  ttsp.stop();
  if (narr.tts) {
    audio.removeAttribute("src");
    audio.load();
    ttsp.load(fetch(p.ttsScript || p.script).then(r => r.ok ? r.text() : ""));
    return;
  }
  audio.src = narr.sources[0];
  audio.load();
  audio.playbackRate = state.rate;
}''')
t = sub(t, '''function startNarration() {
  const audio = $("#player");
  narr.wantPlay = true;''', '''function startNarration() {
  if (narr.tts) { narr.wantPlay = true; ttsp.play(); return; }
  const audio = $("#player");
  narr.wantPlay = true;''')
t = sub(t, '''  const player = $("#player");
  const ended = !!player.ended;''', '''  const ended = !!pl().ended;''')
t = sub(t, '''  narr.wantPlay = false;
  a.pause();
}''', '''  narr.wantPlay = false;
  a.pause();
  ttsp.pause();
}''')
t = sub(t, '''function closePoint() {
  $("#player").pause();''', '''function closePoint() {
  stopNarrationNow();''')
t = sub(t, '''  const audio = $("#player");
  try { audio.currentTime = 0; } catch {}
  startNarration();''', '''  try { pl().currentTime = 0; } catch {}
  startNarration();''')
# камера: пауза/продолжение рассказа
t = sub(t, '''  const player = $("#player");
  const wasPlaying = !player.paused && !player.ended;''', '''  const player = pl();
  const wasPlaying = !player.paused && !player.ended;''')
# reloadWhenIdle
t = sub(t, '''    const pl = $("#player");
    if (pl && !pl.paused && !pl.ended) { pl.addEventListener("pause", reloadWhenIdle, { once: true }); pl.addEventListener("ended", reloadWhenIdle, { once: true }); return; }''',
 '''    const cur = pl();
    if (cur && !cur.paused && !cur.ended) { cur.addEventListener("pause", reloadWhenIdle, { once: true }); cur.addEventListener("ended", reloadWhenIdle, { once: true }); return; }''')

# main: кнопка и события
old_main = t[t.index('  const player = $("#player");\n  const playBtn = $("#btn-play");'):t.index('  $("#btn-offline-audio").addEventListener("click", downloadAudioOffline);')]
new_main = '''  const playBtn = $("#btn-play");
  const setPlayLabel = () => {
    const player = pl();
    playBtn.textContent = !player.paused && !player.ended ? "Пауза" : (player.ended ? "Повторить рассказ" : (player.currentTime > 1 ? "Продолжить" : "Начать рассказ"));
    playBtn.classList.toggle("playing", !player.paused && !player.ended);
  };
  playBtn.addEventListener("click", () => {
    const player = pl();
    if (player.paused || player.ended) { if (player.ended) { try { player.currentTime = 0; } catch {} } startNarration(); }
    else { narr.wantPlay = false; clearTimeout(narr.timer); player.pause(); }
  });
  const onEnded = () => {
    narr.wantPlay = false;
    clearTimeout(narr.timer);
    setPlayLabel();
    updatePointNav();
    // решение владельца: остановка отмечается пройденной сама по окончании рассказа, навигация переходит к следующей.
    // Следующий рассказ сам НЕ включается: человек ещё идёт, звук запускается кнопкой «Начать рассказ» или «Я на месте».
    if (state.currentId) {
      const id = state.currentId;
      markVisited(id);
      $("#btn-done").textContent = "Остановка пройдена ✓";
      $("#btn-done").disabled = true;
      const nx = state.data.points[nextUnvisitedIndex()];
      toast(nx ? `Остановка пройдена. Дальше: ${nx.num}. ${nx.title}` : "Остановка пройдена. Это была последняя.");
    }
  };
  for (const el of [$("#player"), ttsp]) {
    const mine = () => pl() === el;
    el.addEventListener("play", () => { if (mine()) setPlayLabel(); });
    el.addEventListener("playing", () => { if (!mine()) return; clearTimeout(narr.timer); setPlayLabel(); });
    el.addEventListener("pause", () => { if (!mine()) return; if (!el.ended) narr.wantPlay = false; setPlayLabel(); });
    el.addEventListener("play", () => { if (mine() && state.currentId) updatePointNav(); });
    el.addEventListener("emptied", () => { if (mine()) setPlayLabel(); });
    el.addEventListener("ended", () => { if (mine()) onEnded(); });
  }
  $("#player").addEventListener("error", onNarrationError);
  $("#player").addEventListener("loadedmetadata", () => { $("#player").playbackRate = state.rate; });
  if (!audioFiles().length) {
    $(".offline-audio").classList.add("hidden");
    $("#offline-audio-none").classList.remove("hidden");
  }
'''
t = t.replace(old_main, new_main)
(B / "js" / "app.js").write_text(t, encoding="utf-8")

print("app.js ok")

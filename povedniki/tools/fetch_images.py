#!/usr/bin/env python3
"""Скачивает отобранные файлы Викисклада (≤1600 px по ширине) в img/then, img/now и делает миниатюры 320 px в img/thumbs.
Список файлов — PHOTOS ниже. Запуск из папки povedniki: python3 tools/fetch_images.py"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "povedniki-excursion/1.0 (https://vlk2017.github.io/simonov-excursion/povedniki/)"}

# local -> файл на Викискладе
PHOTOS = {
  "then/canal-1932-37-prisoners.jpg": "File:Kanal Moskva Volga Gulag.jpg",
  "now/aerial-2024.jpg": "File:Povedniki 2024-09-21 3857.jpg",
  "now/church-2021.jpg": "File:Церковь Новомучеников и исповедников Российских в Поведниках.jpg",
  "now/klyazma-pansionat-2014.jpg": "File:Mytishchinsky District, Moscow Oblast, Russia - panoramio (19).jpg",
  "now/alley-2014.jpg": "File:Mytishchinsky District, Moscow Oblast, Russia - panoramio (15).jpg",
  "now/reservoir-2014.jpg": "File:Mytishchinsky District, Moscow Oblast, Russia - panoramio (17).jpg",
  "now/troitskoe-canal-2013.jpg": "File:Троицкое с канала.jpg",
  "now/troitskoe-2011.jpg": "File:Троицкая церковь с КиМа.jpg",
  "now/chiverevo-2013.jpg": "File:Часовня в Чиверево.jpg",
  "now/chiverevo-2017.jpg": "File:Часовня Смоленской иконы Божией Матери в Чиверево.jpg",
}

def api(**p):
    p["format"] = "json"
    req = urllib.request.Request("https://commons.wikimedia.org/w/api.php", data=urllib.parse.urlencode(p).encode(), headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))

def main():
    meta = {}
    for rel, title in PHOTOS.items():
        out = B / "img" / rel
        d = api(action="query", titles=title, prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=1600,
                iiextmetadatafilter="DateTimeOriginal|Artist|LicenseShortName|ImageDescription")
        ii = list(d["query"]["pages"].values())[0]["imageinfo"][0]
        em = ii["extmetadata"]; g = lambda k: re.sub(r"<[^>]+>", "", em.get(k, {}).get("value", "")).strip()
        meta[rel] = dict(title=title, width=ii["width"], height=ii["height"], date=g("DateTimeOriginal"), artist=g("Artist"), license=g("LicenseShortName"))
        if not out.exists():
            url = ii["thumburl"] if ii["width"] > 1600 else ii["url"]
            for _ in range(5):
                try:
                    out.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()); break
                except Exception as e:
                    time.sleep(3)
            im = Image.open(out).convert("RGB")
            if im.width > 1600: im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
            im.save(out, "JPEG", quality=84, optimize=True)
        im = Image.open(out).convert("RGB")
        th = B / "img" / "thumbs" / (Path(rel).stem + ("-now" if rel.startswith("now/") else "") + ".jpg")
        t = im.copy(); t.thumbnail((320, 320)); t.save(th, "JPEG", quality=80, optimize=True)
        print(rel, im.size, meta[rel]["license"], meta[rel]["artist"][:30])
    (B / "tools" / "commons_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()

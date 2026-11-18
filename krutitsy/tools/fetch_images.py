#!/usr/bin/env python3
"""Скачивает отобранные файлы Викисклада (≤1600 px по ширине) в img/then, img/now и делает миниатюры 320 px в img/thumbs.
Список файлов — PHOTOS ниже. Запуск из папки krutitsy: python3 tools/fetch_images.py"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "krutitsy-excursion/1.0 (https://vlk2017.github.io/simonov-excursion/krutitsy/)"}

# local -> файл на Викискладе
PHOTOS = {
  "then/bondarenko-1909-terem.jpg": "File:Крутицкий теремок, 1909 год.jpg",
  "then/loc-photochrom-vorota.jpg": "File:Moscou. La Porte Krutitzki LOC ppmsca.52727.jpg",
  "then/naidenov-1884-terem.jpg": "File:Москва. img284 Крутицкий терем (и Св.ворота) НайдёновНА1884.jpg",
  "then/naidenov-1882-sobor.jpg": "File:Krutitsy Patriarchal Metochion 00.jpg",
  "then/volkov-1900-nadgrobiya.jpg": "File:Krutitsy tombs.jpg",
  "then/album-1913-kazarmy.jpg": "File:Municipal Album 1.194 Krutitsy.jpg",
  "now/street-2015.jpg": "File:Крутицкое подворье 2015.jpg",
  "now/terem-north-2014.jpg": "File:Подворье Крутицкое 25.JPG",
  "now/terem-gate-2026.jpg": "File:Krutitskoe-podvorje-010.jpg",
  "now/gate-closeup-2026.jpg": "File:Ворота Крутицкого подворья Москва 2026 01.jpg",
  "now/gate-fresco-2014.jpg": "File:Фрагмент росписи Парадных (святых) врат Крутицкое подворье Москва.JPG",
  "now/baranovsky-plaque-2011.jpg": "File:Krutitskoe podvorie by shakko 16.jpg",
  "now/vosk-north-2024.jpg": "File:Moscow - Krutitskaya 17s2 - 2024-12-21 - p1.jpg",
  "now/vosk-south-2019.jpg": "File:Крутицкое подворье, Воскресенская церковь, южный фасад.jpg",
  "now/palaty-2023.jpg": "File:Moscow. Krutitsy Metochion. Metropolitan's Chamber P5172958 2600.jpg",
  "now/palaty-2026.jpg": "File:Krutitskoe-podvorje-016.jpg",
  "now/prikaz-2024.jpg": "File:Moscow - Krutitskaya 17с6 - 2024-12-21 - p3.jpg",
  "now/prikaz-2024b.jpg": "File:Moscow - Krutitskaya 17с6 - 2024-12-21 - p4.jpg",
  "now/uspensky-2015.jpg": "File:Цветущий сад в Крутицком подворье.jpg",
  "now/uspensky-2026.jpg": "File:Соборная церковь Успения с шатровой колокольней Крутицкого подворья Москва 2026 01.jpg",
  "now/belltower-2017.jpg": "File:Moscow KrutitskyBellTower Y50h.jpg",
  "now/ne-tower-2017.jpg": "File:Moscow Krutitsy NETower 9026.jpg",
  "now/ne-tower-2026.jpg": "File:North-Eastern Tower of the Krutitsy in Moscow (view from the north).jpg",
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

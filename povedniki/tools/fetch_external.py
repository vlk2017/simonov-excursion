#!/usr/bin/env python3
"""Скачивает внешние снимки из tools/photo_registry.py (PastVu, Sobory.ru, Яндекс Карты, сайты) в img/then и img/now (длинная сторона не больше 1600 px)
и делает миниатюры 320 px в img/thumbs. Плашки и подписи на снимках не трогаем. Файлы Викисклада качает tools/fetch_images.py.
Запуск из папки povedniki: python3 tools/fetch_external.py"""
import io, sys, time, urllib.request
from pathlib import Path
from PIL import Image
B = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(B / "tools"))
from photo_registry import REG  # noqa: E402
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

def thumb_path(rel):
    stem = Path(rel).stem
    return B / "img" / "thumbs" / (stem + ("-now" if rel.startswith("now/") else "") + ".jpg")

def main():
    for r in REG:
        out = B / "img" / r["file"]
        if "fetch" in r and not out.exists():
            ref = r["card"].split("/maps/")[0] + "/" if "yandex" in r["card"] else r["card"]
            for k in range(4):
                try:
                    data = urllib.request.urlopen(urllib.request.Request(r["fetch"], headers={"User-Agent": UA, "Referer": ref}), timeout=90).read(); break
                except Exception as e:
                    print("retry", r["id"], e); time.sleep(3)
            else:
                raise SystemExit("не скачалось: " + r["id"])
            im = Image.open(io.BytesIO(data)).convert("RGB")
            k = 1600 / max(im.size)
            if k < 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            out.parent.mkdir(parents=True, exist_ok=True)
            im.save(out, "JPEG", quality=82, optimize=True)
        if not out.exists(): raise SystemExit("нет файла " + r["file"])
        im = Image.open(out).convert("RGB")
        t = im.copy(); t.thumbnail((320, 320)); t.save(thumb_path(r["file"]), "JPEG", quality=80, optimize=True)
        print(r["file"], im.size, out.stat().st_size // 1024, "KB")

if __name__ == "__main__":
    main()

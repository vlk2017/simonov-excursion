#!/usr/bin/env python3
"""Тексты рассказов (scripts/*.txt) -> тексты для синтеза речи (tts/*.txt): годы и даты словами, аббревиатуры по слогам.
Без знаков ударения: их плохо читают браузерные голоса. Используется нормализатор Симонова (../../tools/tts_normalize.py)."""
import re, sys
from pathlib import Path
BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE.parent / "tools"))
from tts_normalize import normalize_numbers  # noqa: E402

REPL = [
    ("«Культура.РФ»", "«Культура точка эр эф»"),
    ("«Соборы.ру»", "«Соборы точка ру»"),
    ("ordynka.com", "ордынка точка ком"),
    ("ВЦИК", "Всероссийский центральный исполнительный комитет"),
    ("НКВД", "эн ка вэ дэ"),
]

def to_tts(text: str) -> str:
    t = normalize_numbers(text)
    for a, b in REPL:
        t = t.replace(a, b)
    t = t.replace("\u0301", "")
    return t

if __name__ == "__main__":
    out_dirs = [BASE / "tts"] + [Path(a) for a in sys.argv[1:]]
    for d in out_dirs:
        d.mkdir(parents=True, exist_ok=True)
    src = sorted((BASE / "scripts").glob("*.txt"))
    for f in src:
        res = to_tts(f.read_text(encoding="utf-8"))
        for d in out_dirs:
            (d / f.name).write_text(res, encoding="utf-8")
        print("ok", f.name, len(res.split()), "слов")

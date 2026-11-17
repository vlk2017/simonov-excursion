#!/usr/bin/env python3
"""Превращает текст рассказа (scripts/*.txt) в текст для синтеза речи (tts/*.txt):
годы и числа -> словами в нужном падеже, ударения -> знак U+0301 после ударной гласной.
Голос edge-tts ru-RU-SvetlanaNeural учитывает U+0301 (проверено: вывод меняется)."""
import re, sys
from pathlib import Path

A = "\u0301"
UNITS_C = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
TEENS_C = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать",
           "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"]
TENS_C = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"]
HUND_C = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"]
UNITS_O = ["", "первый", "второй", "третий", "четвёртый", "пятый", "шестой", "седьмой", "восьмой", "девятый"]
TEENS_O = ["десятый", "одиннадцатый", "двенадцатый", "тринадцатый", "четырнадцатый", "пятнадцатый",
           "шестнадцатый", "семнадцатый", "восемнадцатый", "девятнадцатый"]
TENS_O = ["", "", "двадцатый", "тридцатый", "сороковой", "пятидесятый", "шестидесятый", "семидесятый", "восьмидесятый", "девяностый"]
HUND_O = ["", "сотый", "двухсотый", "трёхсотый", "четырёхсотый", "пятисотый", "шестисотый", "семисотый", "восьмисотый", "девятисотый"]

def decline(word, case):
    """case: nom, gen, prep, ins, pl_nom, pl_gen (=pl_prep)"""
    if word == "третий":
        return {"nom": "третий", "gen": "третьего", "prep": "третьем", "ins": "третьим",
                "pl_nom": "третьи", "pl_gen": "третьих"}[case]
    stem = word[:-2]
    end = {"nom": word[-2:], "gen": "ого", "prep": "ом", "ins": "ым", "pl_nom": "ые", "pl_gen": "ых"}[case]
    return stem + end

def cardinal(n):
    parts = []
    th, n = divmod(n, 1000)
    if th == 1: parts.append("тысяча")
    elif th == 2: parts.append("две тысячи")
    elif th: raise ValueError(th)
    h, n = divmod(n, 100)
    if h: parts.append(HUND_C[h])
    if 10 <= n < 20: parts.append(TEENS_C[n - 10])
    else:
        t, u = divmod(n, 10)
        if t: parts.append(TENS_C[t])
        if u: parts.append(UNITS_C[u])
    return " ".join(parts)

def ordinal(n, case="nom"):
    th, rest = divmod(n, 1000)
    h, r = divmod(rest, 100)
    prefix = []
    if th == 1: prefix.append("тысяча")
    elif th == 2: prefix.append("две тысячи")
    if r == 0:
        last = HUND_O[h] if h else {1: "тысячный", 2: "двухтысячный"}[th]
        if not h: prefix = []
    else:
        if h: prefix.append(HUND_C[h])
        if 10 <= r < 20: last = TEENS_O[r - 10]
        else:
            t, u = divmod(r, 10)
            if u:
                if t: prefix.append(TENS_C[t])
                last = UNITS_O[u]
            else:
                last = TENS_O[t]
    return " ".join(prefix + [decline(last, case)])

def decade(n, case):  # 1630-х -> тысяча шестьсот тридцатых
    return ordinal(n, case)

DAY_GEN = {i: ordinal(i, "gen") for i in range(1, 32)}

def normalize_numbers(s):
    # специальные случаи
    s = s.replace("и 1918, и 1920, и 1923 год", "и тысяча девятьсот восемнадцатый, и девятьсот двадцатый, и девятьсот двадцать третий год")
    s = re.sub(r"\b(дом|доме) (\d+)", lambda m: m.group(1) + " " + cardinal(int(m.group(2))), s)
    s = re.sub(r"\b(\d{1,2}) (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)",
               lambda m: DAY_GEN[int(m.group(1))] + " " + m.group(2), s)
    # 1630–1640-х годах / годов
    def rng_pl(m):
        pre = m.group(1) or ""
        case = "pl_gen"
        return f"{pre}{decade(int(m.group(2)), case)} — {decade(int(m.group(3)), case)}"
    s = re.sub(r"(\b[вВ] |)(\d{4})–(\d{4})-х", rng_pl, s)
    # 1677–1680 годах (предложный), 1920–1923 годов (родительный), 1930–1932 годах
    s = re.sub(r"(\d{4})–(\d{4}) годах", lambda m: f"{ordinal(int(m.group(1)),'prep')} — {ordinal(int(m.group(2)),'prep')} годах", s)
    s = re.sub(r"(\d{4})–(\d{4}) годов", lambda m: f"{ordinal(int(m.group(1)),'gen')} — {ordinal(int(m.group(2)),'gen')} годов", s)
    # с 1835 по 1839 год
    s = re.sub(r"с (\d{4}) по (\d{4}) год", lambda m: f"с {ordinal(int(m.group(1)),'gen')} по {ordinal(int(m.group(2)),'nom')} год", s)
    # десятилетия: в 1680-х -> предложный; иначе родительный
    s = re.sub(r"(\b[вВ] )(\d{4})-х", lambda m: m.group(1) + decade(int(m.group(2)), "pl_gen"), s)
    s = re.sub(r"(\d{4})-х", lambda m: decade(int(m.group(1)), "pl_gen"), s)
    # 1363-го, 1889-го
    s = re.sub(r"(\d{4})-го", lambda m: ordinal(int(m.group(1)), "gen"), s)
    s = re.sub(r"(\d{4}) году", lambda m: ordinal(int(m.group(1)), "prep") + " году", s)
    s = re.sub(r"(\d{4}) года", lambda m: ordinal(int(m.group(1)), "gen") + " года", s)
    s = re.sub(r"(\d{4}) годом", lambda m: ordinal(int(m.group(1)), "ins") + " годом", s)
    s = re.sub(r"(\d{4}) год\b", lambda m: ordinal(int(m.group(1)), "nom") + " год", s)
    if re.search(r"\d", s):
        raise SystemExit("Остались цифры: " + "; ".join(re.findall(r".{0,30}\d+.{0,30}", s)))
    return s

# Ударения и произношение. Ключ — регулярное выражение по началу слова.
STRESS = [
    (r"\bДуло\b", "Ду́ло"),
    (r"\bОсляб", "Осля́б"),
    (r"\bПересвет", "Пересве́т"),
    (r"\bСолев", "Соле́в"),
    (r"\bКузнечн", "Кузне́чн"),
    (r"\bТайницк", "Тайни́цк"),
    (r"\bТайнинск", "Тайни́нск"),
    (r"\bСушил", "Суши́л"),
    (r"\bсолодежн", "солоде́жн"),
    (r"\bпрясл", "пря́сл"),
    (r"\bвзвоз", "взво́з"),
    (r"\bВылазн", "Вы́лазн"),
    (r"\bвылазн", "вы́лазн"),
    (r"\bТона\b", "То́на"),
    (r"\bБюро\b", "Бюро́"),
    (r"\bБарщевск", "Барще́вск"),
    (r"\bЗИЛ\b", "Зил"),
    (r"\bЗИЛа\b", "Зи́ла"),
    (r"\bВеневитинов", "Веневи́тинов"),
    (r"\bГеркуланум", "Геркула́нум"),
    (r"\bМицкевич", "Мицке́вич"),
    (r"\bВеснин", "Ве́снин"),
    (r"\bБекбулатович", "Бекбула́тович"),
    (r"\bкасимовск", "каси́мовск"),
    (r"\bДевлет-Гирей", "Девле́т-Гирей"),
    (r"\bКазы-Гире", "Казы́-Гире"),
    (r"\bБолотников", "Боло́тников"),
    (r"\bГорсей", "Го́рсей"),
    (r"\bГеронти", "Геро́нти"),
    (r"\bПреполовени", "Преполове́ни"),
    (r"\bКожухов", "Кожу́хов"),
    (r"\bФиораванти", "Фиорава́нти"),
    (r"\bИгнатьев", "Игна́тьев"),
    (r"\bТюрин", "Тю́рин"),
    (r"\bАлябьев", "Аля́бьев"),
    (r"\bБахрушин", "Бахру́шин"),
    (r"\bТромонин", "Тромо́нин"),
    (r"\bСамойлович", "Самойло́вич"),
    (r"\bСтарцев", "Ста́рцев"),
    (r"\bСергиев", "Се́ргиев"),
    (r"\bАксаков", "Акса́ков"),
    (r"\bВолконск", "Волко́нск"),
    (r"\bХомяков", "Хомяко́в"),
    (r"\bНоводевичь", "Новоде́вичь"),
    (r"\bНовоспасск", "Новоспа́сск"),
    (r"\bТихвинск", "Ти́хвинск"),
    (r"\bКарамзин", "Карамзи́н"),
    (r"\bЭрастов", "Эра́стов"),
    (r"\bХоврин", "Хо́врин"),
    (r"\bБарановск", "Барано́вск"),
    (r"\bпосты\b", "посты́"),
    (r"\bверсты\b", "версты́"),
    (r"\bсурдоперевод", "сурдоперево́д"),
    (r"\bАрхнадзор", "Архнадзо́р"),
    (r"\bКирилл\b", "Кири́лл"),
    (r"\bИона\b", "Ио́на"),
    (r"\bСимеон", "Симео́н"),
    (r"\bграмотах", "гра́мотах"),
]

def add_stress(s):
    for pat, rep in STRESS:
        s = re.sub(pat, rep, s)
    # «…» в «Си…нова» читается как пауза — оставляем полное слово для слуха
    s = s.replace("Си…нова", "Си́монова")
    s = s.replace("Си…", "Си")
    # знак ударения перед «й» edge-tts читает как «и краткое» — убираем
    s = re.sub("\u0301(?=[йЙ])", "", s)
    return s

def to_tts(text):
    t = normalize_numbers(text)
    t = add_stress(t)
    t = t.replace("—", ",").replace("–", ",")
    t = re.sub(r"\s+,", ",", t)
    t = re.sub(r",\s*,", ",", t)
    return t

if __name__ == "__main__":
    base = Path(__file__).resolve().parent.parent
    (base / "tts").mkdir(exist_ok=True)
    for f in sorted((base / "scripts").glob("*.txt")):
        out = base / "tts" / f.name
        out.write_text(to_tts(f.read_text(encoding="utf-8")), encoding="utf-8")
        print("ok", out.name)

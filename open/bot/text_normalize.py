"""Croatian text normalization before CPU speech synthesis.

num2words has no Croatian, so numbers, dates, times, euros and the units used in summary_hr
templates are spelled out with simple rules: "5. siječnja 2027." -> "petog siječnja dvije tisuće
dvadeset sedme", "1,29 eura" -> "jedan euro i dvadeset devet centi", "09:30" -> "devet i
trideset", "oko 341 km" -> "oko tristo četrdeset jedan kilometar". summary_hr itself stays the
same for both profiles; only the speech text changes.
"""

import re

_ONES = ["nula", "jedan", "dva", "tri", "četiri", "pet", "šest", "sedam", "osam", "devet"]
_TEENS = [
    "deset",
    "jedanaest",
    "dvanaest",
    "trinaest",
    "četrnaest",
    "petnaest",
    "šesnaest",
    "sedamnaest",
    "osamnaest",
    "devetnaest",
]
_TENS = [
    "",
    "",
    "dvadeset",
    "trideset",
    "četrdeset",
    "pedeset",
    "šezdeset",
    "sedamdeset",
    "osamdeset",
    "devedeset",
]
_HUNDREDS = [
    "",
    "sto",
    "dvjesto",
    "tristo",
    "četiristo",
    "petsto",
    "šesto",
    "sedamsto",
    "osamsto",
    "devetsto",
]


def _under_thousand(n: int) -> list[str]:
    words = []
    h, rest = divmod(n, 100)
    if h:
        words.append(_HUNDREDS[h])
    if 10 <= rest < 20:
        words.append(_TEENS[rest - 10])
    else:
        t, o = divmod(rest, 10)
        if t:
            words.append(_TENS[t])
        if o:
            words.append(_ONES[o])
    return words


def number_words(n: int) -> str:
    """Cardinal number in Croatian (masculine), 0 to 999 999; larger ones digit by digit."""
    if n < 0:
        return "minus " + number_words(-n)
    if n == 0:
        return _ONES[0]
    if n >= 1_000_000:
        return " ".join(_ONES[int(d)] for d in str(n))
    thousands, rest = divmod(n, 1000)
    words: list[str] = []
    if thousands:
        if thousands == 1:
            words.append("tisuću")
        else:
            prefix = _under_thousand(thousands)
            last = thousands % 100
            if prefix and prefix[-1] == "dva" and not 10 <= last < 20:
                prefix[-1] = "dvije"
            if prefix and prefix[-1] == "jedan" and not 10 <= last < 20:
                prefix[-1] = "jedna"
            words += prefix
            words.append("tisuće" if last % 10 in (2, 3, 4) and not 10 <= last < 20 else "tisuća")
    words += _under_thousand(rest)
    return " ".join(words)


def feminine_words(n: int) -> str:
    """Before a feminine noun: 'jedna ustanova', 'dvije ustanove', 'dvadeset jedna'."""
    words = number_words(n).split()
    if n % 100 not in range(10, 20) and words:
        words[-1] = {"jedan": "jedna", "dva": "dvije"}.get(words[-1], words[-1])
    return " ".join(words)


def _plural(n: int, one: str, few: str, many: str) -> str:
    """Croatian count agreement: 1 kilometar, 2–4 kilometra, 5+ kilometara (11–14 -> many)."""
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return few
    return many


_UNITS = [
    (r"km\b", ("kilometar", "kilometra", "kilometara")),
    (r"%", ("posto", "posto", "posto")),
]

_ORDINAL_STEMS = [
    "",
    "prv",
    "drug",
    "treć",
    "četvrt",
    "pet",
    "šest",
    "sedm",
    "osm",
    "devet",
    "deset",
    "jedanaest",
    "dvanaest",
    "trinaest",
    "četrnaest",
    "petnaest",
    "šesnaest",
    "sedamnaest",
    "osamnaest",
    "devetnaest",
]
_MONTHS = (
    "siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|"
    "studenoga|prosinca"
)
# Abbreviations in the summaries, as said aloud.
_SPOKEN = [
    (r"\bHZZO\b", "ha ze ze o"),
    (r"\bHALMED\b", "Halmed"),
    (r"\bCEZIH\b", "Cezih"),
    (r"\bMR\b", "em er"),
    (r"\bCT\b", "ce te"),
    (r"\bUZV\b", "ultrazvuk"),
    (r"\bEKG\b", "e ka ge"),
]


def _ordinal_stem(n: int) -> str:
    """1 -> 'prv', 21 -> 'dvadeset prv', 30 -> 'trideset' (1 to 99)."""
    if n < 20:
        return _ORDINAL_STEMS[n]
    tens, ones = divmod(n, 10)
    return f"{_TENS[tens]} {_ORDINAL_STEMS[ones]}" if ones else _TENS[tens]


def day_ordinal(n: int) -> str:
    """Day of the month in the genitive: 5 -> 'petog', 21 -> 'dvadeset prvog', 3 -> 'trećeg'
    (a soft stem takes -eg)."""
    stem = _ordinal_stem(n)
    return stem + ("eg" if stem.endswith("ć") else "og")


def year_ordinal(n: int) -> str:
    """Year in the genitive (godine): 2027 -> 'dvije tisuće dvadeset sedme'."""
    thousands, rest = divmod(n, 100)
    head = number_words(thousands * 100)
    if not rest:  # round years do not occur in the summaries; say the number
        return head
    return f"{head} {_ordinal_stem(rest)}e"


def _euros(whole: int, cents: int) -> str:
    out = f"{number_words(whole)} {_plural(whole, 'euro', 'eura', 'eura')}"
    if cents:
        out += f" i {number_words(cents)} {_plural(cents, 'cent', 'centa', 'centi')}"
    return out


def _decimal(int_part: str, frac: str) -> str:
    return f"{number_words(int(int_part))} zarez {' '.join(_ONES[int(d)] for d in frac)}"


# Telephone numbers as the lists print them ("+385 31 511 511", "031/511-511", "035/386 700"):
# digit by digit, a pause between the groups. They go first, before the rules below would read
# "511-511" as a range or "031" as thirty-one. A number has an area code and at least two more
# groups, so hours ("07-15 h", "08:00-16:00") and dates ("2026-01-05") are left to the rules
# below; a comma after a number ends it, a comma between digits (a decimal) does not.
_PHONE = re.compile(
    r"(?<![\d,.:/-])(?:\+385[ /-]*\d{1,2}|0\d{1,2})(?:[ /-]+\d{2,4}){2,3}(?!\d|,\d)"
)


def _phone(m: re.Match[str]) -> str:
    out: list[str] = []
    plus = False
    for part in re.findall(r"\+|\d+", m.group(0)):
        if part == "+":
            plus = True
            continue
        digits = " ".join(_ONES[int(d)] for d in part)
        out.append(f"plus {digits}" if plus else digits)
        plus = False
    return ", ".join(out)


def normalize(text: str) -> str:
    text = _PHONE.sub(_phone, text)
    for pattern, spoken in _SPOKEN:
        text = re.sub(pattern, spoken, text)

    # Dates "5. siječnja 2027." and "6. studenoga" (the day and year are ordinals). The year's
    # full stop may also end the sentence: it stays unless the sentence goes on ("2027., za 70
    # dana", "2027. u 08:30").
    def date(m: re.Match[str]) -> str:
        out = f"{day_ordinal(int(m.group(1)))} {m.group(2)}"
        if m.group(3):
            out += f" {year_ordinal(int(m.group(3)))}"
            if not re.match(r"[,:;]|\s+[a-zčćđšž]", m.string[m.end() :]):
                out += "."
        return out

    text = re.sub(rf"\b(\d{{1,2}})\. ({_MONTHS})(?: (\d{{4}})\.)?", date, text)

    # Short dates "(29. 10.)" in the stale-data note: "dvadeset devetog desetog". The month's
    # full stop stays only where it ends the sentence.
    def short_date(m: re.Match[str]) -> str:
        day, month = int(m.group(1)), int(m.group(2))
        if not (1 <= day <= 31 and 1 <= month <= 12):
            return m.group(0)
        out = f"{day_ordinal(day)} {day_ordinal(month)}"
        if not re.match(r"[,:;)]|\s+[a-zčćđšž]", m.string[m.end() :]):
            out += "."
        return out

    text = re.sub(r"\b(\d{1,2})\. (\d{1,2})\.", short_date, text)
    # Euros: "1,29 eura", "od 1,29 do 1,82 eura" (cents only when not zero).
    text = re.sub(
        r"\b(\d+),(\d{2})(?= do \d+,\d{2} eura)",
        lambda m: _euros(int(m.group(1)), int(m.group(2))),
        text,
    )
    text = re.sub(
        r"\b(\d+),(\d{2}) (?:eura|€)",
        lambda m: _euros(int(m.group(1)), int(m.group(2))),
        text,
    )
    # Ranges "2-3 dana" -> "dva do tri dana".
    text = re.sub(
        r"\b(\d+)\s*[-–]\s*(\d+)\b",
        lambda m: f"{number_words(int(m.group(1)))} do {number_words(int(m.group(2)))}",
        text,
    )
    # Units after a number: "oko 341 km", "1,5 km", "40 %".
    for pattern, forms in _UNITS:

        def unit(m: re.Match[str], forms: tuple[str, str, str] = forms) -> str:
            whole, frac = m.group(1), m.group(2)
            if frac:  # a decimal takes the genitive plural: "jedan zarez pet kilometara"
                return f"{_decimal(whole.lstrip('-'), frac)} {forms[2]}"
            n = int(whole)
            return f"{number_words(n)} {_plural(n, *forms)}"

        text = re.sub(rf"(-?\d+)(?:,(\d+))?\s*{pattern}", unit, text)
    # Counts of feminine nouns: "2 ustanove" -> "dvije ustanove", "21 ordinacija".
    text = re.sub(
        r"\b(\d+)(?= (?:ustanov|ordinacij|bolnic|ambulant|poliklinik))",
        lambda m: feminine_words(int(m.group(1))),
        text,
    )
    # Times "17:30" -> "sedamnaest i trideset", "09:00" -> "devet".
    text = re.sub(
        r"\b(\d{1,2}):(\d{2})\b",
        lambda m: (
            number_words(int(m.group(1)))
            + ("" if m.group(2) == "00" else f" i {number_words(int(m.group(2)))}")
        ),
        text,
    )
    # Decimals with a comma: "1,8" -> "jedan zarez osam".
    text = re.sub(r"\b(\d+),(\d+)\b", lambda m: _decimal(m.group(1), m.group(2)), text)
    # Emergency numbers (112, 192–195) are read digit by digit.
    text = re.sub(r"\b(112|19[2-5])\b", lambda m: " ".join(_ONES[int(d)] for d in m.group(1)), text)
    # Remaining integers.
    return re.sub(r"-?\b\d+\b", lambda m: number_words(int(m.group(0))), text)

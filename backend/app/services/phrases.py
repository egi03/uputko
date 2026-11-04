"""Croatian phrases for deterministic summary_hr templates (no LLM)."""

from datetime import date

WEEKDAY = ["ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota", "nedjelja"]
MONTH_GENITIVE = [
    "siječnja",
    "veljače",
    "ožujka",
    "travnja",
    "svibnja",
    "lipnja",
    "srpnja",
    "kolovoza",
    "rujna",
    "listopada",
    "studenoga",
    "prosinca",
]


def date_hr(d: date, *, weekday: bool = True) -> str:
    """'srijeda, 28. listopada 2026.': ready to say, so the LLM never works out weekdays."""
    text = f"{d.day}. {MONTH_GENITIVE[d.month - 1]} {d.year}."
    return f"{WEEKDAY[d.weekday()]}, {text}" if weekday else text


def short_place_name(name: str) -> str:
    """'Novigrad – Cittanova' -> 'Novigrad' (first part of a bilingual name)."""
    return name.partition(" – ")[0].strip()


def county_locative(county: str) -> str:
    """'Istarska' -> 'Istarskoj županiji'; 'Grad Zagreb' -> 'Gradu Zagrebu'."""
    if county == "Grad Zagreb":
        return "Gradu Zagrebu"
    return f"{county[:-1]}oj županiji" if county.endswith("a") else f"županiji {county}"


def number(value: float, decimals: int = 0) -> str:
    """Croatian number format: 1.8 -> '1,8'; -2.0 -> '-2'."""
    text = f"{value:.{decimals}f}" if decimals else str(round(value))
    return text.replace(".", ",")


def plural(n: int, one: str, few: str, many: str) -> str:
    """Croatian count agreement: 1 dan, 2–4 dana, 5+ dana (21 dan, 12 dana)."""
    if n % 10 == 1 and n % 100 != 11:
        return one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return few
    return many


def join_or(options: list[str]) -> str:
    """The options of a question: 'a', 'a ili b', 'a, b ili c'."""
    return ", ".join(options[:-1]) + f" ili {options[-1]}" if len(options) > 1 else options[0]


def join_sentences(sentences: list[str]) -> str:
    """One summary; a sentence ending in a date ('28. listopada 2026.') keeps one full stop."""
    return " ".join(s.replace("..", ".") if s.endswith("..") else s for s in sentences)

"""Name normalization and light Croatian case stripping for place matching."""

import re
import unicodedata

_TRANSLIT = str.maketrans({"đ": "dj", "Đ": "dj", "ß": "ss"})
# Leading filler words only: "Grad Zagreb", "Općina Čepin", "kod nas u Nuštru" (not "Stari Grad").
_LEADING_FILLER = {
    "grad",
    "opcina",
    "opc",
    "naselje",
    "mjesto",
    "u",
    "kod",
    "nas",
    "na",
    "za",
    "iz",
}
_ABBREVIATIONS = {"sv": "sveti", "sv.": "sveti"}
# Longest endings first. Covers the common oblique cases of place names
# (Vinkovcima, Osijeku, Nuštru, Županji, Zagrebom, Splitom, ...).
_ENDINGS = ("ima", "ama", "oga", "ome", "emu", "om", "em", "ih", "oj", "u", "a", "e", "i", "o")
_MIN_STEM = 3


def strip_diacritics(text: str) -> str:
    text = text.translate(_TRANSLIT)
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def normalize(text: str, *, drop_words: bool = True) -> str:
    """Lowercase, no diacritics, no punctuation, no 'grad'/'općina'."""
    text = strip_diacritics(text.lower())
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    text = text.replace("-", " ")
    words = [_ABBREVIATIONS.get(w, w) for w in text.split()]
    if drop_words:
        while len(words) > 1 and words[0] in _LEADING_FILLER:
            words = words[1:]
    return " ".join(words)


def name_variants(name: str) -> list[str]:
    """Bilingual DZS names ('Umag – Umago') are matched by each part and as a whole."""
    parts = [p.strip() for p in re.split(r"\s+[–-]\s+", name) if p.strip()]
    return list(dict.fromkeys([name, *parts]))


def _stem_word(word: str) -> str:
    for ending in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= _MIN_STEM:
            return word[: -len(ending)]
    return word


def _drop_fleeting_a(word: str) -> str:
    """Nuštar -> nuštr, Sisak -> sisk, Karlovac -> karlovc (nepostojano a)."""
    if len(word) >= 5 and word[-2] == "a" and word[-1] not in "aeiou" and word[-3] not in "aeiou":
        return word[:-2] + word[-1]
    return word


_SIBILARIZATION = {"c": "k", "z": "g", "s": "h"}  # Rijeci -> Rijeka, Pragu/Prazi


def _word_variants(word: str) -> set[str]:
    options = {_stem_word(word), _stem_word(_drop_fleeting_a(word)), _drop_fleeting_a(word)}
    return options | {
        stem[:-1] + _SIBILARIZATION[stem[-1]]
        for stem in options
        if stem and stem[-1] in _SIBILARIZATION and len(stem) > _MIN_STEM
    }


def stems(text_norm: str) -> set[str]:
    """Possible stems of a normalized name; two names match if their stem sets overlap."""
    words = text_norm.split()
    if not words:
        return set()
    # Combinations of per-word variants; names have few words so this stays small.
    results = [""]
    for w in words:
        opts = sorted(_word_variants(w))
        results = [f"{r} {o}".strip() for r in results for o in opts]
    return set(results)

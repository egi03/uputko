"""Which form of a medicine an HZZO list row is: its strength and its dosage form.

HZZO lists packages ("Normabel", "tbl. 30x10 mg"); HALMED authorises forms ("Normabel 10 mg
tablete", "Normabel 10 mg/2 ml otopina za injekciju"). The protected name and the ATC code say
which medicine a row is (drugs_jobs.join_lists); this module says which of its forms. A row goes
to the forms of a compatible dosage form (tablets are never an injection) whose strengths agree
with it best; the words of HZZO's abbreviations ("tbl. s prod. oslob.", "mast", "štrc. napunj.")
decide between forms of the same strength.

A row whose strength no form has ("tbl. 30x20 mg" when HALMED has 5 mg and 10 mg) is a package
of none of them. A row that says nothing about its strength ("tbl. 1x28") is a package of every
form of its dosage form, as the protected name alone would say.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.geo.normalize import normalize

# Words that start the description after a protected name ("... filmom obložene tablete").
FORM_WORDS = frozenset(
    """
    tableta tablete tbl filmom oblozene oblozena kapsule kapsula tvrde meke otopina
    otopinu sirup krema gel mast prasak granule granulat kapi sprej injekcija injekciju
    infuziju infuzija cepici cepic flaster flasteri suspenzija suspenziju emulzija sumece
    zelucanootporne zelucanootporna pastile pastila oralna oralnu oralni koncentrat
    liofilizat implantat pjena sampon losion prah prasci vaginalete vaginalni rektalni
    transdermalni nazalni inhalat tekucina disperzija pripravak
    """.split()
)

# ------------------------------------------------------------------ strengths

# Units as the sources write them -> (canonical unit, factor).
_UNITS: dict[str, tuple[str, float]] = {
    "mg": ("mg", 1),
    "g": ("mg", 1000),
    "kg": ("mg", 1_000_000),
    "mcg": ("mg", 0.001),
    "µg": ("mg", 0.001),
    "μg": ("mg", 0.001),
    "mikrograma": ("mg", 0.001),
    "mikrogram": ("mg", 0.001),
    "ng": ("mg", 0.000_001),
    "ml": ("ml", 1),
    "l": ("ml", 1000),
    "mcl": ("ml", 0.001),
    "mikrolitara": ("ml", 0.001),
    "iu": ("U", 1),
    "i.j.": ("U", 1),
    "i.j": ("U", 1),
    "ij": ("U", 1),
    "u": ("U", 1),
    "j.": ("U", 1),
    "jedinica": ("U", 1),
    "kiu": ("U", 1000),
    "miu": ("U", 1_000_000),
    "mu": ("U", 1_000_000),
    "milijun iu": ("U", 1_000_000),
    "milijuna iu": ("U", 1_000_000),
    "milijun": ("U", 1_000_000),
    "milijuna": ("U", 1_000_000),
    "%": ("%", 1),
    "mmol": ("mmol", 1),
    "kbq": ("MBq", 0.001),
    "mbq": ("MBq", 1),
    "gbq": ("MBq", 1000),
}
# What a concentration is per: "2 mg/ml", "100 mikrograma/dozi", "0,75 mg po potisku".
_PER = {
    "h": "h",
    "sat": "h",
    "doza": "dose",
    "dozi": "dose",
    "doze": "dose",
    "potisak": "dose",
    "potisku": "dose",
    "inhal": "dose",
    "inhalaciji": "dose",
    "udisaj": "dose",
}
_UNIT = "|".join(re.escape(u) for u in sorted(_UNITS, key=len, reverse=True))
_PER_UNIT = "|".join(re.escape(u) for u in sorted(_PER, key=len, reverse=True))
# A number: thousands in groups of three ("25 000", "1.000.000") or a decimal ("12,5", "1.5");
# a comma before a space separates ("Sumamed 1200, 200 mg/5 ml").
_NUMBER = r"\d{1,3}(?:[ .]\d{3})+(?!\d|,\d)|\d+(?:[,.]\d+)?"
# Not inside another number or a word ("N12E"); "28x20 mg" counts 28 packages of 20 mg.
_START = r"(?<!\d)(?<!\d[,.])(?<![^\W\dxX])"
_END = r"(?![a-zčćšžđ])"
_AMOUNT = re.compile(
    rf"{_START}(?P<value>{_NUMBER})\s*(?P<unit>{_UNIT}){_END}"
    rf"(?:\s*/\s*(?:(?P<per_value>{_NUMBER})\s*)?(?P<per>{_UNIT}|{_PER_UNIT}){_END}"
    rf"|\s+po\s+(?P<po>{_PER_UNIT}){_END})?",
    re.IGNORECASE,
)
# Any number but a count of packages ("28x", "1 x"), units or not ("Kreon 25 000").
_ANY_NUMBER = re.compile(
    rf"(?<!\d)(?<!\d[,.])({_NUMBER})(?!\s*x\b|\s*x\d|\d|[,.]\d)", re.IGNORECASE
)


def _value(raw: str) -> float:
    """'12,5' -> 12.5, '0.125' -> 0.125, '25 000' and '1.000' -> thousands."""
    if re.fullmatch(r"\d+,\d+|0[.]\d+|\d+[.]\d{1,2}", raw):
        return float(raw.replace(",", "."))
    return float(raw.replace(" ", "").replace(".", "").replace(",", "."))


Amount = tuple[float, str]  # (value, canonical unit), e.g. (10.0, "mg")


@dataclass(frozen=True)
class Strength:
    """The strengths a text names, in canonical units."""

    amounts: tuple[Amount, ...]  # in the order written: combinations keep their order
    ratios: frozenset[Amount]  # concentrations: (5.0, "mg/ml") for "10 mg/2 ml" and "5 mg/ml"
    numbers: frozenset[float]  # every number but package counts, units or not ("Kreon 25 000")

    @property
    def features(self) -> frozenset[tuple[str, Amount]]:
        """Amounts and concentrations; a combination also by its total ('4 g/0,5 g' is 4,5 g)."""
        totals: dict[str, float] = {}
        for value, unit in self.amounts:
            if unit != "ml":
                totals[unit] = totals.get(unit, 0) + value
        several = {u for u in totals if sum(1 for _v, a in self.amounts if a == u) > 1}
        return frozenset(
            {("a", a) for a in self.amounts}
            | {("a", (round(totals[u], 6), u)) for u in several}
            | {("r", r) for r in self.ratios}
        )


def strength(text: str) -> Strength:
    """'Normabel 10 mg/2 ml otopina za injekciju' -> amounts (10 mg, 2 ml), ratio 5 mg/ml."""
    amounts: list[Amount] = []
    ratios: set[Amount] = set()
    for m in _AMOUNT.finditer(text):
        unit, factor = _UNITS[m["unit"].lower()]
        value = _value(m["value"]) * factor
        per = (m["per"] or m["po"] or "").lower()
        if not per:
            amounts.append((round(value, 6), unit))
            if unit == "%":  # w/w or w/v: "0,1%" is 1 mg/g, "20%" is 200 g/l
                ratios |= {(round(value / 100, 6), "mg/mg"), (round(value * 10, 6), "mg/ml")}
        elif m["per_value"] is None:  # "2 mg/ml", "20 mg/g", "100 mikrograma/dozi"
            per_unit, per_factor = _UNITS.get(per) or (_PER[per], 1)
            ratios.add((round(value / per_factor, 6), f"{unit}/{per_unit}"))
        elif per in _UNITS:  # "10 mg/2 ml" (an amount in a volume), "5 mg/10 mg" (two)
            per_unit, per_factor = _UNITS[per]
            per_value = _value(m["per_value"]) * per_factor
            amounts += [(round(value, 6), unit), (round(per_value, 6), per_unit)]
            if per_unit == "ml" and per_value:
                ratios.add((round(value / per_value, 6), f"{unit}/ml"))
    numbers = frozenset(_value(m.group(1)) for m in _ANY_NUMBER.finditer(text))
    return Strength(tuple(amounts), frozenset(ratios), numbers)


# ------------------------------------------------------------------ dosage forms

# Coarse kinds: an abbreviation may confuse forms of one kind, never two kinds. Containers say
# nothing here ("amp." holds oral solutions too, "vreć." infusions and granules).
_KINDS = [
    ("intestinal", r"\bintestin"),
    ("eye", r"\bza oc\w*|\bza oko\b|\boftalm|\bocn[aeiou]"),
    ("ear", r"\bza uh\w*|\buh[aiou]\b|\busn[aeiou]"),
    ("nasal", r"\bza nos\b|\bnos\b|\bnazal"),
    ("transdermal", r"\bflaster|\btransd"),
    ("inhaled", r"\binhal|\bpotis|\batomiz|\bnebuliz|\budis"),
    ("vaginal", r"\bvag\b|\bvagin|\brodnic"),
    ("rectal", r"\bsupp\b|\bcepic|\brekt|\bklizm"),
    (
        "oral liquid",
        (
            r"\bsirup|\bmikstur|\bkapi\b|\boral\w* (otop|susp|kap|emulz)"
            r"|\b(otop|susp|emulz|pras|gran|tbl|tablet)\w* (za )?oral"
        ),
    ),
    (
        "oral solid",
        (
            r"\btbl\b|\btablet|\bdrag|\bcaps\b|\bkaps|\bpastil|\bsumec|\bgran|\bzvak"
            r"|\bza usta\b|\boral"
        ),
    ),
    (
        "parenteral",
        (
            r"\binj|\binf\b|\binfuz|\bstrc|\bspric|\bbrizg|\bulo[zs]|\bimplant|\bsupkut"
            r"|\bintravenoz|\bintramusk"
        ),
    ),
    ("skin", r"\bkrem|\bmast\b|\bgel\b|\blosion|\bkozu\b|\bkozn|\bpjen|\bsampon|\bpuder|\bnokt"),
]
# Units one takes whole: there an amount is the strength ("28x20 mg"). Elsewhere it is the size
# of the package ("mast 30 g", "sirup 1x200 ml") and only a concentration says the strength.
_UNIT_DOSE = frozenset({"oral solid", "rectal", "vaginal", "parenteral"})
# A solid unit is never in an ampoule, a vial or a syringe.
_SOLID = r"\btbl\b|\btablet|\bcaps\b|\bkaps|\bdrag|\bcepic|\bsupp\b|\bpastil"
_FLUID = (
    r"\bamp\b|\bampul|\bboc\b|\bbocic|\bstrc|\bspric|\bbrizg|\bulo[zs]|\botop|\bsusp|\bemulz"
    r"|\bsirup|\bkapi\b|\bkonc"
)
# The dosage form's own noun, HZZO's abbreviation first: "mast" is no "kapi", "pjena" no "čepić".
_NOUNS = [
    ("tbl", "tableta"),
    ("tablet", "tableta"),
    ("caps", "kapsula"),
    ("kapsul", "kapsula"),
    ("drag", "drazeja"),
    ("gran", "granule"),
    ("pras", "prasak"),
    ("liofilizat", "prasak"),
    ("lio", "prasak"),
    ("sirup", "sirup"),
    ("konc", "koncentrat"),
    ("otop", "otopina"),
    ("susp", "suspenzija"),
    ("emulz", "emulzija"),
    ("mast", "mast"),
    ("krem", "krema"),
    ("gel", "gel"),
    ("losion", "losion"),
    ("pjen", "pjena"),
    ("sprej", "sprej"),
    ("rasprs", "sprej"),
    ("kapi", "kapi"),
    ("supp", "cepic"),
    ("cepic", "cepic"),
    ("flaster", "flaster"),
    ("implant", "implantat"),
    ("pastil", "pastila"),
    ("inhalat", "inhalat"),
]
# HZZO's abbreviations whose word is not the start of HALMED's ("tbl." for "tableta").
_ABBREVIATIONS = {
    "tbl": "tablet",
    "caps": "kapsul",
    "supp": "cepic",
    "drag": "drazej",
    "rasprs": "sprej",
}
_NOT_FORM_WORDS = frozenset("za ili sadrzi odgovara sto otopine kod uz".split())


def form_kind(text: str) -> str | None:
    """'tbl. film obl.' and 'filmom obložena tableta' -> 'oral solid'; None: it says nothing."""
    t = normalize(text, drop_words=False)
    return next((kind for kind, pattern in _KINDS if re.search(pattern, t)), None)


def _state(text: str) -> str | None:
    t = normalize(text, drop_words=False)
    if re.search(_SOLID, t):
        return "solid"
    return "fluid" if re.search(_FLUID, t) else None


def _noun(text: str) -> str | None:
    """The first word that names a dosage form: 'praš. i otap. za otop.' -> 'prasak'."""
    for word in normalize(text, drop_words=False).split():
        for start, noun in _NOUNS:
            if word.startswith(start):
                return noun
    return None


def _form_words(text: str) -> frozenset[str]:
    words = (
        w for w in normalize(text, drop_words=False).split() if not any(c.isdigit() for c in w)
    )
    return frozenset(
        _ABBREVIATIONS.get(w, w)
        for w in words
        if len(w) >= 3 and w not in _NOT_FORM_WORDS and w not in _UNITS and w not in _PER
    )


def _same_word(row: str, form: str) -> bool:
    """HZZO abbreviates ("oslob." for "oslobađanjem") and inflects differently ("jednodoznih
    spremnika" for "jednodoznom spremniku"): the start of the word, or the same stem."""
    return form.startswith(row) or (len(row) >= 5 and len(form) >= 5 and row[:5] == form[:5])


def _form_likeness(row_words: frozenset[str], form_words: frozenset[str]) -> float:
    """Share of the words both use."""
    if not row_words or not form_words:
        return 0.0
    hits = sum(1 for r in row_words if any(_same_word(r, f) for f in form_words))
    return hits / (len(row_words) + len(form_words) - hits)


# ------------------------------------------------------------------ rows to forms


@dataclass(frozen=True)
class FormText:
    """What identifies a form (HALMED: name and dosage form) or a row (HZZO: name and pack)."""

    name: str  # HALMED's name, or HZZO's protected name ("Ultravist 370")
    words: str  # HALMED's dosage form, or HZZO's package ("tbl. film obl. 28x20 mg")


@dataclass(frozen=True)
class _Profile:
    strength: Strength
    kind: str | None
    state: str | None
    noun: str | None
    name_words: frozenset[str]  # words of the name past the protected name ("Viaflo", "HZTM")
    form_words: frozenset[str]


def _profile(text: FormText, brand_words: int) -> _Profile:
    dosage = text.words or text.name
    name = normalize(text.name, drop_words=False).split()[brand_words:]
    extra = frozenset(
        w for w in name if len(w) >= 3 and w not in FORM_WORDS and not any(c.isdigit() for c in w)
    )
    return _Profile(
        strength=strength(f"{text.name} {text.words}"),
        kind=form_kind(dosage),
        state=_state(dosage),
        noun=_noun(dosage),
        name_words=extra,
        form_words=_form_words(text.words),
    )


def _jaccard(a: frozenset[object], b: frozenset[object]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _compatible(row: _Profile, form: _Profile) -> bool:
    kinds = row.kind is None or form.kind is None or row.kind == form.kind
    states = row.state is None or form.state is None or row.state == form.state
    return kinds and states


def _contradicts(row: _Profile, form: _Profile) -> bool:
    """Both name a strength in the same unit, and none agrees. Volumes never count ("100 ml" of
    a syrup is no "5 ml" of "5 mg/5 ml"), nor the size of a package that is not a unit dose."""
    unit_dose = row.kind is None or row.kind in _UNIT_DOSE
    row_units = {u for _v, u in row.strength.ratios}
    if unit_dose:
        row_units |= {u for _v, u in row.strength.amounts}
    form_units = {u for _v, u in form.strength.ratios} | {u for _v, u in form.strength.amounts}
    shared = (row_units & form_units) - {"ml"}
    return bool(shared) and not (row.strength.features & form.strength.features)


def _ordered(amounts: tuple[Amount, ...]) -> tuple[Amount, ...]:
    """The amounts of a combination in order, without the volume ("10 mg/2 ml" -> 10 mg)."""
    return tuple(a for a in amounts if a[1] != "ml")


def _score(row: _Profile, form: _Profile) -> tuple[float, float, float, float, float]:
    """Strength first, then the order of a combination's strengths ("5 mg/10 mg" is no
    "10 mg/5 mg"), then the numbers and words of the name ("Ultravist 370", "Viaflo"), then the
    words of the dosage form."""
    r, f = row.strength, form.strength
    same_order = float(len(_ordered(r.amounts)) > 1 and _ordered(r.amounts) == _ordered(f.amounts))
    return (
        _jaccard(r.features, f.features),
        same_order,
        _jaccard(r.numbers, f.numbers),
        float(len(row.name_words & form.name_words)),
        _form_likeness(row.form_words, form.form_words),
    )


def _without_strength(row: _Profile, profiles: list[_Profile], fit: list[int]) -> list[int]:
    """The forms of a row whose strength says nothing about which form it is."""
    # Not a form of another strength: "tbl. 30x20 mg" is no 10 mg form.
    candidates = [i for i in fit if not _contradicts(row, profiles[i])]
    # A form that names no strength of its own ("Flixonase sprej za nos" beside "Flixonase
    # 400 mikrograma kapi za nos") is the likelier one.
    candidates = [i for i in candidates if not profiles[i].strength.features] or candidates
    # The dosage form's noun: "mast za oči" is the ointment, not the drops.
    if row.noun:
        candidates = [i for i in candidates if profiles[i].noun == row.noun] or candidates
    # Forms of one strength differ only in how they are made and packed: the words decide
    # ("otop. za inj., štrc. napunj." is the syringe, not the vial).
    if len(candidates) > 1 and len({profiles[i].strength.features for i in candidates}) == 1:
        likeness = {i: _form_likeness(row.form_words, profiles[i].form_words) for i in candidates}
        top = max(likeness.values())
        candidates = [i for i in candidates if likeness[i] == top]
    return candidates


def assign_rows(
    forms: Sequence[FormText], rows: Sequence[FormText], brand_words: int
) -> list[list[int]]:
    """For each row, the indexes of the forms it is a package of (empty: none of them).
    brand_words: how many words of the names are the protected name ('andol pro': 2)."""
    profiles = [_profile(f, brand_words) for f in forms]
    out: list[list[int]] = []
    for row_text in rows:
        row = _profile(row_text, brand_words)
        fit = [i for i, form in enumerate(profiles) if _compatible(row, form)]
        scored = [(_score(row, profiles[i]), i) for i in fit]
        best = max((s for s, _i in scored), default=None)
        if best is not None and any(best[:4]):  # its strength or its name says which form
            out.append([i for s, i in scored if s == best])
        else:
            out.append(_without_strength(row, profiles, fit))
    return out

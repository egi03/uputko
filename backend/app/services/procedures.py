"""Which CEZIH procedure a spoken request means: "magnetska koljena" -> "MR koljena",
"pregled kod kardiologa" -> "Kardiologija - Prvi pregled", "MR kralježnice" -> ambiguous.

Every request word must be found in the procedure name (after synonyms and Croatian endings);
among those, the name with the fewest extra words wins. A synonym adds a spelling and never
takes away the word said, so every CEZIH name finds itself ("Endoskopija ORL", "Psihijatar -
pregled i savjetovanje"). Without a variant word the first exam is meant; control exams,
consultations without the patient, other procedures, preventive programmes and procedures for
children are chosen only when the request says so.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

from rapidfuzz import fuzz, process
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.categories import is_pediatric_procedure
from app.geo.normalize import normalize, stems
from app.models import WlProcedure

# Phrases replaced before words are split (normalized form, no diacritics).
PHRASES = {
    "magnetska rezonanca": "mr",
    "magnetska rezonancija": "mr",
    "magnetna rezonanca": "mr",
    "magnetna rezonancija": "mr",
    "kompjuterizirana tomografija": "ct",
    "ultra zvuk": "uzv",
    "uho grlo nos": "otorinolaringologija",
    "debelog crijeva": "kolonoskopija",
    "debelo crijevo": "kolonoskopija",
    "eho srca": "uzv srca",
    "ultrazvuk srca": "uzv srca",
    "srcani ultrazvuk": "uzv srca",
}
WORDS = {
    "magnetska": "mr",
    "magnetna": "mr",
    "magnet": "mr",
    "mri": "mr",
    "emer": "mr",
    "skener": "ct",
    "cet": "ct",
    "ultrazvuk": "uzv",
    "ultrazvucni": "uzv",
    "ultrazvuka": "uzv",
    "rendgen": "rtg",
    "rentgen": "rtg",
    "rendgenska": "rtg",
    "okulist": "oftalmologija",
    "okulista": "oftalmologija",
    "okulistu": "oftalmologija",
    "ocni": "oftalmologija",
    "ocnog": "oftalmologija",
    "zeluca": "gastroskopija",
    "kozni": "dermatologija",
    "orl": "otorinolaringologija",
}
# Doctor -> specialty, by word start (longest first): "kardiologa" -> "kardiologija".
SPECIALISTS = {
    "otorinolaringolog": "otorinolaringologija",
    "gastroenterolog": "gastroenterologija",
    "endokrinolog": "endokrinologija",
    "anesteziolog": "anesteziologija",
    "neurokirurg": "neurokirurgija",
    "dijabetolog": "dijabetologija",
    "dermatolog": "dermatologija",
    "infektolog": "infektologija",
    "reumatolog": "reumatologija",
    "ginekolog": "ginekologija",
    "kardiolog": "kardiologija",
    "oftalmolog": "oftalmologija",
    "hematolog": "hematologija",
    "alergolog": "alergologija",
    "psihijat": "psihijatrija",
    "pedijat": "pedijatrija",
    "pulmolog": "pulmologija",
    "nefrolog": "nefrologija",
    "audiolog": "audiologija",
    "fonijat": "fonijatrija",
    "androlog": "andrologija",
    "internist": "interna",
    "ortodont": "ortodoncija",
    "logoped": "logopedija",
    "onkolog": "onkologija",
    "neurolog": "neurologija",
    "fizijat": "fizikalna medicina rehabilitacija",
    "ortoped": "ortopedija",
    "urolog": "urologija",
    "kirurg": "kirurgija",
}
# A spoken word that may be written differently in the procedure names.
ALTERNATIVES = {
    "trbuh": ("abdomena",),
    "trbuha": ("abdomena",),
    "trbusne": ("abdomena",),
    "glava": ("glave", "mozga"),
    "glave": ("glave", "mozga"),
    "pluca": ("pluca", "prsnog", "kosa", "toraksa"),
    "kicma": ("kraljeznice",),
    "kicme": ("kraljeznice",),
    "kicmu": ("kraljeznice",),
    # MR lists big joints together ("MR jednog velikog zgloba"); CT and RTG name them.
    "rame": ("ramena", "ramenog", "zgloba"),
    "ramena": ("ramena", "ramenog", "zgloba"),
    "kuk": ("kuka", "zgloba"),
    "kuka": ("kuka", "zgloba"),
    "lakat": ("lakta", "zgloba"),
    "lakta": ("lakta", "zgloba"),
    "glezanj": ("gleznja", "zgloba"),
    "gleznja": ("gleznja", "zgloba"),
    "vratne": ("cervikalne",),
    "vratna": ("cervikalne",),
    "lumbalne": ("lumbosakralne",),
    "lumbalna": ("lumbosakralne",),
    "prsne": ("torakalne",),
    "srce": ("srca",),
    "stitnjaca": ("stitnjace",),
    "stitne": ("stitnjace",),
    "grudi": ("dojke",),
    "dojka": ("dojke",),
    "zub": ("zuba", "zubi"),
    "zubi": ("zuba", "zubi"),
}


def _words(text: str) -> frozenset[str]:
    return frozenset(text.split())


CHILD_WORDS = _words("dijete djeteta djecu djeca djecji djecjeg djecja sin sina kci kcer beba bebe")
CONTROL_WORDS = _words("kontrolni kontrolu kontrola kontrolnog ponovni ponovno")
# Request words that say nothing about which procedure is meant.
STOPWORDS = (
    _words(
        """gdje mogu moze moguce trebam treba trebao trebala zelim htio htjela napraviti obaviti
        snimiti snimanje snimka pretraga pretragu pretrage termin termina lista liste listu
        cekanja cekanje koliko se ceka najbrze najblize najkraci najkraca kod na za u i s sa
        doktor doktora doktoru doktorice lijecnik lijecnika lijecniku specijalist specijalista
        specijalistu pregled pregleda pregledu me mi moj moja moje mojeg molim hitno sto prije
        lijevog lijevi lijeve lijevo desnog desni desne desno oba obje jedan jednog prvi prvo
        preventivni preventivnu preventivno"""
    )
    | CHILD_WORDS
    | CONTROL_WORDS
)
# Words of procedure names that carry no meaning for matching. They are left out of the request
# too (the variant they name is scored instead), so a name sent back as offered finds itself.
NAME_STOPWORDS = _words(
    """i za u s sa sklopu nacionalnih preventivnih programa pregled prvi kontrolni konzultacija
    bez pacijenta ostali postupci"""
)
CHILD_PREFIXES = ("pedijatr", "djecj")  # "pedijatrijska neurologija", "dječja kirurgija"
EXTRA_WORD = 1.5  # penalty for each name word the request did not mention
TYPO_PENALTY = 1.5  # a word found only as a typo loses to the word itself ("neurologija")
AMBIGUITY_GAP = 1.0
FUZZY_CUTOFF = 88
TYPO_RATIO = 90
# Croatian endings: at least this many letters before the ending ("koljeno" ~ "koljena"; not
# "cistoskopija" ~ "čistu").
ENDING_MIN_STEM = 5
MAX_CANDIDATES = 3


@dataclass(frozen=True)
class ProcedureRecord:
    id: int
    name: str
    category: str | None
    variant: str
    is_pediatric: bool
    institutions: int
    median_days: int | None
    words: tuple[str, ...] = field(default=(), compare=False)
    word_stems: tuple[frozenset[str], ...] = field(default=(), compare=False)


@dataclass
class ProcedureMatch:
    status: Literal["ok", "ambiguous", "not_found"]
    procedure: ProcedureRecord | None = None
    candidates: list[ProcedureRecord] = field(default_factory=list)


def _word_stems(word: str) -> frozenset[str]:
    return frozenset(stems(word)) | {word}


def record(p: WlProcedure) -> ProcedureRecord:
    words = tuple(w for w in normalize(p.name, drop_words=False).split() if w not in NAME_STOPWORDS)
    return ProcedureRecord(
        id=p.id,
        name=p.name,
        category=p.category,
        variant=p.variant,
        # Also from the name: the stored flag changes only with the next CEZIH download
        # ("Sluh - jednostavno ispitivanje kod djeteta").
        is_pediatric=p.is_pediatric or is_pediatric_procedure(p.name),
        institutions=p.institutions,
        median_days=p.median_days,
        words=words,
        word_stems=tuple(_word_stems(w) for w in words),
    )


@dataclass(frozen=True)
class _Term:
    """A request word: the spellings it may have in the names (synonym or specialty first, for
    the fuzzy fallback) and, when a synonym replaced it, the word as said. That one matches only
    itself or its stem ("ocnog": "Mjerenje očnog tlaka"; "ginekolog" not "Ginekološka")."""

    spellings: tuple[str, ...]
    said: str = ""


@dataclass(frozen=True)
class _Request:
    terms: tuple[_Term, ...]
    wants_child: bool
    wants_control: bool
    wants_preventive: bool
    wants_consult: bool
    wants_other: bool
    text: str


def _terms(word: str) -> list[_Term]:
    w = WORDS.get(word, word)
    w = next((spec for key, spec in SPECIALISTS.items() if w.startswith(key)), w)
    parts = w.split()
    if len(parts) > 1:  # "uzv srca", "fizikalna medicina rehabilitacija"
        return [_Term(ALTERNATIVES.get(part, (part,))) for part in parts]
    spellings = ALTERNATIVES.get(w, (w,))
    return [_Term(spellings, "" if word in spellings else word)]


def parse_request(query: str) -> _Request:
    text = normalize(query or "", drop_words=False)
    for phrase, replacement in PHRASES.items():
        text = text.replace(phrase, replacement)
    words = text.split()
    terms: list[_Term] = []
    said: list[str] = []  # for the fuzzy fallback, with the variant words
    for word in words:
        if word in STOPWORDS:
            continue
        if word in NAME_STOPWORDS or word.startswith("preventiv"):  # a variant, scored as such
            said.append(word)
            continue
        new = _terms(word)
        terms.extend(new)
        said.extend(t.spellings[0] for t in new)
    return _Request(
        terms=tuple(terms),
        wants_child=bool(CHILD_WORDS & set(words))
        or any(w.startswith(CHILD_PREFIXES) for w in words),
        wants_control=bool(CONTROL_WORDS & set(words)),
        wants_preventive=any(w.startswith("preventiv") for w in words),
        wants_consult=any(w.startswith("konzultacij") for w in words),
        wants_other="postupci" in words,
        text=" ".join(" ".join(said).split()),
    )


def _match(term: _Term, word: str, word_stems: frozenset[str]) -> int:
    """2: the word itself, a shared stem or a Croatian ending; 1: only a typo; 0: no match."""
    if term.said and (term.said == word or word_stems & _word_stems(term.said)):
        return 2
    typo = 0
    for alt in term.spellings:
        if alt == word or word_stems & _word_stems(alt):
            return 2
        # Croatian endings beyond the stemmer: "koljeno" ~ "koljena", "ortopedija" ~ "ortopediju".
        n = min(len(alt), len(word))
        if n - 1 >= ENDING_MIN_STEM and alt[: n - 1] == word[: n - 1]:
            return 2
        # A typo in a long word: "kolonskopija" ~ "kolonoskopija" (not "dermato" ~ "hemato"). Two
        # real names can be this close ("neurologija", "nefrologija"), so a typo counts less.
        if len(alt) >= 7 and alt[:2] == word[:2] and fuzz.ratio(alt, word) >= TYPO_RATIO:
            typo = 1
    return typo


def _variant_score(req: _Request, variant: str) -> float:
    """The variant said wins (and the first exam is not meant then); without one the first exam
    is meant. Consultations, other procedures and preventive programmes only when said."""
    asked = {
        v
        for v, wanted in (
            ("control", req.wants_control),
            ("consult", req.wants_consult),
            ("other", req.wants_other),
            ("preventive", req.wants_preventive),
        )
        if wanted
    }
    if variant in asked:
        return 2.0
    if asked:
        score = -1.0 if variant == "first" else 0.0
    else:
        score = {"first": 1.5, "control": -1.5}.get(variant, 0.0)
    return score + {"consult": -5.0, "other": -2.0, "preventive": -2.0}.get(variant, 0.0)


def _score(req: _Request, p: ProcedureRecord) -> tuple[float, int] | None:
    """The score and how many request words were found only as a typo; None when a request word
    is missing from the name."""
    used: set[int] = set()
    typos = 0
    pairs = list(enumerate(zip(p.words, p.word_stems, strict=True)))
    for term in req.terms:
        hits = {i: q for i, (w, s) in pairs if (q := _match(term, w, s))}
        if not hits:
            return None
        if max(hits.values()) == 1:
            typos += 1
        used.update(hits)
    score = 10.0 - EXTRA_WORD * (len(p.words) - len(used)) - TYPO_PENALTY * typos
    score += _variant_score(req, p.variant)
    if p.is_pediatric != req.wants_child:
        score += -4.0 if p.is_pediatric else -1.0
    elif p.is_pediatric:  # asked for a child: the "dječja"/"za djecu" words are no extra
        score += 3.0
    return score + min(p.institutions, 60) / 1000, typos  # popular lists win exact ties


def _one_per_name(procedures: Iterable[ProcedureRecord]) -> list[ProcedureRecord]:
    """In the same order, each name once: CEZIH names a few procedures twice ('Reumatologija -
    konzultacija bez pacijenta', two codes), and a question cannot offer the same name twice.
    The one with more lists stands for the name."""
    best: dict[str, ProcedureRecord] = {}
    for p in procedures:
        if p.name not in best or p.institutions > best[p.name].institutions:
            best[p.name] = p
    return list(best.values())


class ProcedureIndex:
    def __init__(self, procedures: list[ProcedureRecord]) -> None:
        self.procedures = procedures
        self._by_id = {p.id: p for p in procedures}
        self._names = [normalize(p.name, drop_words=False) for p in procedures]

    def __len__(self) -> int:
        return len(self.procedures)

    def get(self, procedure_id: int) -> ProcedureRecord | None:
        return self._by_id.get(procedure_id)

    def resolve(self, query: str) -> ProcedureMatch:
        req = parse_request(query)
        if not req.terms:
            return ProcedureMatch("not_found")
        found = [(s, p) for p in self.procedures if (s := _score(req, p)) is not None]
        if not found:
            return self._fuzzy(req)
        # A name with every word said beats any name found only through a typo: "alergolog" is
        # allergology, never "Algologija" one letter away.
        exact = [(sc, p) for (sc, typos), p in found if typos == 0]
        scored = exact or [(sc, p) for (sc, _typos), p in found]
        scored.sort(key=lambda t: -t[0])
        best_score = scored[0][0]
        close = _one_per_name(p for s, p in scored if best_score - s < AMBIGUITY_GAP)
        if len(close) == 1:
            return ProcedureMatch("ok", procedure=close[0])
        return ProcedureMatch("ambiguous", candidates=close[:MAX_CANDIDATES])

    def _fuzzy(self, req: _Request) -> ProcedureMatch:
        """Typos ('kolonskopija'): close names by characters; still ambiguous if several."""
        hits = process.extract(
            req.text, self._names, scorer=fuzz.ratio, score_cutoff=FUZZY_CUTOFF, limit=5
        )
        scored = [(self.procedures[i], score) for _name, score, i in hits]
        kept = [(p, sc) for p, sc in scored if req.wants_child or not p.is_pediatric] or scored
        if not kept:
            return ProcedureMatch("not_found")
        score = {p.id: sc for p, sc in kept}  # one name: the same score
        kept = [(p, score[p.id]) for p in _one_per_name(p for p, _sc in kept)]
        # The gap is measured on what is left after the children's filter.
        if len(kept) == 1 or kept[0][1] - kept[1][1] >= 5:
            return ProcedureMatch("ok", procedure=kept[0][0])
        return ProcedureMatch("ambiguous", candidates=[p for p, _sc in kept[:MAX_CANDIDATES]])

    def search(self, query: str, limit: int = 8) -> list[ProcedureRecord]:
        """Autocomplete for the UI: every word of the query must start a word of the name."""
        words = normalize(query or "", drop_words=False).split()
        if not words:
            return []
        req = parse_request(query)
        hits: list[tuple[int, ProcedureRecord, float]] = []  # prefix hits first, then by score
        for p, name in zip(self.procedures, self._names, strict=True):
            name_words = name.split()
            if all(any(nw.startswith(w) for nw in name_words) for w in words):
                hits.append((0, p, 0.0))
            elif req.terms and (s := _score(req, p)) is not None:
                hits.append((1, p, s[0]))
        hits.sort(key=lambda h: (h[0], -h[2], -h[1].institutions, h[1].name))
        return [p for _, p, _ in hits[:limit]]


def load_procedures(session: Session) -> ProcedureIndex:
    rows = session.scalars(select(WlProcedure).order_by(WlProcedure.id)).all()
    return ProcedureIndex([record(p) for p in rows])

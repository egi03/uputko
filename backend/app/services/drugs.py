"""get_drug_info: facts about a medicine from HALMED and HZZO's lists.

Only what the sources say: active substance, how it is dispensed, whether and how it is on
HZZO's lists, market and shortage status, and the link to the medicine's HALMED page with the
patient leaflet. Never dosage, use or substitution advice.
"""

from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from rapidfuzz import fuzz, process
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.geo.normalize import normalize
from app.ingest.drugs_jobs import SOURCE_KEYS, brand_key
from app.models import Drug, SourceStatus
from app.schemas import CandidateOut, ToolResponse
from app.services.common import last_success, stale_note
from app.services.phrases import date_hr, join_or, number, plural
from app.timeutil import iso_local, to_local

SOURCE = "HALMED, HZZO"
OVERVIEW_SOURCE = "HALMED, baza lijekova; HZZO, liste lijekova"
STALE_AFTER_MIN = 72 * 60
FUZZY_CUTOFF = 86
SUBSTANCE_CUTOFF = 90
MAX_PRODUCTS = 6
MAX_EXAMPLES = 3
ON_MARKET = "stavljeno u promet"
SUPPLY_PAUSED = "privremeni prekid opskrbe"
OTC = "bez recepta"
SHORTAGE = "u tijeku"
RX = "na recept"
# Salt and water in HALMED's substance names, left out when matching what people say
# ('pantoprazol' finds 'pantoprazolnatrij seskvihidrat'); longer endings first.
_GLUED_SALTS = sorted(
    """
    hidroklorid klorid dinatrij natrij kalij kalcij magnezij bromid hemifumarat fumarat
    maleat bitartarat tartarat mesilat besilat tozilat tosilat hidrogensulfat sulfat citrat
    acetat fosfat sukcinat nitrat laktat dipropionat propionat valerat glukonat
    trometamol meglumin oksalat benzoat embonat dekanoat palmitat hiklat karbonat
    dietilamin epolamin arginin erbumin terbutilamin
    """.split(),
    key=len,
    reverse=True,
)
# The same, and solvents of a solvate, written as words of their own: 'dapagliflozin propandiol
# hidrat' (Forxiga), 'perindopril-tert-butilamin' (Perineva), 'ibuprofen-DL-lizin'.
_SEPARATE_SALTS = frozenset(
    {
        *_GLUED_SALTS,
        *["propandiol", "propilenglikol", "tert", "butilamin", "dl", "lizin", "pamoat"],
        *["hemitartarat", "trifenatat"],
    }
)


@dataclass
class DrugMatch:
    status: str  # ok | ambiguous | not_found
    kind: str = ""  # brand | substance
    label: str = ""  # "Andol" or "paracetamol"
    drugs: list[Drug] = field(default_factory=list)
    candidates: list[str] = field(default_factory=list)


def display_brand(d: Drug) -> str:
    """Protected name in the source's spelling ('Andol PRO', 'Depo-Medrol'): the words of the
    name that make up its brand key; a hyphen or slash joins two key words in one written word."""
    want = len(d.brand_key.split())
    if not want:
        return d.name
    taken: list[str] = []
    count = 0
    for word in d.name.split():
        if count >= want:
            break
        taken.append(word)
        count += len(normalize(word, drop_words=False).split())
    return " ".join(taken)


def _join(items: list[str], limit: int = MAX_EXAMPLES) -> str:
    """'a, b i c'; a long list ends with 'i još N'."""
    if len(items) > limit + 1:
        rest = len(items) - limit
        return f"{', '.join(items[:limit])} i još {rest}"
    return ", ".join(items[:-1]) + f" i {items[-1]}" if len(items) > 1 else items[0]


def substance_base(substance_norm: str) -> str:
    """'pantoprazolnatrij seskvihidrat' -> 'pantoprazol', per part of a combination."""
    parts = []
    for part in substance_norm.split(";"):
        words = [w for w in part.split() if not w.endswith("hidrat")]
        if not words:
            continue
        first = words[0]
        for salt in _GLUED_SALTS:
            if first.endswith(salt) and len(first) - len(salt) >= 4:
                first = first[: -len(salt)]
                break
        parts.append(" ".join([first, *(w for w in words[1:] if w not in _SEPARATE_SALTS)]))
    return "; ".join(parts)


def _rank(d: Drug) -> tuple[bool, bool, bool, int, str]:
    return (d.revoked, d.market_status != ON_MARKET, d.central, len(d.name), d.name)


def _brand(drugs: list[Drug], label: str) -> DrugMatch:
    return DrugMatch("ok", "brand", label, sorted(drugs, key=_rank))


def _drugs_of(session: Session, substances: list[str]) -> list[Drug]:
    if not substances:
        return []
    rows = session.scalars(select(Drug).where(Drug.substance_norm.in_(substances)))
    return sorted(rows, key=_rank)


def _substances(session: Session) -> Iterator[tuple[str, list[str], list[str]]]:
    """Each stored substance: its normalized name, the substances it is made of and their bases.
    HALMED separates the substances of a combination with ';', which normalizing drops."""
    for active, norm in session.execute(
        select(Drug.active_substance, Drug.substance_norm).distinct()
    ):
        parts = [p for x in (active or "").split(";") if (p := normalize(x, drop_words=False))]
        if parts:
            yield norm, parts, [substance_base(p) for p in parts]


def _by_substance(session: Session, text: str) -> tuple[list[Drug], list[Drug]]:
    """Drugs of the substance alone, and drugs with it in a combination."""
    alone: set[str] = set()
    within: set[str] = set()
    for norm, parts, bases in _substances(session):
        if len(parts) == 1 and text in (parts[0], bases[0]):
            alone.add(norm)
        elif text in parts or text in bases:
            within.add(norm)
    return _drugs_of(session, sorted(alone)), _drugs_of(session, sorted(within - alone))


def _substance_spelled_alike(session: Session, text: str) -> list[Drug]:
    """'acetilsalicilna kiselina' for HALMED's 'acetilsalicilatna kiselina'."""
    singles: dict[str, list[str]] = defaultdict(list)
    for norm, parts, bases in _substances(session):
        if len(parts) == 1:
            singles[bases[0]].append(norm)
    hit = process.extractOne(text, list(singles), scorer=fuzz.ratio, score_cutoff=SUBSTANCE_CUTOFF)
    return _drugs_of(session, singles[hit[0]]) if hit else []


def find_drug(session: Session, query: str) -> DrugMatch:
    """An active substance ('paracetamol', 'pantoprazol'), a protected name ('Andol'), a family
    of names with one substance ('Plicet': Forte, Rapid), a substance within combinations, or
    a near spelling of a name, in that order."""
    key = brand_key(query)
    text = normalize(query or "", drop_words=False)
    if not key:
        return DrugMatch("not_found")
    label = " ".join((query or "").split()).lower()
    alone, within = _by_substance(session, text)
    if alone:
        return DrugMatch("ok", "substance", label, alone)
    exact = list(session.scalars(select(Drug).where(Drug.brand_key == key)))
    if exact:
        return _brand(exact, display_brand(exact[0]))
    longer = list(session.scalars(select(Drug).where(Drug.brand_key.startswith(key + " "))))
    if longer:
        if len({d.substance_norm for d in longer}) == 1:
            n = len(key.split())
            return _brand(longer, " ".join(display_brand(longer[0]).split()[:n]))
        families: dict[str, list[Drug]] = defaultdict(list)
        for d in longer:
            families[d.brand_key].append(d)
        names = sorted({display_brand(v[0]) for v in families.values()}, key=len)
        return DrugMatch("ambiguous", candidates=names[:MAX_EXAMPLES])
    if within:
        return DrugMatch("ok", "substance", label, within)
    brands = sorted({d for (d,) in session.execute(select(Drug.brand_key).distinct())})
    hits = process.extract(key, brands, scorer=fuzz.ratio, score_cutoff=FUZZY_CUTOFF, limit=3)
    if not hits:
        alike = _substance_spelled_alike(session, text)
        if alike:
            return DrugMatch("ok", "substance", alike[0].active_substance, alike)
        return DrugMatch("not_found")
    if len(hits) == 1 or hits[0][1] - hits[1][1] >= 6:
        drugs = list(session.scalars(select(Drug).where(Drug.brand_key == hits[0][0])))
        return _brand(drugs, display_brand(drugs[0]))
    candidates = []
    for name, _score, _i in hits:
        drug = session.scalars(select(Drug).where(Drug.brand_key == name)).first()
        if drug is not None:
            candidates.append(display_brand(drug))
    return DrugMatch("ambiguous", candidates=candidates)


def _euro(value: float) -> str:
    return f"{number(value, 2)} eura"


def _current(drugs: list[Drug]) -> list[Drug]:
    return [d for d in drugs if not d.revoked] or drugs


def _list_sentence(drugs: list[Drug]) -> str:
    current = _current(drugs)
    listed = [d for d in current if d.hzzo_list]
    if not listed:
        return "Na listama lijekova HZZO-a nije pronađen."
    kinds = {k for d in listed for k in d.hzzo_list.split("+")}
    some = len(listed) < len(current)
    if kinds == {"OLL", "DLL"}:
        # Packages of one form may be on both lists (another size, or the same package).
        if any("+" in d.hzzo_list for d in listed):
            return "Na osnovnoj je i na dopunskoj listi lijekova HZZO-a."
        return "Neki su oblici na osnovnoj, a neki na dopunskoj listi lijekova HZZO-a."
    if kinds == {"OLL"}:
        if all(d.hzzo_hospital_only for d in listed):
            where = "Neki su oblici" if some else "Lijek je"
            return f"{where} na osnovnoj listi lijekova HZZO-a, ali samo za primjenu u bolnici."
        if some:
            return (
                "Neki su oblici na osnovnoj listi lijekova HZZO-a, pa se uz recept izdaju bez "
                "doplate."
            )
        return "Na osnovnoj je listi lijekova HZZO-a, pa se uz recept izdaje bez doplate."
    lows = [d.hzzo_copay_min for d in listed if d.hzzo_copay_min is not None]
    highs = [d.hzzo_copay_max for d in listed if d.hzzo_copay_max is not None]
    where = "Neki su oblici na dopunskoj listi" if some else "Na dopunskoj je listi"
    if not lows:
        return f"{where} lijekova HZZO-a, uz doplatu."
    low, high = min(lows), max(highs)
    amount = _euro(low) if low == high else f"od {number(low, 2)} do {_euro(high)}"
    return f"{where} lijekova HZZO-a: uz recept se doplaćuje {amount} po pakiranju."


def _rx_sentence(drugs: list[Drug], several: str = "oblici") -> str:
    """How the medicine is dispensed; nothing when HALMED does not say."""
    kinds = {d.rx for d in _current(drugs) if d.rx}
    if not kinds:
        return ""
    if kinds == {OTC}:
        return "Izdaje se bez recepta." if several == "oblici" else "Svi se izdaju bez recepta."
    if kinds == {RX}:
        return "Izdaje se na recept." if several == "oblici" else "Svi se izdaju na recept."
    if several == "oblici":
        return "Neki se oblici izdaju bez recepta, a neki na recept."
    return "Neki se izdaju bez recepta, a neki na recept."


def _status_sentence(drugs: list[Drug]) -> str:
    current = _current(drugs)
    if all(d.revoked for d in current):
        return "Prema HALMED-u, odobrenje za stavljanje u promet je ukinuto."
    # Only statuses HALMED publishes: many EU-authorised medicines have none at all.
    statuses = {d.market_status for d in current if d.market_status}
    if statuses and ON_MARKET not in statuses:
        if SUPPLY_PAUSED in statuses:
            return "HALMED bilježi privremeni prekid opskrbe."
        return "Prema HALMED-u trenutno nije u prometu u Hrvatskoj."
    if any(d.shortage == SHORTAGE for d in current):
        return "HALMED bilježi nestašicu nekih pakiranja."
    return ""


def _substance_summary(label: str, drugs: list[Drug]) -> list[str]:
    brands: dict[str, list[Drug]] = defaultdict(list)
    for d in _current(drugs):
        brands[display_brand(d)].append(d)
    n = len(brands)
    examples: list[str] = []  # different first words: not 'Voltaren' and 'Voltaren rapid'
    for b in brands:
        if len(examples) < MAX_EXAMPLES and all(b.split()[0] != e.split()[0] for e in examples):
            examples.append(b)
    listed = _join(examples)
    on_list = [b for b, ds in brands.items() if any(d.hzzo_list for d in ds)]
    if n == 1:  # one medicine: said as for its name
        what = f"Prema HALMED-u, {label} je djelatna tvar lijeka {listed}."
        rx, lists = _rx_sentence(drugs), _list_sentence(drugs)
    else:
        what = (
            f"Prema HALMED-u, {label} je djelatna tvar {n} "
            f"{plural(n, 'lijeka', 'lijeka', 'lijekova')}, na primjer {listed}."
        )
        rx = _rx_sentence(drugs, several="lijekovi")
        if not on_list:
            lists = "Nijedan od njih nije pronađen na listama lijekova HZZO-a."
        elif len(on_list) == n:
            lists = "Svi su na listama lijekova HZZO-a."
        elif len(on_list) == 1:
            lists = f"Na listama lijekova HZZO-a je {on_list[0]}."
        else:
            lists = f"Na listama lijekova HZZO-a ih je {len(on_list)}, na primjer {on_list[0]}."
    sentences = [what, rx, lists]
    return [x for x in sentences if x]


def _brand_summary(label: str, drugs: list[Drug]) -> list[str]:
    substances = list(dict.fromkeys(d.active_substance for d in drugs if d.active_substance))
    parts = [x.strip() for x in substances[0].split(";")] if len(substances) == 1 else []
    if len(parts) == 1:
        what = f"Prema HALMED-u, djelatna tvar lijeka {label} je {parts[0]}."
    elif parts:  # a combination: 'paracetamol; askorbatna kiselina'
        what = f"Prema HALMED-u, djelatne tvari lijeka {label} su {_join(parts)}."
    elif substances:
        what = f"Prema HALMED-u, lijek {label} postoji u više sastava; detalji su na ekranu."
    else:
        what = f"Lijek {label} nalazi se u bazi HALMED-a."
    rx, lists, status = _rx_sentence(drugs), _list_sentence(drugs), _status_sentence(drugs)
    if rx and status:  # at most three sentences: dispensing and the lists become one
        rx = f"{rx[:-1]}, a {lists[0].lower()}{lists[1:]}"
        lists = ""
    return [x for x in (what, rx, lists, status) if x]


def _product(d: Drug) -> dict[str, Any]:
    return {
        "name": d.name,
        "brand": display_brand(d),
        "active_substance": d.active_substance,
        "form": d.form,
        "rx": d.rx or None,
        "prescription": d.prescription or None,
        "atc": d.atc or None,
        "hzzo_list": d.hzzo_list or None,
        "copay_min_eur": d.hzzo_copay_min,
        "copay_max_eur": d.hzzo_copay_max,
        "hospital_only": d.hzzo_hospital_only,
        "market_status": d.market_status or None,
        "shortage": d.shortage or None,
        "central": d.central,
        # HALMED revoked the authorisation: the summary leaves the form out (_current).
        "revoked": d.revoked,
        "detail_url": d.detail_url or None,
    }


def _lists_in_force(session: Session) -> str | None:
    status = session.get(SourceStatus, SOURCE_KEYS["lists"])
    local = to_local(status.source_updated_at) if status else None
    return local.date().isoformat() if local else None


def get_drug_info(session: Session, name: str) -> ToolResponse:
    fetched = last_success(session, [SOURCE_KEYS["halmed"]])
    if fetched is None:
        return ToolResponse(
            status="no_data",
            summary_hr="Baza lijekova HALMED-a trenutno nije dostupna. Pokušajte malo kasnije.",
            source=SOURCE,
        )
    match = find_drug(session, name)
    if match.status == "not_found":
        return ToolResponse(
            status="not_found",
            summary_hr=(
                "Lijek nije pronađen u bazi HALMED-a. Ponovite naziv kako piše na kutiji ili "
                "recite djelatnu tvar."
            ),
            source=SOURCE,
            updated_at=iso_local(fetched),
        )
    if match.status == "ambiguous":
        said = join_or(match.candidates)
        return ToolResponse(
            status="ambiguous",
            candidates=[CandidateOut(name=c, kind="drug") for c in match.candidates],
            summary_hr=f"U bazi HALMED-a ima više lijekova sličnog naziva. Mislite li na {said}?",
            source=SOURCE,
            updated_at=iso_local(fetched),
        )
    drugs = match.drugs
    if match.kind == "substance":
        sentences = _substance_summary(match.label, drugs)
    else:
        sentences = _brand_summary(match.label, drugs)
    note = stale_note(fetched, STALE_AFTER_MIN)
    if note:
        sentences.append(note)
    in_force = _lists_in_force(session)
    lists_phrase = date_hr(date.fromisoformat(in_force), weekday=False) if in_force else None
    return ToolResponse(
        status="ok",
        summary_hr=" ".join(sentences),
        data={
            "query_kind": match.kind,
            "label": match.label,
            "products": [_product(d) for d in drugs[:MAX_PRODUCTS]],
            "products_total": len(drugs),
            "hzzo_lists_in_force": in_force,
            "hzzo_lists_in_force_hr": lists_phrase,
        },
        source=SOURCE,
        updated_at=iso_local(fetched),
    ).with_card_extra(products=[_product(d) for d in drugs[:40]])


def overview(session: Session) -> dict[str, Any]:
    """The medicines page before a search: what the base holds, and HALMED's current shortages
    with the forms of one protected name together."""
    current = ~Drug.revoked
    by_rx = dict(
        session.execute(select(Drug.rx, func.count()).where(current).group_by(Drug.rx)).all()
    )
    by_list = dict(
        session.execute(
            select(Drug.hzzo_list, func.count()).where(current).group_by(Drug.hzzo_list)
        ).all()
    )
    both = by_list.get("DLL+OLL", 0)
    short = session.scalars(select(Drug).where(current, Drug.shortage == SHORTAGE)).all()
    names: dict[str, list[Drug]] = defaultdict(list)
    for d in short:
        names[display_brand(d)].append(d)
    shortages = [
        {
            "label": label,
            "substance": forms[0].active_substance,
            "forms": len(forms),
            "hzzo_list": next((d.hzzo_list for d in forms if d.hzzo_list), None),
        }
        for label, forms in sorted(names.items(), key=lambda kv: normalize(kv[0], drop_words=False))
    ]
    fetched = last_success(session, [SOURCE_KEYS["halmed"]])
    if fetched is None or not by_rx:
        # Before the first import there is nothing to count: no zeros that read as facts.
        return {
            "status": "no_data",
            "total": None,
            "rx": None,
            "otc": None,
            "on_lists": None,
            "lists": None,
            "shortage_forms": None,
            "shortages": [],
            "source": OVERVIEW_SOURCE,
            "updated_at": None,
        }
    return {
        "status": "ok",
        "total": sum(by_rx.values()),
        "rx": by_rx.get(RX, 0),
        "otc": by_rx.get(OTC, 0),
        "on_lists": sum(n for key, n in by_list.items() if key),
        # A medicine on both lists counts for each of them.
        "lists": {
            "oll": by_list.get("OLL", 0) + both,
            "dll": by_list.get("DLL", 0) + both,
            "none": by_list.get("", 0),
        },
        "shortage_forms": len(short),
        "shortages": shortages,
        "source": OVERVIEW_SOURCE,
        "updated_at": iso_local(fetched),
    }

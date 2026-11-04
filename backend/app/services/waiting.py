"""find_waiting_times: first free appointments on HZZO's waiting lists.

Ranking is explained in plain words, without weighted scores: the nearest institution with a
free appointment, then a sooner one within 100 km (if at least two weeks sooner), otherwise the
soonest in Croatia (if at least a month sooner). Institutions contracted for the same kind of
service that publish no list are named as well, so the caller can phone them.
"""

import logging
from dataclasses import dataclass, field, replace
from datetime import datetime
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geo.distance import km_between
from app.geo.gazetteer import Gazetteer, PlaceRecord
from app.geo.normalize import normalize
from app.ingest.cezih import SOURCE
from app.ingest.cezih_jobs import SOURCE_KEY, next_slot
from app.models import HealthFacility, ServiceOffer, WlEntry, WlInstitution
from app.schemas import CandidateOut, Status, ToolResponse
from app.services.common import last_success, location_out, resolve_place, stale_note
from app.services.phrases import WEEKDAY, date_hr, join_or, join_sentences, plural, short_place_name
from app.services.procedures import ProcedureIndex, ProcedureMatch, ProcedureRecord
from app.timeutil import iso_local, local_today, now_utc

NEARBY_KM = 100.0
SOONER_NEARBY_DAYS = 14
SOONER_NATIONAL_DAYS = 30
STALE_AFTER_MIN = 36 * 60
PROVIDERS_SPOKEN = 1
PROVIDERS_CARD = 10
# Every list of a procedure (63 at most on CEZIH): the page filters the table by county.
CARD_ROWS = 100
VARIANT_WORDS = {
    "first": "prvi pregled",
    "control": "kontrolni pregled",
    "consult": "konzultacija bez pacijenta",
    "other": "ostali postupci",
}
SUBTYPE_KIND = {
    "general": "bolnica",
    "special": "specijalna bolnica",
    "health_center": "dom zdravlja",
    "polyclinic": "poliklinika",
    "private_practice": "privatna specijalistička ordinacija",
    "public_health": "zavod za javno zdravstvo",
    "laboratory": "laboratorij",
}
BOOKING_HR = (
    "Treba e-uputnica obiteljskog liječnika. Termin dogovorite telefonom ili e-poštom ustanove, "
    "ili vas naruči liječnik. Prikazani termin nije rezervacija; ustanova ga potvrđuje. Ponesite "
    "zdravstvenu iskaznicu, dopunsko osiguranje i ranije nalaze."
)
_CHILDREN = ("djecj", "djece", "za djecu", "mladez")
log = logging.getLogger(__name__)


@dataclass
class Option:
    entry: WlEntry
    inst: WlInstitution
    slot: datetime
    days: int
    km: float | None


def spoken_label(p: ProcedureRecord) -> str:
    """'Kardiologija - Prvi pregled' -> 'kardiologija (prvi pregled)'; 'MR koljena' stays."""
    base = p.name.split(" - ")[0].strip() if p.variant else p.name
    first = base.split()[0] if base else ""
    if first and not first.isupper():  # acronyms (MR, CT, UZV) keep their capitals
        base = base[0].lower() + base[1:]
    word = VARIANT_WORDS.get(p.variant)
    return f"{base} ({word})" if word else base


def _with_town(name: str, settlement: str, *, brackets: bool = False) -> str:
    """Name to say, with the town unless the name already contains it."""
    town = short_place_name(settlement)
    if not town or normalize(town) in normalize(name):
        return name
    return f"{name} ({town})" if brackets else f"{name}, {town}"


def _where(inst: WlInstitution) -> str:
    return _with_town(inst.spoken_name, inst.settlement)


def _distance(km: float | None) -> str:
    return f", oko {round(km)} km" if km is not None and km >= 2 else ""


def _when(o: Option) -> str:
    day = o.slot.date()
    if o.days == 0:
        return "već danas"
    text = date_hr(day, weekday=False)
    if o.days == 1:
        return f"sutra, {text}"
    return f"{text}, za {_days(o.days)}"


def _days(n: int) -> str:
    return f"{n} {plural(n, 'dan', 'dana', 'dana')}"


def _for(label: str) -> str:
    """'za MR koljena'; a name a template cannot decline stands after 'postupak'."""
    head = label.split(maxsplit=1)[0] if label else ""
    return f"za {label}" if len(head) >= 2 and head.isupper() else f"za postupak {label}"


def _instead(o: Option, nearest: Option) -> str:
    """The saving in the words people use: 'za 22 dana umjesto 265'."""
    if o.days == 0:
        return f"već danas umjesto za {_days(nearest.days)}"
    if o.days == 1:
        return f"već sutra umjesto za {_days(nearest.days)}"
    return f"za {_days(o.days)} umjesto {nearest.days}"


def _alternative(lead: str, o: Option, nearest: Option) -> str:
    """'Ranije, za 12 dana umjesto 70, ima KBC Osijek, oko 35 km: 12. studenoga 2026.'"""
    day = f": {date_hr(o.slot.date(), weekday=False)}" if o.days >= 1 else ""
    return f"{lead}, {_instead(o, nearest)}, ima {_where(o.inst)}{_distance(o.km)}{day}."


def _slot_hr(slot: datetime) -> str:
    return f"{WEEKDAY[slot.weekday()]}, {date_hr(slot.date(), weekday=False)} u {slot:%H:%M}"


# How a sooner option is introduced, and its role in the answer's data.
LEADS = {"sooner": "Ranije", "soonest": "Najranije u Hrvatskoj", "much_sooner": "Puno ranije"}
ROLES = {"sooner": "sooner_nearby", "soonest": "soonest_croatia", "much_sooner": "soonest_croatia"}


@dataclass
class Choice:
    """The nearest free appointment and the sooner one an answer names beside it, if any."""

    nearest: Option
    nearby: list[Option] = field(default_factory=list)  # located, within NEARBY_KM
    other: Option | None = None
    lead: str | None = None  # a key of LEADS when there is a sooner option


def choose(options: list[Option]) -> Choice:
    """Nearest first; then a sooner one within 100 km if at least two weeks sooner, otherwise the
    soonest in Croatia if at least a month sooner. Only institutions with a known location are
    suggested; one without (a private practice) can still be sooner, so "najranije" is checked
    against every option. `options` must hold at least one located option."""
    located = [o for o in options if o.km is not None]
    nearest = min(located, key=lambda o: (o.km, o.days))
    nearby = [o for o in located if o.km is not None and o.km <= NEARBY_KM]
    sooner = min(nearby, key=lambda o: (o.days, o.km), default=None)
    fastest = min(located, key=lambda o: (o.days, o.km))
    best_nearby = min(nearest.days, sooner.days if sooner else nearest.days)
    if sooner and sooner is not nearest and sooner.days <= nearest.days - SOONER_NEARBY_DAYS:
        return Choice(nearest, nearby, sooner, "sooner")
    if fastest is not nearest and fastest.days <= best_nearby - SOONER_NATIONAL_DAYS:
        soonest = fastest.days <= min(o.days for o in options)
        return Choice(nearest, nearby, fastest, "soonest" if soonest else "much_sooner")
    return Choice(nearest, nearby)


def _option_dict(o: Option, role: str) -> dict[str, Any]:
    return {
        # Private practices share one descriptive name: the id tells the rows apart.
        "institution_id": o.inst.id,
        "institution": o.inst.name,
        "spoken_name": o.inst.spoken_name,
        "settlement": o.inst.settlement or None,
        "county": o.inst.county or None,
        "distance_km": round(o.km, 1) if o.km is not None else None,
        "first_slot": o.slot.isoformat(timespec="minutes"),
        "first_slot_hr": _slot_hr(o.slot),
        "wait_days": o.days,
        "phone": o.entry.phone or None,
        # A private practice's e-mail and web address often carry the doctor's name.
        "email": None if o.inst.private_practice else o.entry.email or None,
        "web": None if o.inst.private_practice else o.entry.web or None,
        "list_updated_at": iso_local(o.entry.list_updated_at),
        "role": role,
    }


def _entries(session: Session, procedure_id: int) -> list[tuple[WlEntry, WlInstitution]]:
    rows = session.execute(
        select(WlEntry, WlInstitution)
        .join(WlInstitution, WlEntry.institution_id == WlInstitution.id)
        .where(WlEntry.procedure_id == procedure_id)
    ).all()
    return [(e, i) for e, i in rows]


def _hidden(inst: WlInstitution, proc: ProcedureRecord) -> bool:
    """A children's institution is not offered for an adult's procedure."""
    return inst.children_only and not proc.is_pediatric


def _options(
    rows: list[tuple[WlEntry, WlInstitution]],
    proc: ProcedureRecord,
    place: PlaceRecord | None,
    now: datetime,
) -> list[Option]:
    today = local_today(now)
    out = []
    for entry, inst in rows:
        if _hidden(inst, proc):
            continue
        slot = next_slot(entry, now)
        if slot is None:
            continue
        out.append(Option(entry, inst, slot, (slot.date() - today).days, km_between(place, inst)))
    return out


def _providers(
    session: Session,
    proc: ProcedureRecord,
    rows: list[tuple[WlEntry, WlInstitution]],
    place: PlaceRecord | None,
) -> list[tuple[HealthFacility, float | None]]:
    """Contracted for the same kind of service, not on this list (nearest first, 100 km).
    An institution with a list in one place has it for all its locations (same HZZO code)."""
    if not proc.category:
        return []
    listed = {_institution_code(i.facility_source_id) for _e, i in rows if i.facility_source_id}
    listed_places = {i.place_id for _e, i in rows if i.place_id}
    facilities = session.scalars(
        select(HealthFacility)
        .join(ServiceOffer, ServiceOffer.facility_id == HealthFacility.id)
        .where(ServiceOffer.category == proc.category, HealthFacility.lat.is_not(None))
        .distinct()
    ).all()
    out = []
    for f in facilities:
        if _institution_code(f.source_id) in listed:
            continue
        # A hospital on the list that could not be linked by name is the same building.
        if f.type == "hospital" and f.place_id in listed_places:
            continue
        if not proc.is_pediatric and any(w in normalize(f.name) for w in _CHILDREN):
            continue
        km = km_between(place, f)
        if km is not None and km > NEARBY_KM:
            continue
        out.append((f, km))
    out.sort(key=lambda t: (t[1] if t[1] is not None else 0, t[0].name))
    return out


def _institution_code(source_id: str) -> str:
    """'specialist:902990292:osijek:…' -> 'specialist:902990292' (the HZZO institution code)."""
    return ":".join(source_id.split(":")[:2])


def _provider_dict(f: HealthFacility, km: float | None) -> dict[str, Any]:
    return {
        "name": f.name,
        "kind_hr": SUBTYPE_KIND.get(f.subtype, ""),
        "address": f.address or None,
        "settlement": f.settlement,
        "phone": f.phone or None,
        "distance_km": round(km, 1) if km is not None else None,
    }


def _providers_sentence(providers: list[tuple[HealthFacility, float | None]]) -> str:
    if not providers:
        return ""
    names = [_with_town(f.name, f.settlement, brackets=True) for f, _km in providers]
    head = ", ".join(names[:PROVIDERS_SPOKEN])
    rest = len(names) - PROVIDERS_SPOKEN
    more = f" i još {rest} {plural(rest, 'ustanova', 'ustanove', 'ustanova')}" if rest > 0 else ""
    return (
        f"Ugovor s HZZO-om za tu uslugu ima i {head}{more}, bez objavljene liste čekanja; "
        "termin provjerite telefonom."
    )


def _ambiguous(match: ProcedureMatch, fetched: datetime) -> ToolResponse:
    names = [c.name for c in match.candidates]
    options = join_or(names)
    return ToolResponse(
        status="ambiguous",
        candidates=[CandidateOut(name=n, kind="procedure") for n in names],
        summary_hr=f"Na listama čekanja postoji više takvih postupaka. Mislite li na {options}?",
        source=SOURCE,
        updated_at=iso_local(fetched),
    )


def find_waiting_times(
    session: Session,
    gazetteer: Gazetteer,
    procedures: ProcedureIndex,
    procedure: str,
    location: str | None,
    limit: int,
    procedure_id: int | None = None,
) -> ToolResponse:
    """`procedure` is what the caller said; `procedure_id` skips resolution (UI search)."""
    fetched = last_success(session, [SOURCE_KEY])
    if fetched is None or not len(procedures):
        return ToolResponse(
            status="no_data",
            summary_hr="Liste čekanja HZZO-a trenutno nisu dostupne. Pokušajte malo kasnije.",
            source=SOURCE,
        )
    chosen = procedures.get(procedure_id) if procedure_id is not None else None
    match = ProcedureMatch("ok", procedure=chosen) if chosen else procedures.resolve(procedure)
    if match.status == "not_found":
        return ToolResponse(
            status="not_found",
            summary_hr=(
                "Postupak nije pronađen na listama čekanja HZZO-a. Recite ga drugim riječima, "
                "na primjer kako piše na uputnici."
            ),
            source=SOURCE,
            updated_at=iso_local(fetched),
        )
    if match.status == "ambiguous":
        return _ambiguous(match, fetched)
    proc = match.procedure
    assert proc is not None
    place = None
    if location:
        resolved = resolve_place(gazetteer, location, SOURCE)
        if isinstance(resolved, ToolResponse):
            return resolved
        place = resolved

    now = now_utc()
    rows = _entries(session, proc.id)
    options = _options(rows, proc, place, now)
    # Without a place "the nearest" provider would be arbitrary: they are named only near one.
    providers = _providers(session, proc, rows, place) if place is not None else []
    label = spoken_label(proc)
    data: dict[str, Any] = {
        "procedure": {"id": proc.id, "name": proc.name, "category": proc.category},
        "origin": place.name if place else None,
        "institutions_on_list": len(rows),
        "with_free_slot": len(options),
        "median_days": round(median(o.days for o in options)) if options else None,
        "booking_hr": BOOKING_HR,
        "other_providers": [_provider_dict(f, km) for f, km in providers[:3]],
    }
    note = stale_note(fetched, STALE_AFTER_MIN)

    if not options:
        sentences = [
            (
                f"Z{_for(label)[1:]} na listama čekanja HZZO-a trenutno nema objavljenog "
                "slobodnog termina."
            )
        ]
        if providers:
            sentences.append(_providers_sentence(providers))
        else:
            sentences.append("Termin provjerite kod svog liječnika ili telefonom u bolnici.")
        return _response(
            "no_data", place, sentences, note, data, fetched, rows, options, providers, proc, now
        )

    picked: list[tuple[Option, str]] = []
    if place is not None and any(o.km is not None for o in options):
        choice = choose(options)
        nearest = choice.nearest
        picked.append((nearest, "nearest"))
        sentences = [
            (
                f"Prema listama čekanja HZZO-a, {_for(label)} najbliža ustanova sa slobodnim "
                f"terminom je {_where(nearest.inst)}{_distance(nearest.km)}: {_when(nearest)}."
            )
        ]
        if choice.other is not None and choice.lead is not None:
            picked.append((choice.other, ROLES[choice.lead]))
            sentences.append(_alternative(LEADS[choice.lead], choice.other, nearest))
        # Short for the voice: with a sooner option the contracted providers stay in the data
        # (other_providers) and on the card; alone the nearest leaves room for them.
        if providers and len(sentences) == 1:
            sentences.append(_providers_sentence(providers))
        rest = sorted(
            (o for o in choice.nearby if all(o is not p for p, _r in picked)),
            key=lambda o: o.days,
        )
        # The options the summary names always stay; nearby ones fill up to the limit.
        picked += [(o, "nearby") for o in rest][: max(0, limit - len(picked))]
    else:
        ordered = sorted(options, key=lambda o: o.days)
        best = ordered[0]
        # A private practice is stored without its name: say what it is and where to look.
        who = (
            "jedna privatna specijalistička ordinacija (kontakt je na ekranu)"
            if best.inst.private_practice
            else _where(best.inst)
        )
        n = len(rows)
        verb = plural(n, "je", "su", "je")
        counted = f"{n} {plural(n, 'ustanova', 'ustanove', 'ustanova')}"
        sentences = [
            f"Prema listama čekanja HZZO-a, {_for(label)} najranije ima {who}: {_when(best)}.",
            "Za najbliži termin recite mjesto."
            if place is None
            else f"Na listama {verb} {counted}, ali ni za jednu nije poznato gdje je.",
        ]
        picked = [(o, "soonest_croatia" if i == 0 else "soon") for i, o in enumerate(ordered)]
        picked = picked[:limit]
    data["options"] = [_option_dict(o, role) for o, role in picked]
    return _response(
        "ok", place, sentences, note, data, fetched, rows, options, providers, proc, now
    )


def _response(
    status: Status,
    place: PlaceRecord | None,
    sentences: list[str],
    note: str | None,
    data: dict[str, Any],
    fetched: datetime,
    rows: list[tuple[WlEntry, WlInstitution]],
    options: list[Option],
    providers: list[tuple[HealthFacility, float | None]],
    proc: ProcedureRecord,
    now: datetime,
) -> ToolResponse:
    if note:  # at most three sentences: the stale-data note replaces the providers sentence
        sentences = [*sentences[:2], note]
    entries = sorted(options, key=lambda o: (o.days, o.km if o.km is not None else 1e9))
    # Lists with no free appointment, and children's institutions (not offered to adults), nearest
    # first where the place is known: their telephone is all the answer has for them.
    without = sorted(
        ((e, i) for e, i in rows if next_slot(e, now) is None and not _hidden(i, proc)),
        key=lambda t: _km_or_last(place, t[1]),
    )
    children = [
        (e, i, slot)
        for e, i in rows
        if _hidden(i, proc) and (slot := next_slot(e, now)) is not None
    ]
    return ToolResponse(
        status=status,
        location=location_out(place) if place else None,
        summary_hr=join_sentences(sentences),
        data=data,
        source=SOURCE,
        updated_at=iso_local(fetched),
    ).with_card_extra(
        entries=[_option_dict(o, "list") for o in entries[:CARD_ROWS]],
        without_slot=[_left_out(e, i, place) for e, i in without[:CARD_ROWS]],
        children_only=[
            {**_left_out(e, i, place), "first_slot": slot.isoformat(timespec="minutes")}
            for e, i, slot in children[:CARD_ROWS]
        ],
        providers=[_provider_dict(f, km) for f, km in providers[:PROVIDERS_CARD]],
    )


def _km_or_last(place: PlaceRecord | None, inst: WlInstitution) -> float:
    km = km_between(place, inst)
    return km if km is not None else float("inf")


def _left_out(entry: WlEntry, inst: WlInstitution, place: PlaceRecord | None) -> dict[str, Any]:
    """A list the answer does not offer (no free appointment, or only for children), with the
    contact to ask about it. A private practice's e-mail often carries the doctor's name."""
    km = km_between(place, inst)
    return {
        "institution_id": inst.id,
        "institution": inst.name,
        "spoken_name": inst.spoken_name,
        "settlement": inst.settlement or None,
        "distance_km": round(km, 1) if km is not None else None,
        "phone": entry.phone or None,
        "email": None if inst.private_practice else entry.email or None,
    }


# The front page's examples: common referrals, in the larger town of each region.
EXAMPLE_PROCEDURES = (
    "MR koljena",
    "MR lumbosakralne kralježnice",
    "CT mozga",
    "UZV abdomena",
    "kolonoskopija",
    "gastroskopija",
    "mamografija",
    "UZV štitnjače",
    "pregled kod kardiologa",
    "pregled kod okulista",
    "pregled kod neurologa",
    "pregled kod ortopeda",
    "pregled kod dermatologa",
)
EXAMPLE_TOWNS = (
    "Zagreb",
    "Split",
    "Rijeka",
    "Osijek",
    "Zadar",
    "Slavonski Brod",
    "Pula",
    "Karlovac",
    "Varaždin",
    "Šibenik",
    "Sisak",
    "Vinkovci",
    "Dubrovnik",
    "Bjelovar",
    "Koprivnica",
    "Čakovec",
    "Požega",
    "Vukovar",
    "Virovitica",
    "Gospić",
)
MIN_EXAMPLE_SAVING = 30


def _from(options: list[Option], place: PlaceRecord) -> list[Option]:
    """The same free appointments, measured from another place (as _options measures them)."""
    return [replace(o, km=km_between(place, o.inst)) for o in options]


def examples(
    session: Session,
    gazetteer: Gazetteer,
    procedures: ProcedureIndex,
    limit: int = 3,
    queries: tuple[str, ...] = EXAMPLE_PROCEDURES,
    towns: tuple[str, ...] = EXAMPLE_TOWNS,
) -> dict[str, Any]:
    """Real cases from today's lists where the answer for a town names a sooner appointment
    within 100 km ("Ranije, za 22 dana umjesto 265"): the same rule as find_waiting_times, so the
    page an example links to shows the same numbers. Biggest saving first, at most one per
    procedure and one per town."""
    fetched = last_success(session, [SOURCE_KEY])
    if fetched is None or not len(procedures):
        return {"status": "no_data", "examples": [], "source": SOURCE, "updated_at": None}
    now = now_utc()
    places = []
    for town in towns:
        res = gazetteer.resolve(town)
        if res.status == "ok" and res.place is not None and res.place.lat is not None:
            places.append(res.place)
    found: list[tuple[int, ProcedureRecord, PlaceRecord, Option, Option]] = []
    for query in queries:
        match = procedures.resolve(query)
        if match.status != "ok" or match.procedure is None:
            log.warning("example procedure %r resolves to %s, skipped", query, match.status)
            continue
        proc = match.procedure
        base = _options(_entries(session, proc.id), proc, None, now)
        for place in places:
            options = _from(base, place)
            if not any(o.km is not None for o in options):
                continue
            choice = choose(options)
            sooner = choice.other
            if choice.lead != "sooner" or sooner is None:
                continue
            saving = choice.nearest.days - sooner.days
            if saving >= MIN_EXAMPLE_SAVING:
                found.append((saving, proc, place, choice.nearest, sooner))
    found.sort(key=lambda t: -t[0])
    out: list[dict[str, Any]] = []
    used_procedures: set[int] = set()
    used_towns: set[str] = set()
    for saving, proc, place, nearest, sooner in found:
        if proc.id in used_procedures or place.name in used_towns:
            continue
        used_procedures.add(proc.id)
        used_towns.add(place.name)
        out.append(
            {
                "procedure": {"id": proc.id, "name": proc.name, "label": spoken_label(proc)},
                "location": location_out(place).model_dump(),
                "nearest": _option_dict(nearest, "nearest"),
                "sooner": _option_dict(sooner, "sooner_nearby"),
                "saving_days": saving,
            }
        )
        if len(out) == limit:
            break
    return {
        "status": "ok" if out else "no_data",
        "examples": out,
        "source": SOURCE,
        "updated_at": iso_local(fetched),
    }

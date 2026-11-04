"""Shared building blocks for tool services."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geo.gazetteer import Gazetteer, PlaceRecord
from app.geo.normalize import name_variants, normalize
from app.models import SourceStatus
from app.schemas import CandidateOut, LocationOut, ToolResponse
from app.services.phrases import county_locative, join_or, short_place_name
from app.timeutil import ensure_utc, now_utc, to_local


def location_out(place: PlaceRecord) -> LocationOut:
    return LocationOut(name=place.name, municipality=place.municipality_label, county=place.county)


def resolve_place(gazetteer: Gazetteer, query: str, source: str) -> PlaceRecord | ToolResponse:
    """The resolved place, or a ready ambiguous/not_found response."""
    res = gazetteer.resolve(qualified_query(gazetteer, query))
    if res.status == "ok" and res.place is not None:
        return res.place
    if res.status == "ambiguous":
        options = join_or([spoken_option(gazetteer, c, query) for c in res.candidates])
        return ToolResponse(
            status="ambiguous",
            candidates=[
                CandidateOut(name=c.name, county=c.county, municipality=c.municipality_label)
                for c in res.candidates
            ],
            summary_hr=f"Postoji više mjesta s tim nazivom. Mislite li na {options}?",
            source=source,
        )
    return ToolResponse(
        status="not_found",
        summary_hr="Mjesto nije pronađeno. Ponovite naziv ili recite najbliži veći grad.",
        source=source,
    )


def spoken_option(gazetteer: Gazetteer, place: PlaceRecord, query: str = "") -> str:
    """A place offered in a question, in the fewest words that, said back, resolve to it
    (through qualified_query): 'Sveti Ivan Zelina', 'Novigrad u Istarskoj županiji', 'Bukevje u
    općini Orle', 'Podstrana – Strožanac Donji'. Options of one question so never coincide. A
    seat found by its JLS's name says the JLS: 'Nedešćina u općini Sveta Nedelja'."""
    short = short_place_name(place.name)
    kind = "gradu" if place.municipality_type == "Grad" else "općini"
    in_jls = f"u {kind} {short_place_name(place.municipality)}"
    options: tuple[str, ...] = (
        short,
        f"{short} u {county_locative(place.county)}",
        f"{short} {in_jls}",
        place.name,
        f"{place.name} {in_jls}",
    )
    said = normalize(query.split(",")[0])
    if said and said not in _keys(place.name) and said in _keys(place.municipality):
        options = options[2:]
    for option in options:
        res = gazetteer.resolve(qualified_query(gazetteer, option))
        if res.status == "ok" and res.place is not None and res.place.id == place.id:
            return option
    return options[-1]


def _keys(name: str) -> set[str]:
    """A name as the gazetteer matches it: whole, and each part of a bilingual name."""
    return {normalize(v) for v in name_variants(name)}


def _locative_key(text: str) -> str:
    """'Istarskoj županiji' and 'Istarskoj' -> 'istarskoj'; 'Gradu Zagrebu' -> 'gradu zagrebu'."""
    return normalize(text, drop_words=False).removesuffix(" zupaniji")


def qualified_query(gazetteer: Gazetteer, query: str) -> str:
    """A choice said as the question offered it, as a qualified name for the gazetteer:
    'Novigrad u Istarskoj županiji' -> 'Novigrad, Istarska', 'Luka u gradu Vrbovec' ->
    'Luka, Vrbovec'. Names that hold 'u' themselves ('Sveti Petar u Šumi') stay as they are."""
    words = query.split()
    if "u" not in (w.lower() for w in words[1:-1]):
        return query
    counties = {_locative_key(county_locative(c)): c for c in gazetteer.counties}
    for i in range(len(words) - 2, 0, -1):  # the last 'u' first: 'Sveti Petar u Šumi u …'
        if words[i].lower() != "u":
            continue
        head, tail = " ".join(words[:i]), words[i + 1 :]
        county = counties.get(_locative_key(" ".join(tail)))
        if county:
            return f"{head}, {county}"
        if len(tail) > 1 and normalize(tail[0], drop_words=False) in ("gradu", "opcini"):
            return f"{head}, {' '.join(tail[1:])}"
    return query


def last_success(session: Session, keys: list[str]) -> datetime | None:
    rows = session.scalars(select(SourceStatus).where(SourceStatus.source_key.in_(keys))).all()
    times = [ensure_utc(r.last_success_at) for r in rows if r.last_success_at]
    return max(times) if times else None


def stale_note(fetched: datetime | None, max_age_min: int) -> str | None:
    if fetched is None or now_utc() - fetched <= timedelta(minutes=max_age_min):
        return None
    local = to_local(fetched)
    return (
        f"Napomena: podaci nisu osvježeni od {local:%H:%M} ({local.day}. {local.month}.)"
        ", pa su možda zastarjeli."
    )

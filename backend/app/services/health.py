"""find_health_facilities: nearest facilities by haversine from the settlement's centroid."""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geo.distance import Box, box_around, km_between
from app.geo.gazetteer import Gazetteer, PlaceRecord
from app.geo.normalize import strip_diacritics
from app.ingest.hzzo import SOURCE
from app.ingest.hzzo_jobs import SOURCE_KEYS
from app.models import HealthFacility, SourceStatus
from app.schemas import FacilityType, ToolResponse
from app.services.common import last_success, location_out, resolve_place
from app.services.phrases import MONTH_GENITIVE, plural, short_place_name
from app.timeutil import iso_local, to_local

TYPE_LABELS = {
    "family_medicine": ("ordinacija opće medicine", "ordinacije opće medicine"),
    "pediatrics": ("pedijatrijska ordinacija", "pedijatrijske ordinacije"),
    "gynecology": ("ginekološka ordinacija", "ginekološke ordinacije"),
    "dentistry": ("stomatološka ordinacija", "stomatološke ordinacije"),
    "hospital": ("bolnica", "bolnice"),
    "any": ("zdravstvena ustanova", "zdravstvene ustanove"),
}
GENITIVE_PLURAL = {
    "family_medicine": "ordinacija opće medicine",
    "pediatrics": "pedijatrijskih ordinacija",
    "gynecology": "ginekoloških ordinacija",
    "dentistry": "stomatoloških ordinacija",
    "hospital": "bolnica",
    "any": "zdravstvenih ustanova",
}
SUBTYPE_LABELS = {
    "dz": "dom zdravlja",
    "concession": "privatna ordinacija u mreži HZZO-a",
    "general": "opća ili klinička bolnica",
    "special": "specijalna bolnica ili klinika",
}
SAME_PLACE_KM = 0.5
# Facilities are read from a box around the place, widened until it holds the answer: all of
# the country's ~5,000 practices for every call would take most of the latency budget.
SEARCH_RADII_KM = (25.0, 100.0)
# Same distance and address: family medicine first, as listed in TYPE_LABELS.
TYPE_ORDER = {t: i for i, t in enumerate(TYPE_LABELS)}


def _as_of(session: Session) -> dict[str, str]:
    """Month each HZZO list describes, from the file names ('pzz': '2026-09')."""
    out = {}
    for kind in ("pzz", "hospitals"):
        status = session.get(SourceStatus, SOURCE_KEYS[kind])
        local = to_local(status.source_updated_at) if status else None
        if local:
            out[kind] = f"{local.year}-{local.month:02d}"
    return out


def _as_of_phrase(as_of: dict[str, str], types: set[str]) -> str:
    """'rujna 2026.' (or 'rujna 2026. i veljače 2026.'); empty if the month is unknown."""
    kinds = ["pzz"] if types - {"hospital"} else []
    if "hospital" in types:
        kinds.append("hospitals")
    months = []
    for kind in kinds:
        if kind in as_of:
            year, month = as_of[kind].split("-")
            phrase = f"{MONTH_GENITIVE[int(month) - 1]} {year}."
            if phrase not in months:
                months.append(phrase)
    return " i ".join(months)


def _query(session: Session, facility_type: FacilityType, box: Box | None) -> list[HealthFacility]:
    stmt = select(HealthFacility).where(HealthFacility.lat.is_not(None))
    if facility_type == "hospital":
        stmt = stmt.where(HealthFacility.type == "hospital", HealthFacility.subtype == "general")
    elif facility_type == "any":
        pzz = [t for t in TYPE_LABELS if t not in ("hospital", "any")]
        stmt = stmt.where(
            HealthFacility.type.in_(pzz)
            | ((HealthFacility.type == "hospital") & (HealthFacility.subtype == "general"))
        )
    else:
        stmt = stmt.where(HealthFacility.type == facility_type)
    if box is not None:
        stmt = stmt.where(
            HealthFacility.lat.between(box.min_lat, box.max_lat),
            HealthFacility.lon.between(box.min_lon, box.max_lon),
        )
    # A fixed order, so equal distances rank the same whichever rows the box holds.
    return list(session.scalars(stmt.order_by(HealthFacility.id)))


def _address_key(address: str) -> str:
    return re.sub(r"[^a-z0-9]", "", strip_diacritics(address.lower()))


def _count_word(n: int, facility_type: FacilityType) -> str:
    """1 ordinacija, 2–4 ordinacije, 5+ ordinacija."""
    return plural(n, *TYPE_LABELS[facility_type], GENITIVE_PLURAL[facility_type])


def _spoken_item(f: HealthFacility, km: float, facility_type: FacilityType) -> str:
    town = short_place_name(f.settlement)
    where = f"{f.address}, {town}" if f.address else town
    if f.type == "hospital":
        head = f"{f.name}, {where}"
    elif facility_type == "any":
        head = f"{TYPE_LABELS[f.type][0]}, {where}"
    else:
        head = where
    if km >= SAME_PLACE_KM:
        head += f", oko {round(km)} km" if km >= 1.5 else ", oko 1 km"
    return head


Ranked = list[tuple[float, HealthFacility]]


def _nearest(
    facilities: list[HealthFacility], place: PlaceRecord, limit: int
) -> tuple[Ranked, int]:
    """The `limit` nearest, several practices at one address (doctors in the same building)
    counted once, and how many facilities are in the place itself."""
    ordered = sorted(
        (
            (dist, f.subtype != "dz", f.address, TYPE_ORDER.get(f.type, len(TYPE_ORDER)), f)
            for f in facilities
            if (dist := km_between(place, f)) is not None
        ),
        key=lambda t: t[:4],
    )
    seen: set[tuple[str, str, str]] = set()
    ranked: Ranked = []
    for km, *_, f in ordered:
        key = (f.type, _address_key(f.address), f.settlement)
        if key in seen:
            continue
        seen.add(key)
        ranked.append((km, f))
        if len(ranked) == limit:
            break
    return ranked, sum(1 for km, *_ in ordered if km < SAME_PLACE_KM)


def _search(
    session: Session, place: PlaceRecord, facility_type: FacilityType, limit: int
) -> tuple[Ranked, int]:
    """_nearest over a widening box. Everything within the radius is inside the box, so an
    answer that ends within the radius is the same as over the whole country."""
    if place.lat is None or place.lon is None:
        return [], 0
    for radius in SEARCH_RADII_KM:
        box = box_around(place.lat, place.lon, radius)
        ranked, in_town = _nearest(_query(session, facility_type, box), place, limit)
        if len(ranked) == limit and ranked[-1][0] <= radius:
            return ranked, in_town
    return _nearest(_query(session, facility_type, None), place, limit)


def find_health_facilities(
    session: Session, gazetteer: Gazetteer, location: str, facility_type: FacilityType, limit: int
) -> ToolResponse:
    resolved = resolve_place(gazetteer, location, SOURCE)
    if isinstance(resolved, ToolResponse):
        return resolved
    place = resolved
    fetched = last_success(session, list(SOURCE_KEYS.values()))
    ranked, in_town = _search(session, place, facility_type, limit)
    if not ranked or fetched is None:
        return ToolResponse(
            status="no_data",
            location=location_out(place),
            summary_hr=f"Podaci HZZO-a trenutno nisu dostupni: {TYPE_LABELS[facility_type][1]}.",
            source=SOURCE,
            updated_at=iso_local(fetched),
        )

    items = [_spoken_item(f, km, facility_type) for km, f in ranked]
    singular, plural_label = TYPE_LABELS[facility_type]
    types = {f.type for _km, f in ranked}
    if all(km < SAME_PLACE_KM for km, _f in ranked) and in_town > len(ranked):
        # Locations are known only to settlement level: do not pretend these are the nearest.
        lead = (
            f"u mjestu {place.name} ima {in_town} {_count_word(in_town, facility_type)}, na primjer"
        )
    elif len(items) == 1:
        lead = f"najbliža {singular} je"
    else:
        lead = f"najbliže {plural_label} su"
    as_of = _as_of(session)
    month = _as_of_phrase(as_of, types)
    summary = f"Prema podacima HZZO-a, {lead}: {'; '.join(items)}. " + (
        f"Popis je iz {month}; radno vrijeme provjerite telefonom."
        if month
        else "Radno vrijeme provjerite telefonom."
    )
    return ToolResponse(
        status="ok",
        location=location_out(place),
        summary_hr=summary,
        data={
            "facility_type": facility_type,
            "distance_from": f"središte naselja {place.name}",
            "facilities": [
                {
                    "name": f.name,
                    "type": f.type,
                    "type_hr": TYPE_LABELS[f.type][0],
                    "kind_hr": SUBTYPE_LABELS.get(f.subtype, ""),
                    "address": f.address,
                    "settlement": f.settlement,
                    "municipality": f.municipality,
                    "phone": f.phone or None,
                    "insured_count": f.insured_count,
                    "distance_km": round(km, 1),
                    "location_precision": "naselje",
                }
                for km, f in ranked
            ],
            "in_same_settlement": in_town,
            "data_as_of": as_of,
        },
        source=SOURCE,
        updated_at=iso_local(fetched),
    )

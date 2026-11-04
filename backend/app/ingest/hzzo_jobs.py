"""Daily HZZO registries ingest: find the current files, download, parse, geocode, store.

Locations are known to settlement level: the address is resolved to a settlement of the
gazetteer (inside the counties of the HZZO office), whose centroid gives the coordinates.
"""

import logging
import re
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.categories import category_for_activity
from app.config import get_settings
from app.db import session_scope
from app.geo.gazetteer import Gazetteer, PlaceRecord
from app.geo.normalize import normalize
from app.geo.store import load_gazetteer
from app.ingest import hzzo
from app.ingest.http import fetch_bytes, fetch_to_file
from app.ingest.status import check_plausible, mark_error, mark_success
from app.models import HealthFacility, ServiceOffer
from app.timeutil import now_utc

log = logging.getLogger(__name__)

SOURCE_KEYS = {"pzz": "hzzo_pzz", "specialist": "hzzo_skzz", "hospitals": "hzzo_hospitals"}
# Generic words of hospital names; the rest (town, saint, person) identifies the hospital.
_GENERIC = {
    *["opca", "zupanijska", "bolnica", "bolnicki", "klinicka", "klinicki", "centar", "specijalna"],
    *["za", "i", "s", "dr", "prim", "medicinsku", "rehabilitaciju"],
    *["hrvatskih", "veterana", "branitelja", "domovinskog", "rata"],
}


def geocode(row: hzzo.FacilityRow, gaz: Gazetteer) -> PlaceRecord | None:
    """Settlement of the address (or its JLS), resolved inside the HZZO office's counties."""
    names = [row.settlement]
    if "-" in row.settlement:  # "Zagreb-Novi Zagreb" (post office) -> "Zagreb"
        names.append(row.settlement.split("-")[0].strip())
    names.append(row.municipality)
    hints: tuple[str | None, ...] = row.counties or (None,)
    for name in names:
        if not name:
            continue
        for hint in hints:
            res = gaz.resolve(name, county_hint=hint)
            place = res.place
            if res.status == "ok" and place is not None and (hint is None or place.county == hint):
                return place
    return None


def _tokens(name: str) -> set[str]:
    return set(normalize(name.replace('"', " "), drop_words=False).split()) - _GENERIC


# Hospitals renamed since the 2017 address book: a word of the current name -> the old name.
# "Insula – Županijska specijalna bolnica za psihijatriju i rehabilitaciju, Kampor 224, Rab"
# (Pravilnik o listi psihijatrijskih ustanova, NN 56/2025); in 2017 the same address was
# "Psihijatrijska bolnica Rab".
RENAMED = {"insula": "PSIHIJATRIJSKA BOLNICA RAB"}


def match_address(
    row: hzzo.FacilityRow, addresses: list[hzzo.HospitalAddress], gaz: Gazetteer
) -> hzzo.HospitalAddress | None:
    """The 2017 address book entry of a hospital: the distinctive words of the names must
    agree (Merkur vs Dubrava, Zadar vs Zabok), and the town must be in the hospital's county."""
    words = _tokens(row.name)
    for word, old_name in RENAMED.items():
        if word in words:
            return next((a for a in addresses if a.name == old_name), None)
    best: tuple[float, hzzo.HospitalAddress] | None = None
    for a in addresses:
        other = _tokens(a.name)
        if not words or not other:
            continue
        overlap = len(words & other) / len(words | other)
        if not (words <= other or other <= words or overlap >= 0.5):
            continue
        if row.counties and _town_in_county(a.town, row.counties, gaz) is None:
            continue
        if best is None or overlap > best[0]:
            best = (overlap, a)
    return best[1] if best else None


def _town_in_county(name: str, counties: tuple[str, ...], gaz: Gazetteer) -> PlaceRecord | None:
    """Exact (not fuzzy) settlement of that name in one of the counties."""
    norm = normalize(name)
    for county in counties or (None,):
        res = gaz.resolve(name, county_hint=county)
        place = res.place
        if (
            res.status == "ok"
            and place is not None
            and (county is None or place.county == county)
            and norm in (normalize(place.name), normalize(place.municipality))
        ):
            return place
    return None


def _with_quotes(network_name: str, book_name: str) -> str:
    """Quoted proper names of the address book ('"SVETI DUH"') marked in the 2026 name."""
    for phrase in re.findall(r'"([^"]+)"', book_name):
        if phrase in network_name and f'"{phrase}"' not in network_name:
            network_name = network_name.replace(phrase, f'"{phrase}"', 1)
    return network_name


def build_hospitals(
    network: list[hzzo.FacilityRow], addresses: list[hzzo.HospitalAddress], gaz: Gazetteer
) -> list[hzzo.FacilityRow]:
    """Hospital network (2026, current names) with addresses from the address book (2017)
    where they match; otherwise the town comes from the hospital's name ('... Lipik')."""
    out = []
    for row in network:
        addr = match_address(row, addresses, gaz)
        if addr is not None:
            town, street, phone = addr.town, addr.street, addr.phone
            raw_name = _with_quotes(row.name, addr.name)
        else:
            town, street, phone, raw_name = _town_in_name(row, gaz), "", "", row.name
        out.append(
            replace(
                row,
                name=hzzo.hospital_name(raw_name, town),
                street=street,
                settlement=town,
                municipality=town,
                phone=phone,
            )
        )
    return out


def _town_in_name(row: hzzo.FacilityRow, gaz: Gazetteer) -> str:
    """A word (or two) of the name that is a settlement of the hospital's county
    ('... PAKRAC I BOLNICA HRVATSKIH VETERANA' -> Pakrac)."""
    words = [w for w in row.name.replace('"', " ").split() if normalize(w) not in _GENERIC]
    for n in (2, 1):
        for i in range(len(words) - n, -1, -1):
            place = _town_in_county(" ".join(words[i : i + n]).title(), row.counties, gaz)
            if place is not None:
                return place.name
    return ""


def store_facilities(
    session: Session, kind: str, rows: list[hzzo.FacilityRow], gaz: Gazetteer
) -> tuple[int, int]:
    """Replace facilities (and their offers) of one source; returns (stored, without place)."""
    key = SOURCE_KEYS[kind]
    fetched = now_utc()
    session.execute(delete(ServiceOffer).where(ServiceOffer.source_key == key))
    session.execute(delete(HealthFacility).where(HealthFacility.source_key == key))
    missing = 0
    pairs: list[tuple[HealthFacility, hzzo.FacilityRow]] = []
    for row in rows:
        place = geocode(row, gaz)
        missing += place is None
        facility = HealthFacility(
            name=row.name,
            type=row.type,
            subtype=row.subtype,
            address=row.street,
            settlement=place.name if place else row.settlement,
            municipality=place.municipality if place else row.municipality,
            county=place.county if place else (row.counties[0] if row.counties else ""),
            place_id=place.id if place else None,
            lat=place.lat if place else None,
            lon=place.lon if place else None,
            coord_source="settlement" if place else "none",
            phone=row.phone,
            hzzo_code=row.hzzo_code,
            insured_count=row.insured_count,
            source_key=key,
            source_id=row.source_id,
            fetched_at=fetched,
        )
        session.add(facility)
        pairs.append((facility, row))
    session.flush()
    for facility, row in pairs:
        for offer in row.offers:
            category = category_for_activity(offer.activity_code, offer.dtp_code)
            session.add(
                ServiceOffer(
                    facility_id=facility.id,
                    category=category.key if category else None,
                    activity_code=offer.activity_code,
                    activity_name=offer.activity_name[:200],
                    dtp_code=offer.dtp_code[:80],
                    source_key=key,
                )
            )
    return len(rows), missing


def reclassify_hospitals(session: Session) -> int:
    """Specialty clinics stored as general hospitals before the name decided it (a database or
    snapshot from an earlier download) become special ones; returns how many changed."""
    changed = 0
    rows = session.scalars(
        select(HealthFacility).where(
            HealthFacility.type == "hospital", HealthFacility.subtype == "general"
        )
    )
    for f in rows:
        if not hzzo.is_general_hospital(f.name, listed_general=True):
            f.subtype = "special"
            changed += 1
    return changed


def relink_facilities(session: Session, gaz: Gazetteer) -> int:
    """After the gazetteer is rebuilt (seed), point facilities to the new settlement rows."""
    linked = 0
    for f in session.scalars(select(HealthFacility).where(HealthFacility.settlement != "")):
        res = gaz.resolve(f.settlement, county_hint=f.county or None)
        options = [res.place] if res.status == "ok" else res.candidates
        place = next(
            (p for p in options if p and p.county == f.county and p.municipality == f.municipality),
            None,
        )
        f.place_id = place.id if place else None
        f.lat, f.lon = (place.lat, place.lon) if place else (None, None)
        linked += place is not None
    return linked


def discover() -> dict[str, str]:
    urls = dict(hzzo.FALLBACK_URLS)
    try:
        urls.update(hzzo.discover_files(fetch_bytes(hzzo.PAGE_URL)))
    # Unreachable or changed page: the last known links still work.
    except Exception as exc:  # noqa: BLE001
        log.warning("HZZO page not readable, using last known links: %s", exc)
    return urls


def _as_of(*days: date | None) -> datetime | None:
    known = [d for d in days if d]
    return datetime.combine(min(known), datetime.min.time(), tzinfo=UTC) if known else None


def fetch_health_facilities(gazetteer: Gazetteer | None = None) -> None:
    raw = get_settings().raw_dir / "hzzo"
    urls = discover()

    def download(key: str) -> Path:
        suffix = ".xls" if urls[key].lower().endswith(".xls") else ".xlsx"
        return fetch_to_file(urls[key], raw / f"{key}{suffix}", refresh=True)

    def load_pzz(_gaz: Gazetteer) -> list[hzzo.FacilityRow]:
        return [r for t in hzzo.PZZ_TYPES for r in hzzo.parse_pzz(download(t), t)]

    def load_specialist(_gaz: Gazetteer) -> list[hzzo.FacilityRow]:
        return hzzo.parse_skzz(download("skzz"))

    def load_hospitals(gaz: Gazetteer) -> list[hzzo.FacilityRow]:
        network = hzzo.parse_hospital_network(download("hospital_network"))
        addresses = hzzo.parse_hospital_addresses(download("hospital_addresses"))
        return build_hospitals(network, addresses, gaz)

    groups: dict[str, tuple[Callable[[Gazetteer], list[hzzo.FacilityRow]], datetime | None]] = {
        "pzz": (load_pzz, _as_of(*(hzzo.file_as_of(urls[t]) for t in hzzo.PZZ_TYPES))),
        "specialist": (load_specialist, _as_of(hzzo.file_as_of(urls["skzz"]))),
        "hospitals": (load_hospitals, _as_of(hzzo.file_as_of(urls["hospital_network"]))),
    }
    for kind, (load, as_of) in groups.items():
        key = SOURCE_KEYS[kind]
        try:
            with session_scope() as session:
                gaz = gazetteer or load_gazetteer(session)
                rows = load(gaz)
                check_plausible(session, key, len(rows))
                stored, missing = store_facilities(session, kind, rows, gaz)
                mark_success(session, key, stored, as_of)
            log.info("%s: %s facilities, %s without a settlement", key, stored, missing)
        except Exception as exc:
            log.exception("%s failed", key)
            with session_scope() as session:
                mark_error(session, key, f"{type(exc).__name__}: {exc}")

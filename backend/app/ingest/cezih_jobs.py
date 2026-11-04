"""CEZIH waiting lists ingest: every procedure page, one request at a time.

Per procedure the entries are replaced; a daily snapshot keeps the waiting time for trends,
because the portal keeps no history. Institutions are named on the lists only by abbreviated
names ("OŽB Vinkovci", "KBC Split (KBC SPLIT FIRULE)") and mostly without an address, so each
one is located by InstitutionLocator.
"""

import gzip
import hashlib
import json
import logging
import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.categories import category_for_procedure, is_pediatric_procedure, procedure_variant
from app.config import get_settings
from app.db import session_scope
from app.geo.gazetteer import Gazetteer, PlaceRecord
from app.geo.normalize import name_variants, normalize
from app.geo.store import load_gazetteer
from app.ingest import cezih
from app.ingest.http import FetchError, fetch_bytes, http_client
from app.ingest.hzzo import hospital_name
from app.ingest.status import MIN_SHARE_OF_LAST, mark_error, mark_success
from app.models import County, HealthFacility, WlEntry, WlInstitution, WlProcedure, WlSnapshot
from app.timeutil import local_today, now_utc, to_local

log = logging.getLogger(__name__)

SOURCE_KEY = "cezih_lists"
REQUEST_DELAY_S = 1.0  # politeness: one list page per second
SNAPSHOT_DAYS = 120
MAX_FAILED_SHARE = 0.2
MAX_FAILED_IN_A_ROW = 10  # the portal is down: stop instead of hours of retries
# More procedures gone at once is a cut-off list, not CEZIH withdrawing them: they are kept.
MAX_WITHDRAWN_SHARE = 0.1
RARE_USES = 2  # a word in at most this many registry names is "rare"

ABBREVIATIONS = {
    "KBC": "Klinički bolnički centar",
    "KB": "Klinička bolnica",
    "OB": "Opća bolnica",
    "OŽB": "Opća županijska bolnica",
    "ŽB": "Županijska bolnica",
    "ŽSB": "Županijska specijalna bolnica",
    "SB": "Specijalna bolnica",
    "PB": "Psihijatrijska bolnica",
    "DB": "Dječja bolnica",
    "DZ": "Dom zdravlja",
    "POL.": "Poliklinika",
}
_HOSPITAL_WORDS = ("bolnic", "lijeciliste", "ljeciliste", "thalassotherapia")
# "Poliklinika" also as written on some lists: "Poliklinka", "Polikllinika", "Polilklinika".
_POLYCLINIC_WORDS = ("polikl", "polilk", "polikn")
_PRIVATE = re.compile(r"^(p o |spec ord|specijalisticka .*ordinacija|ordinacija )")
_CHILDREN = ("djecj", "djece", "za djecu", "srebrnjak", "mladez")
# Words that say what kind of institution it is, not which one.
_GENERIC = {
    *["opca", "zupanijska", "bolnica", "bolnicki", "klinicka", "klinicki", "centar"],
    *["specijalna", "psihijatrijska", "djecja", "za", "i", "s", "dr", "prim", "medicinsku"],
    *["rehabilitaciju", "hrvatskih", "veterana", "branitelja", "domovinskog", "rata"],
    *["dom", "domovi", "zdravlja", "poliklinika", "klinika", "zavod", "nastavni", "lokacija"],
    *["zupanije", "zupanija", "ustanova", "u", "stomatoloska", "stomatologiju", "dentalna"],
    *["dentalne", "medicine"],
}


def split_name(raw: str) -> tuple[str, str]:
    """'KBC Split (KBC SPLIT FIRULE)' -> ('KBC Split', 'KBC SPLIT FIRULE')."""
    m = re.match(r"^(.*?)\s*\((.+)\)\s*$", raw)
    return (m.group(1).strip(), m.group(2).strip()) if m else (raw.strip(), "")


def expand(name: str) -> str:
    """'OŽB Vinkovci' -> 'Opća županijska bolnica Vinkovci' (said, not spelled out);
    names written in capitals get sentence case ('ISTARSKI DOMOVI ZDRAVLJA')."""
    if name.isupper():
        return hospital_name(name)
    words = name.split()
    if words and words[0].upper() in ABBREVIATIONS and words[0].isupper():
        words[0] = ABBREVIATIONS[words[0].upper()]
    return " ".join(words)


def _tokens(name: str) -> set[str]:
    words = set(normalize(name, drop_words=False).split()) - _GENERIC
    return {w for w in words if not w.startswith(_POLYCLINIC_WORDS)}


def _kind(name: str) -> str | None:
    """Which registry type a CEZIH name points to (None: unknown)."""
    words = normalize(expand(name), drop_words=False).split()
    if any(w.startswith(_POLYCLINIC_WORDS) for w in words):
        return "polyclinic"
    if words[:2] in (["dom", "zdravlja"], ["domovi", "zdravlja"]):
        return "health_center"
    if any(w.startswith(_HOSPITAL_WORDS) or w == "klinika" for w in words):
        return "hospital"
    if "zavod" in words:
        return "public_health"
    return None


@dataclass
class Located:
    place: PlaceRecord | None
    geo_source: str
    spoken_name: str
    facility_source_id: str = ""


@dataclass(frozen=True)
class _Facility:
    source_id: str
    name: str
    kind: str  # hospital | health_center | polyclinic | public_health
    place_id: int | None
    tokens: frozenset[str]  # distinctive name words
    around: frozenset[str]  # words of its settlement and street ('Goljak 2')


class InstitutionLocator:
    """Finds where a CEZIH institution is: the city printed on the list, else the HZZO registry
    entry the name means, else a settlement named in the name, else the seat of a county named
    in the name ('DZ Karlovačke županije'). A town in brackets refines it within the county."""

    def __init__(self, session: Session, gazetteer: Gazetteer) -> None:
        self.gaz = gazetteer
        self.facilities = [
            _Facility(
                f.source_id,
                f.name,
                f.subtype if f.type == "specialist" else "hospital",
                f.place_id,
                frozenset(_tokens(f.name)),
                frozenset(_tokens(f"{f.settlement} {f.address}")),
            )
            for f in session.scalars(
                select(HealthFacility).where(
                    (HealthFacility.type == "hospital")
                    | HealthFacility.subtype.in_(["health_center", "polyclinic", "public_health"])
                )
            )
        ]
        # A rare name word shared with one registry name ('Ghetaldus', 'Nedić') identifies the
        # institution even when the rest is worded differently; place names never do.
        self.place_words = {w for p in gazetteer.places for w in normalize(p.name).split()}
        uses = Counter(t for name in {f.name for f in self.facilities} for t in _tokens(name))
        self.rare = {
            t
            for t, n in uses.items()
            if n <= RARE_USES and len(t) >= 5 and t not in self.place_words
        }
        counties = list(session.scalars(select(County)))
        # 'Karlovačka' -> 'karlovacke' (genitive in 'DZ Karlovačke županije') -> seat 'Karlovac'.
        self.seats = {
            normalize(c.name[:-1] + "e", drop_words=False): (c.name, c.seat)
            for c in counties
            if c.name.endswith("a")
        }
        self.seat_of = {c.name: c.seat for c in counties}
        self.ids: dict[str, int] = {}

    def exact_place(self, name: str, county: str | None = None) -> PlaceRecord | None:
        """The settlement (or municipality) of exactly this name, with coordinates."""
        res = self.gaz.resolve(name, county_hint=county)
        place = res.place
        if res.status != "ok" or place is None or place.lat is None:
            return None
        names = [*name_variants(place.name), *name_variants(place.municipality)]
        return place if normalize(name) in {normalize(n) for n in names} else None

    def _town_in(self, text: str, county: str | None = None) -> PlaceRecord | None:
        text = re.sub(r"\bK\.\s*(?=[A-ZČĆŠŽĐ])", "Kaštel ", text)  # 'DZ SDŽ K.STARI'
        words = [w for w in re.split(r"[\s,]+", text.replace("–", " ").replace("-", " ")) if w]
        for n in (3, 2, 1):
            for i in range(len(words) - n + 1):
                chunk = " ".join(words[i : i + n])
                if normalize(chunk) in _GENERIC or len(chunk) < 3:
                    continue
                place = self.exact_place(chunk.title(), county)
                if place is not None:
                    return place
        return None

    def _registry(self, base: str) -> list[_Facility]:
        """Registry rows of the one institution a CEZIH name means (its locations share the
        name); empty when no registry name fits or several different ones fit equally."""
        words = _tokens(expand(base))
        if not words:
            return []
        kind = _kind(base)
        pool = [f for f in self.facilities if kind is None or f.kind == kind]
        scored: list[tuple[float, _Facility]] = []
        wider: set[str] = set()  # names holding all the CEZIH words
        for f in pool:
            shared = words & f.tokens
            if not shared:
                continue
            exact = f.tokens == words
            inside = words <= f.tokens
            rare = len(shared & self.rare)
            naming = bool(shared - self.place_words)
            overlap = len(shared) / len(words | f.tokens)
            if inside and not exact:
                wider.add(f.name)
            if exact or inside or rare or (naming and (f.tokens <= words or overlap >= 0.5)):
                scored.append((3 * exact + inside + rare + overlap, f))
        if len(wider) > 1 and not any(f.tokens == words for _s, f in scored):
            # 'Poliklinika za fizikalnu medicinu i rehabilitaciju' fits several polyclinics.
            scored = [(s, f) for s, f in scored if f.name not in wider]
        if not scored and kind is not None:
            # 'SB Goljak': the name gives the street or the town, not the registry name.
            around = [f for f in pool if words <= f.tokens | f.around]
            return around if len({f.name for f in around}) == 1 else []
        if not scored:
            return []
        best = max(s for s, _f in scored)
        top = [f for s, f in scored if s == best]
        return top if len({f.name for f in top}) == 1 else []

    def _pick(self, top: list[_Facility], text: str) -> tuple[_Facility, PlaceRecord] | None:
        """One institution, several locations: the one named in the text, else the one in the
        county seat; None when that does not decide."""
        located = [(f, p) for f in top if f.place_id and (p := self.gaz.get(f.place_id))]
        if len(located) <= 1:
            return located[0] if located else None
        hint = f" {normalize(text)} "
        for f, p in located:
            if f" {normalize(p.name)} " in hint:
                return f, p
        for f, p in located:
            if normalize(p.name) == normalize(self.seat_of.get(p.county, "")):
                return f, p
        return None

    def _county_seat(self, base: str) -> PlaceRecord | None:
        """Seat of the county named in the name, if it lies in that county (Zagrebačka's
        seat, Zagreb, does not)."""
        norm = normalize(base, drop_words=False)
        for genitive, (county, seat) in self.seats.items():
            if genitive in norm and (place := self.exact_place(seat, county)) is not None:
                return place if place.county == county else None
        return None

    def locate(self, raw: str, city: str = "") -> Located:
        base, paren = split_name(raw)
        spoken = expand(base)
        top = self._registry(base)
        picked = self._pick(top, f"{raw} {city}")
        source_id = picked[0].source_id if picked else (top[0].source_id if top else "")
        if city and (place := self.exact_place(city)) is not None:
            return Located(place, "cezih", spoken, source_id)
        if picked is not None:
            found = Located(picked[1], "registry", spoken, source_id)
        elif (p := self._town_in(base)) is not None:
            found = Located(p, "name", spoken, source_id)
        elif (p := self._county_seat(base)) is not None:
            found = Located(p, "county", spoken, source_id)
        elif any_located := [f for f in top if f.place_id and self.gaz.get(f.place_id)]:
            first = any_located[0]
            found = Located(self.gaz.get(first.place_id), "registry", spoken, first.source_id)
        else:
            found = Located(None, "none", spoken, source_id)
        # A location in brackets ('DZ PGŽ - MALI LOŠINJ') refines it inside the same county;
        # a street there ('Kruge 44') must not move the institution elsewhere.
        county = found.place.county if found.place else None
        refined = self._town_in(paren, county) if paren else None
        if refined is not None and (found.place is None or refined.county == found.place.county):
            return Located(refined, "name", spoken, found.facility_source_id)
        return found

    def institution_id(self, session: Session, raw: str, city: str = "") -> int:
        """Id of the institution row (created or refreshed once per run)."""
        norm = normalize(raw, drop_words=False)
        private = bool(_PRIVATE.match(norm))
        key = (
            "pp-" + hashlib.sha1(norm.encode(), usedforsecurity=False).hexdigest()[:24]
            if private
            else norm[:80]
        )
        if key in self.ids:
            return self.ids[key]
        if private:  # the name holds the doctor's name ('Martina' is also a village)
            place = self.exact_place(city) if city else None
            loc = Located(place, "cezih", "")
        else:
            loc = self.locate(raw, city)
        row = session.scalars(select(WlInstitution).where(WlInstitution.name_key == key)).first()
        if row is None:
            row = WlInstitution(name_key=key)
            session.add(row)
        label = "Privatna specijalistička ordinacija"
        row.name = label if private else raw
        row.spoken_name = label if private else loc.spoken_name
        row.private_practice = private
        row.children_only = any(w in norm for w in _CHILDREN)
        _place_institution(row, loc)
        session.flush()
        self.ids[key] = row.id
        return row.id


def _place_institution(row: WlInstitution, loc: Located) -> None:
    place = loc.place
    row.settlement = place.name if place else ""
    row.county = place.county if place else ""
    row.place_id = place.id if place else None
    row.lat, row.lon = (place.lat, place.lon) if place else (None, None)
    row.geo_source = loc.geo_source if place else "none"
    row.facility_source_id = loc.facility_source_id


def relocate_institutions(session: Session, gazetteer: Gazetteer) -> int:
    """Locate the stored institutions again without fetching the lists (after a seed rebuilt
    the settlements, or the registry changed); returns how many have a place. The city printed
    on a list is looked up again; private practices keep no name to locate by."""
    locator = InstitutionLocator(session, gazetteer)
    located = 0
    for row in session.scalars(select(WlInstitution)):
        if row.geo_source == "cezih":
            place = (
                locator.exact_place(row.settlement, row.county or None) if row.settlement else None
            )
            source_id = "" if row.private_practice else locator.locate(row.name).facility_source_id
            loc = Located(place, "cezih", row.spoken_name, source_id)
        elif row.private_practice:
            loc = Located(None, "none", row.spoken_name)
        else:
            loc = locator.locate(row.name)
        _place_institution(row, loc)
        located += row.place_id is not None
    return located


# ------------------------------------------------------------------ storing


def upsert_procedures(session: Session, procedures: list[cezih.Lookup]) -> None:
    existing = {p.id: p for p in session.scalars(select(WlProcedure))}
    for item in procedures:
        row = existing.get(item.id) or WlProcedure(id=item.id)
        category = category_for_procedure(item.name)
        row.name = item.name
        row.name_norm = normalize(item.name, drop_words=False)
        row.category = category.key if category else None
        row.variant = procedure_variant(item.name)
        row.is_pediatric = is_pediatric_procedure(item.name)
        session.add(row)


def next_slot(entry: WlEntry, now: datetime) -> datetime | None:
    """First published appointment not yet past (an 08:00 slot is gone by noon), local time;
    None when the institution has not updated its list."""
    if entry.not_updated:
        return None
    for value in json.loads(entry.slots_json or "[]"):
        slot = datetime.fromisoformat(value)
        if slot >= now:
            return slot
    return None


def usable_days(entry: WlEntry, now: datetime) -> int | None:
    """Calendar days to the next free appointment if the entry can be trusted, else None."""
    slot = next_slot(entry, now)
    return (slot.date() - local_today(now)).days if slot else None


def store_list(
    session: Session, procedure_id: int, page: cezih.ListPage, locator: InstitutionLocator
) -> int:
    """Replace the entries of one procedure and write today's snapshot; returns entries kept."""
    fetched = now_utc()
    today = local_today(fetched)
    proc = session.get(WlProcedure, procedure_id)
    session.execute(delete(WlEntry).where(WlEntry.procedure_id == procedure_id))
    session.execute(
        delete(WlSnapshot).where(WlSnapshot.day == today, WlSnapshot.procedure_id == procedure_id)
    )
    seen: set[int] = set()
    days: list[int] = []
    for e in page.entries:
        inst_id = locator.institution_id(session, e.institution, e.city)
        if inst_id in seen:  # the same list printed twice
            continue
        seen.add(inst_id)
        first = e.slots[0] if e.slots else None
        # A private practice's e-mail and web address often carry the doctor's name; its name is
        # never stored either. The phone stays: it is how the list says to book.
        private = session.get_one(WlInstitution, inst_id).private_practice
        entry = WlEntry(
            procedure_id=procedure_id,
            institution_id=inst_id,
            slots_json=json.dumps([s.isoformat() for s in e.slots]),
            first_slot_at=first,
            wait_days=e.wait_days,
            list_updated_at=e.list_updated_at,
            not_updated=e.not_updated,
            email="" if private else e.email[:120],
            phone=e.phone[:120],
            web="" if private else e.web[:200],
            fetched_at=fetched,
        )
        session.add(entry)
        wait = usable_days(entry, fetched)
        session.add(
            WlSnapshot(
                day=today,
                procedure_id=procedure_id,
                institution_id=inst_id,
                wait_days=wait,
                first_slot_on=to_local(first).date() if first else None,
            )
        )
        if wait is not None:
            days.append(wait)
    if proc is not None:
        proc.code = page.code
        proc.institutions = len(seen)
        proc.median_days = round(median(days)) if days else None
        proc.fetched_at = fetched
    return len(seen)


def store_page(locator: InstitutionLocator, procedure_id: int, page: cezih.ListPage) -> int:
    """store_list in a transaction of its own. When it fails, the institutions first stored in
    it are rolled back too, so the locator forgets the ids it handed out: a stale one would
    break every later list that names the institution."""
    try:
        with session_scope() as session:
            return store_list(session, procedure_id, page, locator)
    except Exception:
        locator.ids.clear()
        raise


def _save_raw(procedure_id: int, data: bytes) -> None:
    raw = get_settings().raw_dir / "cezih"
    raw.mkdir(parents=True, exist_ok=True)
    (raw / f"{procedure_id}.html.gz").write_bytes(gzip.compress(data))


def _stored_procedures(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(WlProcedure)) or 0


def check_procedures(session: Session, count: int) -> None:
    """Refuse a procedure list far shorter than the stored one (a cut-off or changed response):
    the run would refresh almost nothing and drop the rest. As status.check_plausible."""
    stored = _stored_procedures(session)
    if count == 0 or count < MIN_SHARE_OF_LAST * stored:
        raise ValueError(f"{count} procedures listed, {stored} stored; keeping the old data")


def _drop_withdrawn(session: Session, ids: list[int]) -> int:
    """Procedures CEZIH no longer lists, with their entries (their snapshots stay for the trend).
    Refused (ValueError) when more than MAX_WITHDRAWN_SHARE of the stored ones would go."""
    gone = list(session.scalars(select(WlProcedure.id).where(WlProcedure.id.not_in(ids))))
    stored = _stored_procedures(session)
    if len(gone) > MAX_WITHDRAWN_SHARE * stored:
        raise ValueError(
            f"{len(gone)} of {stored} procedures no longer listed; keeping them and their lists"
        )
    if gone:
        session.execute(delete(WlEntry).where(WlEntry.procedure_id.in_(gone)))
        session.execute(delete(WlProcedure).where(WlProcedure.id.in_(gone)))
    return len(gone)


def fetch_waiting_lists(
    gazetteer: Gazetteer | None = None,
    limit: int | None = None,
    delay_s: float = REQUEST_DELAY_S,
) -> None:
    """One pass over every procedure. A page that fails is skipped and keeps its old lists; the
    run is marked failed when more than MAX_FAILED_SHARE fail or the portal stops answering."""
    with http_client() as client:
        try:
            procedures = cezih.parse_lookup(fetch_bytes(cezih.PROCEDURES_URL, client=client))
            with session_scope() as session:
                check_procedures(session, len(procedures))
        except (FetchError, ValueError) as exc:
            log.warning("CEZIH procedures not available: %s", exc)
            with session_scope() as session:
                mark_error(session, SOURCE_KEY, f"{type(exc).__name__}: {exc}")
            return
        procedures = sorted(procedures, key=lambda p: p.id)[:limit]
        with session_scope() as session:
            upsert_procedures(session, procedures)
            locator = InstitutionLocator(session, gazetteer or load_gazetteer(session))
        entries = failed = in_a_row = 0
        stopped = False
        for i, proc in enumerate(procedures):
            if i:
                time.sleep(delay_s)
            try:
                data = fetch_bytes(cezih.list_url(proc.id), client=client)
                page = cezih.parse_list_page(data)
                _save_raw(proc.id, data)
                entries += store_page(locator, proc.id, page)
                in_a_row = 0
            # One page must not end the run; its old lists stay.
            except Exception as exc:  # noqa: BLE001
                failed += 1
                in_a_row += 1
                log.warning("CEZIH list %s failed: %s: %s", proc.id, type(exc).__name__, exc)
            if in_a_row >= MAX_FAILED_IN_A_ROW:
                log.error("CEZIH: %s lists failed in a row, stopping the run", in_a_row)
                stopped = True
                break
    with session_scope() as session:
        cutoff = local_today() - timedelta(days=SNAPSHOT_DAYS)
        session.execute(delete(WlSnapshot).where(WlSnapshot.day < cutoff))
        if not stopped and procedures and failed <= MAX_FAILED_SHARE * len(procedures):
            try:
                if limit is None:
                    dropped = _drop_withdrawn(session, [p.id for p in procedures])
                    if dropped:
                        log.info("%s: %s procedures no longer listed", SOURCE_KEY, dropped)
            except ValueError as exc:
                log.warning("%s: %s", SOURCE_KEY, exc)
                mark_error(session, SOURCE_KEY, f"{type(exc).__name__}: {exc}")
            else:
                mark_success(session, SOURCE_KEY, entries)
        else:
            mark_error(session, SOURCE_KEY, f"{failed} of {len(procedures)} lists failed")
    log.info("%s: %s entries, %s lists, %s failed", SOURCE_KEY, entries, len(procedures), failed)

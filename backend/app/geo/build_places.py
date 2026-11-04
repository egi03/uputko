"""Join DZS settlements with GeoNames coordinates; counties come from point-in-polygon."""

from collections import defaultdict
from dataclasses import dataclass, field
from statistics import median

from app.geo.counties import CountyIndex
from app.geo.distance import haversine_km
from app.geo.normalize import name_variants, normalize
from app.ingest.dzs import SettlementRow
from app.ingest.geonames import GeoNamesPlace


@dataclass
class BuiltPlace:
    name: str
    municipality: str
    municipality_type: str
    county: str
    population: int
    is_municipality_seat: bool
    lat: float | None = None
    lon: float | None = None
    coord_source: str = "none"


@dataclass
class BuildReport:
    total: int = 0
    matched_unique: int = 0
    matched_homonym: int = 0
    fallback_jls_seat: int = 0
    no_coordinates: int = 0
    unknown_county: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)  # "Naselje (JLS, županija)"


MAX_HOMONYM_KM = 30.0
# GeoNames feature codes ranked for choosing a JLS seat among homonyms.
_FEATURE_RANK = {"PPLC": 5, "PPLA": 4, "PPLA2": 3, "PPLA3": 2, "PPL": 1}


def _jls_key(s: SettlementRow | BuiltPlace) -> tuple[str, str]:
    return (s.county, s.municipality)


def _pick_seats(settlements: list[SettlementRow]) -> set[int]:
    """Index of the seat per JLS: settlement named like the JLS, else the most populous one."""
    by_jls: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, s in enumerate(settlements):
        by_jls[_jls_key(s)].append(i)
    seats: set[int] = set()
    for (_county, jls), idxs in by_jls.items():
        jls_norms = {normalize(v) for v in name_variants(jls)}
        named = [
            i
            for i in idxs
            if {normalize(v) for v in name_variants(settlements[i].name)} & jls_norms
        ]
        pool = named or idxs
        seats.add(max(pool, key=lambda i: settlements[i].population))
    return seats


def _set_coords(place: BuiltPlace, g: GeoNamesPlace) -> None:
    place.lat, place.lon, place.coord_source = g.lat, g.lon, "geonames"


def build_places(
    settlements: list[SettlementRow],
    geonames: list[GeoNamesPlace],
    county_index: CountyIndex,
    known_counties: set[str],
) -> tuple[list[BuiltPlace], BuildReport]:
    report = BuildReport(total=len(settlements))

    # GeoNames points keyed by (normalized name, county).
    gn_index: dict[tuple[str, str], dict[int, GeoNamesPlace]] = defaultdict(dict)
    for g in geonames:
        county = county_index.locate(g.lat, g.lon)
        if county is None:
            continue
        for n in {normalize(x) for x in g.names}:
            gn_index[(n, county)][g.geoname_id] = g

    # DZS homonyms in one county must not share a single GeoNames point.
    dzs_count: dict[tuple[str, str], int] = defaultdict(int)
    for s in settlements:
        dzs_count[(normalize(s.name), s.county)] += 1

    # A point that several settlements reach (by an alternate name) is not a unique match.
    found_by: list[dict[int, GeoNamesPlace]] = []
    claims: dict[int, int] = defaultdict(int)
    for s in settlements:
        found: dict[int, GeoNamesPlace] = {}
        for variant in name_variants(s.name):
            found.update(gn_index.get((normalize(variant), s.county), {}))
        found_by.append(found)
        for geoname_id in found:
            claims[geoname_id] += 1

    seats = _pick_seats(settlements)
    places: list[BuiltPlace] = []
    pending: dict[int, list[GeoNamesPlace]] = {}
    used: set[int] = set()  # points already given to a settlement
    for i, s in enumerate(settlements):
        if s.county not in known_counties and s.county not in report.unknown_county:
            report.unknown_county.append(s.county)
        place = BuiltPlace(
            name=s.name,
            municipality=s.municipality,
            municipality_type=s.municipality_type,
            county=s.county,
            population=s.population,
            is_municipality_seat=i in seats,
        )
        places.append(place)
        found = found_by[i]
        unique = len(found) == 1 and claims[next(iter(found))] == 1
        if unique and dzs_count[(normalize(s.name), s.county)] == 1:
            point = next(iter(found.values()))
            _set_coords(place, point)
            used.add(point.geoname_id)
            report.matched_unique += 1
        elif found:
            pending[i] = list(found.values())

    # Reference point per JLS: median of its uniquely matched settlements (robust to islands).
    unique_points: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
    for p in places:
        if p.lat is not None and p.lon is not None:
            unique_points[_jls_key(p)].append((p.lat, p.lon))
    jls_ref = {
        key: (median(a for a, _ in pts), median(b for _, b in pts))
        for key, pts in unique_points.items()
    }

    # Homonyms inside one county: take the unused point closest to the JLS reference
    # (within MAX_HOMONYM_KM); without a reference, prefer administrative features.
    for i in sorted(pending, key=lambda i: i not in seats):
        candidates = [g for g in pending[i] if g.geoname_id not in used]
        ref = jls_ref.get(_jls_key(places[i]))
        if not candidates:
            continue
        if ref is not None:
            ref_lat, ref_lon = ref
            best = min(candidates, key=lambda g: haversine_km(ref_lat, ref_lon, g.lat, g.lon))
            if haversine_km(ref_lat, ref_lon, best.lat, best.lon) > MAX_HOMONYM_KM:
                continue
        elif i in seats:
            best = max(
                candidates, key=lambda g: (_FEATURE_RANK.get(g.feature_code, 0), g.population)
            )
        else:
            continue
        _set_coords(places[i], best)
        used.add(best.geoname_id)
        jls_ref.setdefault(_jls_key(places[i]), (best.lat, best.lon))
        report.matched_homonym += 1

    seat_coords = {
        _jls_key(places[i]): (lat, lon)
        for i in seats
        if (lat := places[i].lat) is not None and (lon := places[i].lon) is not None
    }

    for p in places:
        if p.coord_source != "none":
            continue
        report.unmatched.append(f"{p.name} ({p.municipality}, {p.county})")
        seat = seat_coords.get(_jls_key(p))
        if seat is not None:
            p.lat, p.lon, p.coord_source = seat[0], seat[1], "jls_seat"
            report.fallback_jls_seat += 1
        else:
            report.no_coordinates += 1
    return places, report

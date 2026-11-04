"""Place resolution. Works on an in-memory snapshot of the places table."""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

from rapidfuzz import fuzz, process

from app.geo.distance import haversine_km
from app.geo.normalize import name_variants, normalize, stems

FUZZY_THRESHOLD = 88
MAX_CANDIDATES = 3
# A candidate wins over homonyms if it is this many times larger than the next one.
DOMINANCE_RATIO = 10


@dataclass(frozen=True)
class PlaceRecord:
    id: int
    name: str
    municipality: str
    municipality_type: str
    county: str
    lat: float | None
    lon: float | None
    population: int
    is_municipality_seat: bool
    coord_source: str = "none"

    @property
    def municipality_label(self) -> str:
        prefix = "Grad" if self.municipality_type == "Grad" else "Općina"
        return f"{prefix} {self.municipality}"


ResolveStatus = Literal["ok", "ambiguous", "not_found"]


@dataclass
class ResolveResult:
    status: ResolveStatus
    place: PlaceRecord | None = None
    candidates: list[PlaceRecord] = field(default_factory=list)


def _rank_key(p: PlaceRecord) -> tuple[int, int]:
    return (int(p.is_municipality_seat), p.population)


def _jls_keys(municipality: str) -> set[str]:
    """'Višnjan – Visignano' answers to the whole name and to each part."""
    return {normalize(v) for v in name_variants(municipality)}


class Gazetteer:
    def __init__(self, places: list[PlaceRecord]) -> None:
        self.places = places
        self._by_id = {p.id: p for p in places}
        self._by_norm: dict[str, list[PlaceRecord]] = defaultdict(list)
        self._by_stem: dict[str, list[PlaceRecord]] = defaultdict(list)
        for p in places:
            norms = {normalize(v) for v in name_variants(p.name)}
            if p.is_municipality_seat:
                # Towns without a settlement of the same name (Kaštela) resolve to their seat.
                norms |= {normalize(v) for v in name_variants(p.municipality)}
            for norm in norms:
                self._by_norm[norm].append(p)
            for s in set().union(*(stems(n) for n in norms)):
                self._by_stem[s].append(p)
        self._norm_keys = list(self._by_norm.keys())
        self._with_coords = [p for p in places if p.lat is not None and p.lon is not None]

    def __len__(self) -> int:
        return len(self.places)

    def get(self, place_id: int | None) -> PlaceRecord | None:
        return self._by_id.get(place_id) if place_id is not None else None

    @property
    def counties(self) -> list[str]:
        return sorted({p.county for p in self.places})

    def resolve(self, query: str, county_hint: str | None = None) -> ResolveResult:
        query = query or ""
        hints = [county_hint] if county_hint else []
        if "," in query and not county_hint:
            # The place, then its county or its city/municipality: "Novigrad, Istarska",
            # "Luka, Vrbovec", "Milna, Grad Hvar, Splitsko-dalmatinska".
            query, *qualifiers = (part.strip() for part in query.split(","))
            hints += qualifiers
        q = normalize(query)
        if not q:
            return ResolveResult("not_found")

        candidates = list(self._by_norm.get(q, []))
        if candidates and not any(p.is_municipality_seat for p in candidates):
            # A spoken "Sveti Ivan" usually means a town: add municipality seats that extend it,
            # but not the seat of the same JLS ("Kaštelir" is not Labinci, the seat of
            # Kaštelir-Labinci).
            jls = {(p.county, p.municipality) for p in candidates}
            candidates += [
                p
                for p in self._prefix_matches(q)
                if p.is_municipality_seat and (p.county, p.municipality) not in jls
            ]
        if not candidates:
            candidates = self._stem_matches(q)
        if not candidates:
            candidates = self._prefix_matches(q)
        if not candidates:
            candidates = self._fuzzy_matches(q)
        if not candidates:
            return ResolveResult("not_found")
        return self._disambiguate(candidates, hints)

    def _stem_matches(self, q: str) -> list[PlaceRecord]:
        found: dict[int, PlaceRecord] = {}
        for s in stems(q):
            for p in self._by_stem.get(s, []):
                found[p.id] = p
        return list(found.values())

    def _prefix_matches(self, q: str) -> list[PlaceRecord]:
        """'Sveti Ivan' -> 'Sveti Ivan Zelina', 'Sveti Ivan Žabno' (whole-word prefix only)."""
        if len(q) < 4:
            return []
        prefix = q + " "
        return [p for key in self._norm_keys if key.startswith(prefix) for p in self._by_norm[key]]

    def _fuzzy_matches(self, q: str) -> list[PlaceRecord]:
        hits = process.extract(
            q, self._norm_keys, scorer=fuzz.ratio, score_cutoff=FUZZY_THRESHOLD, limit=10
        )
        return [p for key, _score, _idx in hits for p in self._by_norm[key]]

    @staticmethod
    def _narrow(candidates: list[PlaceRecord], hint: str) -> list[PlaceRecord]:
        """The candidates in the county or the city/municipality a hint names: the county
        named exactly ("Grad Zagreb" is not "Zagrebačka"), a JLS ("Vrbovec", "Općina Luka"),
        else a part of a county's name. Empty when the hint names none of them."""
        h = normalize(hint).replace("zupanija", "").strip()
        if not h:
            return []
        exact = [c for c in candidates if h == normalize(c.county)]
        jls = [c for c in candidates if h in _jls_keys(c.municipality)]
        return exact or jls or [c for c in candidates if h in normalize(c.county)]

    def _disambiguate(self, candidates: list[PlaceRecord], hints: list[str]) -> ResolveResult:
        for hint in hints:
            candidates = self._narrow(candidates, hint) or candidates
        ranked = sorted(candidates, key=_rank_key, reverse=True)
        if len({(p.county, p.municipality) for p in ranked}) == 1:
            # One place, or all in one JLS ("Podstrana – Sita", "Podstrana – Grljevac"): the seat
            # or the largest.
            return ResolveResult("ok", place=ranked[0])
        top, second = ranked[0], ranked[1]
        if top.population >= DOMINANCE_RATIO * max(second.population, 1):
            return ResolveResult("ok", place=top)
        return ResolveResult("ambiguous", candidates=ranked[:MAX_CANDIDATES])

    def nearest(self, lat: float, lon: float) -> tuple[PlaceRecord, float] | None:
        """Nearest settlement with own coordinates (not JLS-seat fallbacks)."""
        pool = [p for p in self._with_coords if p.coord_source == "geonames"] or self._with_coords
        best: tuple[PlaceRecord, float] | None = None
        for p in pool:
            if p.lat is None or p.lon is None:  # _with_coords holds only places with both
                continue
            d = haversine_km(lat, lon, p.lat, p.lon)
            if best is None or d < best[1]:
                best = (p, d)
        return best

    def search(self, query: str, limit: int = 8) -> list[PlaceRecord]:
        """Autocomplete: names starting with the query (or a word in them), best first."""
        q = normalize(query or "")
        if len(q) < 2:
            return []
        hits: dict[int, tuple[int, PlaceRecord]] = {}
        for key in self._norm_keys:
            if key == q:
                rank = 0
            elif key.startswith(q):
                rank = 1
            elif f" {q}" in f" {key}":
                rank = 2
            else:
                continue
            for p in self._by_norm[key]:
                if p.id not in hits or rank < hits[p.id][0]:
                    hits[p.id] = (rank, p)
        ordered = sorted(
            hits.values(), key=lambda t: (t[0], not t[1].is_municipality_seat, -t[1].population)
        )
        return [p for _rank, p in ordered[:limit]]

from math import asin, cos, degrees, radians, sin, sqrt
from typing import NamedTuple, Protocol

EARTH_RADIUS_KM = 6371.0088


class HasCoords(Protocol):
    """A settlement, facility or institution: coordinates may be unknown."""

    @property
    def lat(self) -> float | None: ...
    @property
    def lon(self) -> float | None: ...


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def km_between(a: HasCoords | None, b: HasCoords | None) -> float | None:
    """Straight-line distance in km; None when either side has no coordinates."""
    if a is None or b is None or a.lat is None or a.lon is None or b.lat is None or b.lon is None:
        return None
    return haversine_km(a.lat, a.lon, b.lat, b.lon)


class Box(NamedTuple):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


def box_around(lat: float, lon: float, radius_km: float) -> Box:
    """Degrees that hold every point within radius_km of (lat, lon) by haversine_km: the exact
    bounds of a circle on the sphere, widened by 1 % against rounding. Croatia is far from the
    poles and the antimeridian, which this does not handle."""
    r = radius_km * 1.01 / EARTH_RADIUS_KM
    dlat = degrees(r)
    dlon = degrees(asin(min(1.0, sin(r) / cos(radians(lat)))))
    return Box(lat - dlat, lat + dlat, lon - dlon, lon + dlon)

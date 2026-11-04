"""County polygons for the gazetteer and the map.

The only open vector boundaries of Croatian counties we found are in DHMZ's
CroatiaRegionsCounties shapefile (HTRS96/TM, EPSG:3765; Otvorena dozvola, DHMZ credited as the
source). ZU_RB is the official county number 01-21 (DZS order); 21 is Grad Zagreb.
"""

import io
import tarfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapefile
import shapely
from pyproj import Transformer
from shapely import wkt
from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.prepared import PreparedGeometry, prep

COUNTIES_URL = "https://meteo.hr/upozorenja/CroatiaRegionsCounties.tar.xz"
SIMPLIFY_TOLERANCE_DEG = 0.001  # about 100 m; enough for settlement-level lookup


@dataclass(frozen=True)
class CountyShape:
    code: str  # "01".."21"
    name: str  # as used by DZS, e.g. "Vukovarsko-srijemska", "Grad Zagreb"
    seat: str  # ZU_SJ, e.g. "Vukovar"
    geometry: BaseGeometry  # WGS84 (lon, lat)


def short_county_name(full_name: str) -> str:
    """'Vukovarsko-srijemska županija' -> 'Vukovarsko-srijemska'; 'Grad Zagreb' unchanged."""
    return full_name.removesuffix(" županija").strip()


def _read_shapefile(shp: io.BytesIO, dbf: io.BytesIO, shx: io.BytesIO) -> list[CountyShape]:
    transformer = Transformer.from_crs("EPSG:3765", "EPSG:4326", always_xy=True)

    def to_wgs84(coords: np.ndarray) -> np.ndarray:
        return np.column_stack(transformer.transform(coords[:, 0], coords[:, 1]))

    reader = shapefile.Reader(shp=shp, dbf=dbf, shx=shx, encoding="utf-8")
    counties = []
    for sr in reader.iterShapeRecords():
        rec = sr.record.as_dict()
        geom = shapely.transform(shape(sr.shape.__geo_interface__), to_wgs84)
        geom = geom.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
        counties.append(
            CountyShape(
                code=f"{int(rec['ZU_RB']):02d}",
                name=short_county_name(rec["ZU_IME"]),
                seat=" ".join(str(rec.get("ZU_SJ") or "").split()),
                geometry=geom,
            )
        )
    return sorted(counties, key=lambda c: c.code)


def parse_counties_archive(path: Path) -> list[CountyShape]:
    """Read the shapefile straight from the .tar.xz (or a plain .tar)."""
    parts: dict[str, io.BytesIO] = {}
    with tarfile.open(path) as tar:
        for member in tar.getmembers():
            suffix = Path(member.name).suffix.lower()
            if suffix in {".shp", ".dbf", ".shx"} and member.isfile():
                fh = tar.extractfile(member)
                if fh is not None:
                    parts[suffix] = io.BytesIO(fh.read())
    missing = {".shp", ".dbf", ".shx"} - parts.keys()
    if missing:
        raise ValueError(f"shapefile parts missing in {path.name}: {sorted(missing)}")
    return _read_shapefile(parts[".shp"], parts[".dbf"], parts[".shx"])


class CountyIndex:
    """Point-in-polygon lookup of the county for a coordinate."""

    def __init__(self, counties: list[tuple[str, str]]) -> None:
        """counties: (county name, geometry_wkt) pairs in WGS84."""
        self._items: list[tuple[str, BaseGeometry, PreparedGeometry[BaseGeometry]]] = []
        for name, geom_wkt in counties:
            geom = wkt.loads(geom_wkt)
            self._items.append((name, geom, prep(geom)))

    def locate(self, lat: float, lon: float, max_km: float = 3.0) -> str | None:
        pt = Point(lon, lat)
        for name, _geom, prepared in self._items:
            if prepared.contains(pt):
                return name
        # Coastal points and islands can fall just outside simplified polygons.
        best: tuple[float, str] | None = None
        for name, geom, _prepared in self._items:
            d = geom.distance(pt)
            if best is None or d < best[0]:
                best = (d, name)
        if best and best[0] * 111.0 <= max_km:
            return best[1]
        return None

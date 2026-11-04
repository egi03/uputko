"""Place autocomplete and county shapes for the premium UI."""

import json
import math
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from shapely import wkt
from shapely.geometry import MultiPolygon, mapping
from shapely.geometry.base import BaseGeometry
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import app_cached, get_db, get_gazetteer
from app.geo.gazetteer import Gazetteer
from app.models import County

router = APIRouter()

MAP_TOLERANCE_DEG = 0.004  # ~400 m; enough for a page-sized map
MIN_ISLAND_AREA = 0.00004  # deg²; drops islets smaller than ~0.3 km²


@router.get("/places")
def places(
    q: Annotated[str, Query(min_length=1, max_length=80)],
    gaz: Annotated[Gazetteer, Depends(get_gazetteer)],
    limit: Annotated[int, Query(ge=1, le=10)] = 8,
) -> list[dict[str, Any]]:
    return [
        {
            "name": p.name,
            "municipality": p.municipality_label,
            "county": p.county,
            "population": p.population,
        }
        for p in gaz.search(q, limit)
    ]


def _rounded(geom: BaseGeometry) -> dict[str, Any]:
    coords = mapping(geom)
    rounded: dict[str, Any] = json.loads(
        json.dumps(coords), parse_float=lambda x: round(float(x), 3)
    )
    return rounded


def _shape(geometry_wkt: str) -> BaseGeometry:
    geom = wkt.loads(geometry_wkt).simplify(MAP_TOLERANCE_DEG, preserve_topology=True)
    if not isinstance(geom, MultiPolygon):
        return geom
    parts = list(geom.geoms)
    kept = [g for g in parts if g.area >= MIN_ISLAND_AREA] or parts
    return MultiPolygon(kept) if len(kept) > 1 else kept[0]


@router.get("/counties")
def counties(request: Request, db: Annotated[Session, Depends(get_db)]) -> Response:
    """County boundaries as GeoJSON (WGS84), for the maps. Source: DHMZ shapefile."""
    count = db.scalar(select(func.count()).select_from(County)) or 0

    def geojson() -> str:
        rows = db.scalars(select(County).order_by(County.code)).all()
        features = [
            {
                "type": "Feature",
                "properties": {"code": r.code, "name": r.name},
                "geometry": _rounded(_shape(r.geometry_wkt)),
            }
            for r in rows
        ]
        return json.dumps(
            {"type": "FeatureCollection", "features": features}, separators=(",", ":")
        )

    # Built once per set of counties (a seed changes the count); the geometry is read only then.
    return Response(
        app_cached(request, f"counties:{count}", math.inf, geojson),
        media_type="application/geo+json",
        headers={"Cache-Control": "public, max-age=86400"},
    )

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.deps import get_gazetteer
from app.geo.gazetteer import Gazetteer

router = APIRouter()

# Croatia bounding box with a small margin; coordinates are never stored or logged.
_LAT_RANGE = (42.0, 46.8)
_LON_RANGE = (13.0, 19.8)


class LocateResponse(BaseModel):
    name: str
    municipality: str
    county: str
    distance_km: float


@router.get("/locate")
def locate(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    gazetteer: Annotated[Gazetteer, Depends(get_gazetteer)],
) -> LocateResponse:
    if not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1] and _LON_RANGE[0] <= lon <= _LON_RANGE[1]):
        raise HTTPException(status_code=404, detail="Lokacija je izvan Hrvatske.")
    hit = gazetteer.nearest(lat, lon)
    if hit is None:
        raise HTTPException(status_code=503, detail="Popis naselja nije učitan.")
    place, dist = hit
    return LocateResponse(
        name=place.name,
        municipality=place.municipality_label,
        county=place.county,
        distance_km=round(dist, 1),
    )

"""Loading the gazetteer from the database."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geo.gazetteer import Gazetteer, PlaceRecord
from app.models import Place


def place_record(p: Place) -> PlaceRecord:
    return PlaceRecord(
        id=p.id,
        name=p.name,
        municipality=p.municipality,
        municipality_type=p.municipality_type,
        county=p.county,
        lat=p.lat,
        lon=p.lon,
        population=p.population,
        is_municipality_seat=p.is_municipality_seat,
        coord_source=p.coord_source,
    )


def load_gazetteer(session: Session) -> Gazetteer:
    places = session.scalars(select(Place)).all()
    return Gazetteer([place_record(p) for p in places])

"""DZS municipalities (table 6) -> demographics table."""

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ingest import dzs
from app.ingest.http import fetch_to_file
from app.ingest.status import mark_success
from app.models import Demographics


def load_demographics(session: Session, *, refresh: bool = False) -> int:
    path = fetch_to_file(
        dzs.DZS_MUNICIPALITIES_URL,
        get_settings().raw_dir / "popis_2021-stanovnistvo_po_gradovima_opcinama.xlsx",
        refresh=refresh,
        timeout=60,
    )
    rows = list(dzs.parse_municipalities(path))
    session.execute(delete(Demographics))
    session.add_all(
        Demographics(
            municipality=r.municipality,
            municipality_type=r.municipality_type,
            county=r.county,
            population_total=r.population_total,
            population_65_plus=r.population_65_plus,
            source=dzs.SOURCE_LABEL,
            census_year=2021,
        )
        for r in rows
    )
    session.flush()
    mark_success(session, "dzs_municipalities", len(rows))
    return len(rows)

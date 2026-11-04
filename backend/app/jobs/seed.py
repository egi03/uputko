"""One-off seeding: counties, places (gazetteer), demographics, then a first fetch of all sources.

Run: uv run python -m app.jobs.seed [--refresh]
"""

import argparse
import json
import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import init_db, session_scope
from app.geo.build_places import BuildReport, build_places
from app.geo.counties import COUNTIES_URL, CountyIndex, parse_counties_archive
from app.geo.normalize import normalize
from app.geo.store import load_gazetteer
from app.ingest import dzs, geonames
from app.ingest.cezih_jobs import relocate_institutions
from app.ingest.demographics import load_demographics
from app.ingest.http import fetch_to_file
from app.ingest.hzzo_jobs import relink_facilities
from app.ingest.status import mark_success
from app.models import County, Place

log = logging.getLogger(__name__)


def seed_counties(session: Session, *, refresh: bool = False) -> CountyIndex:
    raw = get_settings().raw_dir
    archive = fetch_to_file(COUNTIES_URL, raw / "CroatiaRegionsCounties.tar.xz", refresh=refresh)
    shapes = parse_counties_archive(archive)
    session.execute(delete(County))
    session.add_all(
        County(code=s.code, name=s.name, seat=s.seat, geometry_wkt=s.geometry.wkt) for s in shapes
    )
    session.flush()
    mark_success(session, "county_boundaries", len(shapes))
    return CountyIndex([(s.name, s.geometry.wkt) for s in shapes])


def seed_places(
    session: Session, county_index: CountyIndex, *, refresh: bool = False
) -> BuildReport:
    raw = get_settings().raw_dir
    dzs_path = fetch_to_file(
        dzs.DZS_SETTLEMENTS_URL, raw / "popis_2021-stanovnistvo_po_naseljima.xlsx", refresh=refresh
    )
    gn_path = fetch_to_file(geonames.GEONAMES_HR_URL, raw / "geonames_HR.zip", refresh=refresh)
    settlements = list(dzs.parse_settlements(dzs_path))
    points = list(geonames.parse_zip(gn_path))
    counties = set(session.scalars(select(County.name)))
    built, report = build_places(settlements, points, county_index, counties)

    session.execute(delete(Place))
    session.add_all(
        Place(
            name=b.name,
            name_norm=normalize(b.name),
            municipality=b.municipality,
            municipality_type=b.municipality_type,
            county=b.county,
            lat=b.lat,
            lon=b.lon,
            coord_source=b.coord_source,
            population=b.population,
            is_municipality_seat=b.is_municipality_seat,
        )
        for b in built
    )
    session.flush()
    mark_success(session, "dzs_settlements", len(settlements))
    mark_success(session, "geonames_hr", len(points))
    _write_report(report)
    return report


def _write_report(report: BuildReport) -> None:
    path = get_settings().data_dir / "gazetteer_report.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.__dict__, ensure_ascii=False, indent=2), encoding="utf-8")


def run(*, refresh: bool = False, fetch_sources: bool = True) -> None:
    init_db()
    with session_scope() as session:
        county_index = seed_counties(session, refresh=refresh)
        report = seed_places(session, county_index, refresh=refresh)
        # Facilities and institutions from an earlier fetch point to the old settlement rows.
        gazetteer = load_gazetteer(session)
        relinked = relink_facilities(session, gazetteer)
        relocated = relocate_institutions(session, gazetteer)
        log.info(
            "places: %s total, %s unique, %s homonym, %s fallback, %s none",
            report.total,
            report.matched_unique,
            report.matched_homonym,
            report.fallback_jls_seat,
            report.no_coordinates,
        )
        n = load_demographics(session, refresh=refresh)
        log.info(
            "demographics: %s municipalities; relinked %s facilities, %s waiting-list institutions",
            n,
            relinked,
            relocated,
        )
    if fetch_sources:
        from app.jobs.scheduler import run_all_jobs_once

        run_all_jobs_once()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed gazetteer, demographics and data sources")
    parser.add_argument("--refresh", action="store_true", help="re-download static files")
    parser.add_argument("--no-fetch", action="store_true", help="skip the first fetch of sources")
    args = parser.parse_args()
    logging.basicConfig(
        level=get_settings().log_level, format="%(levelname)s %(name)s: %(message)s"
    )
    run(refresh=args.refresh, fetch_sources=not args.no_fetch)


if __name__ == "__main__":
    main()

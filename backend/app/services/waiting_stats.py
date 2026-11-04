"""Waiting-list overviews for the UI and the dashboard (part B): per county, longest waits,
data quality and the daily trend from snapshots. Real data only."""

from collections import defaultdict
from statistics import median
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.categories import is_pediatric_procedure
from app.ingest.cezih import SOURCE
from app.ingest.cezih_jobs import SOURCE_KEY, next_slot
from app.models import County, WlEntry, WlInstitution, WlProcedure, WlSnapshot
from app.services.common import last_success
from app.timeutil import iso_local, local_today, now_utc

TOP_PROCEDURES = 15
MIN_INSTITUTIONS = 5  # medians over fewer lists say little


def _median(values: list[int]) -> int | None:
    return round(median(values)) if values else None


def by_county(session: Session, procedure_id: int) -> dict[str, Any]:
    """Median and shortest wait per county for one procedure (located institutions only)."""
    proc = session.get(WlProcedure, procedure_id)
    # As the tool decides it: also from the name, until the next download refreshes the flag.
    for_child = proc is not None and (proc.is_pediatric or is_pediatric_procedure(proc.name))
    now = now_utc()
    today = local_today(now)
    days: dict[str, list[int]] = defaultdict(list)
    lists: dict[str, int] = defaultdict(int)
    rows = session.execute(
        select(WlEntry, WlInstitution)
        .join(WlInstitution, WlEntry.institution_id == WlInstitution.id)
        .where(WlEntry.procedure_id == procedure_id)
    ).all()
    for entry, inst in rows:
        if inst.children_only and not for_child:
            continue
        county = inst.county or ""
        lists[county] += 1
        slot = next_slot(entry, now)
        if slot is not None:
            days[county].append((slot.date() - today).days)
    counties = [c.name for c in session.scalars(select(County).order_by(County.code))]
    return {
        "procedure": {"id": procedure_id, "name": proc.name if proc else None},
        "counties": [
            {
                "county": c,
                "institutions": lists.get(c, 0),
                "with_free_slot": len(days.get(c, [])),
                "median_days": _median(days.get(c, [])),
                "min_days": min(days[c]) if days.get(c) else None,
            }
            for c in counties
        ],
        "national": {
            "institutions": sum(lists.values()),
            "median_days": _median([d for v in days.values() for d in v]),
        },
        "source": SOURCE,
        "updated_at": iso_local(last_success(session, [SOURCE_KEY])),
    }


def overview(session: Session) -> dict[str, Any]:
    """Longest median waits and the quality of the lists, for dashboard part B."""
    procs = session.scalars(
        select(WlProcedure).where(WlProcedure.institutions >= MIN_INSTITUTIONS)
    ).all()
    longest = sorted(
        (p for p in procs if p.median_days is not None), key=lambda p: -(p.median_days or 0)
    )[:TOP_PROCEDURES]
    total = session.scalar(select(func.count()).select_from(WlEntry)) or 0
    not_updated = (
        session.scalar(select(func.count()).select_from(WlEntry).where(WlEntry.not_updated)) or 0
    )
    without_slot = (
        session.scalar(
            select(func.count()).select_from(WlEntry).where(WlEntry.first_slot_at.is_(None))
        )
        or 0
    )
    institutions = session.scalar(select(func.count()).select_from(WlInstitution)) or 0
    located = (
        session.scalar(
            select(func.count())
            .select_from(WlInstitution)
            .where(WlInstitution.place_id.is_not(None))
        )
        or 0
    )
    with_lists = (
        session.scalar(
            select(func.count()).select_from(WlProcedure).where(WlProcedure.institutions > 0)
        )
        or 0
    )
    return {
        "longest": [
            {
                "id": p.id,
                "name": p.name,
                "category": p.category,
                "median_days": p.median_days,
                "institutions": p.institutions,
            }
            for p in longest
        ],
        "quality": {
            "procedures_with_lists": with_lists,
            "entries": total,
            "not_updated": not_updated,
            "without_slot": without_slot,
            "institutions": institutions,
            "institutions_located": located,
        },
        "source": SOURCE,
        "updated_at": iso_local(last_success(session, [SOURCE_KEY])),
    }


def trend(session: Session, procedure_id: int) -> dict[str, Any]:
    """Median wait per day from the daily snapshots (only days with data)."""
    rows = session.execute(
        select(WlSnapshot.day, WlSnapshot.wait_days)
        .where(WlSnapshot.procedure_id == procedure_id, WlSnapshot.wait_days.is_not(None))
        .order_by(WlSnapshot.day)
    ).all()
    per_day: dict[str, list[int]] = defaultdict(list)
    for day, wait in rows:
        if wait is not None:  # the query keeps only known waits
            per_day[day.isoformat()].append(wait)
    return {
        "procedure_id": procedure_id,
        "days": [
            {"day": d, "median_days": _median(v), "lists": len(v)} for d, v in per_day.items()
        ],
    }

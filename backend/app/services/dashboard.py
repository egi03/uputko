"""Dashboard for municipalities and health administration.

A (access) uses real data only: DZS census x HZZO practices per JLS.
C (statistics) uses tool_calls and source_status; demo rows are reported separately.
"""

from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.geo.normalize import normalize
from app.models import Demographics, HealthFacility, SourceStatus, ToolCall
from app.timeutil import ensure_utc, iso_local, local_today, now_utc, to_local

PZZ_TYPES = ("family_medicine", "pediatrics", "gynecology", "dentistry")
UNANSWERED = ("not_found", "no_data", "ambiguous")
# The tools of the contract (agent/tools.schema.json).
TOOLS = ("find_waiting_times", "find_health_facilities", "get_drug_info")
STATS_DAYS = 30

# Expected refresh interval per source (minutes).
SOURCE_INTERVALS = {
    "cezih_lists": 12 * 60,
    "hzzo_pzz": 24 * 60,
    "hzzo_skzz": 24 * 60,
    "hzzo_hospitals": 24 * 60,
    "halmed_drugs": 24 * 60,
    "hzzo_drug_lists": 24 * 60,
}
SOURCE_LABELS = {
    "cezih_lists": "HZZO liste čekanja (CEZIH)",
    "halmed_drugs": "HALMED baza lijekova",
    "hzzo_drug_lists": "HZZO osnovna i dopunska lista lijekova",
    "hzzo_pzz": "HZZO ordinacije primarne zaštite",
    "hzzo_skzz": "HZZO specijalistička zaštita izvan bolnica",
    "hzzo_hospitals": "HZZO bolnice i ugovorene djelatnosti",
    "dzs_settlements": "DZS stanovništvo po naseljima",
    "dzs_municipalities": "DZS stanovništvo po gradovima/općinama",
    "geonames_hr": "GeoNames naselja",
    "county_boundaries": "Granice županija (DHMZ)",
}


def _jls_key(county: str, municipality: str) -> tuple[str, str]:
    return (normalize(county), normalize(municipality))


def _per_10k(count: int, population: int) -> float | None:
    return round(count / population * 10_000, 1) if population else None


def access(session: Session, county: str | None = None) -> dict[str, Any]:
    counts: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    rows = session.execute(
        select(
            HealthFacility.county, HealthFacility.municipality, HealthFacility.type, func.count()
        )
        .where(HealthFacility.type.in_(PZZ_TYPES), HealthFacility.place_id.is_not(None))
        .group_by(HealthFacility.county, HealthFacility.municipality, HealthFacility.type)
    ).all()
    for c, m, t, n in rows:
        counts[_jls_key(c, m)][t] += n

    stmt = select(Demographics).order_by(Demographics.county, Demographics.municipality)
    if county:
        stmt = stmt.where(Demographics.county == county)
    out = []
    for d in session.scalars(stmt):
        by_type = counts.get(_jls_key(d.county, d.municipality), Counter())
        pzz = sum(by_type.values())
        out.append(
            {
                "municipality": d.municipality,
                "municipality_type": d.municipality_type,
                "county": d.county,
                "population": d.population_total,
                "population_65_plus": d.population_65_plus,
                "share_65_plus_pct": round(d.population_65_plus / d.population_total * 100, 1)
                if d.population_65_plus is not None and d.population_total
                else None,
                "pzz_practices": pzz,
                "pzz_per_10k": _per_10k(pzz, d.population_total),
                "gp_per_10k": _per_10k(by_type["family_medicine"], d.population_total),
            }
        )
    counties = sorted({d for (d,) in session.execute(select(Demographics.county).distinct()).all()})
    return {
        "rows": out,
        "counties": counties,
        "sources": {
            "population": "DZS, Popis 2021., tablica 6",
            "practices": "HZZO, ugovorene ordinacije PZZ",
        },
        "is_demo": False,
    }


def _bucket(rows: list[ToolCall], key: Callable[[ToolCall], str | None]) -> list[dict[str, Any]]:
    agg: dict[str, Any] = defaultdict(lambda: {"real": 0, "demo": 0})
    for r in rows:
        k = key(r)
        if k is None:
            continue
        agg[k]["demo" if r.is_demo else "real"] += 1
    return [{"key": k, **v} for k, v in sorted(agg.items(), key=lambda kv: str(kv[0]))]


def query_stats(session: Session) -> dict[str, Any]:
    since = now_utc() - timedelta(days=STATS_DAYS)
    rows = list(
        session.scalars(select(ToolCall).where(ToolCall.ts >= since, ToolCall.tool.in_(TOOLS)))
    )

    def day(r: ToolCall) -> str:
        return to_local(r.ts).date().isoformat()

    def week(r: ToolCall) -> str:
        y, w, _ = to_local(r.ts).isocalendar()
        return f"{y}-W{w:02d}"

    today = local_today()
    days = [(today - timedelta(days=i)).isoformat() for i in range(STATS_DAYS - 1, -1, -1)]
    by_day = {b["key"]: b for b in _bucket(rows, day)}
    return {
        "window_days": STATS_DAYS,
        "by_day": [by_day.get(d, {"key": d, "real": 0, "demo": 0}) for d in days],
        "by_week": _bucket(rows, week),
        "by_tool": _bucket(rows, lambda r: r.tool),
        "by_topic": _bucket(rows, lambda r: f"{r.tool}:{r.topic}" if r.topic else r.tool),
        "by_county": _bucket(rows, lambda r: r.county),
        "by_profile": _bucket(rows, lambda r: r.profile or "nepoznato"),
        "unanswered": _bucket(
            [r for r in rows if r.status in UNANSWERED],
            lambda r: f"{r.tool}:{r.status}" + (f":{r.topic}" if r.topic else ""),
        ),
        "totals": {
            "real": sum(1 for r in rows if not r.is_demo),
            "demo": sum(1 for r in rows if r.is_demo),
        },
    }


def source_freshness(session: Session) -> list[dict[str, Any]]:
    now = now_utc()
    out = []
    for s in session.scalars(select(SourceStatus).order_by(SourceStatus.source_key)):
        last_ok = ensure_utc(s.last_success_at)
        last_err = ensure_utc(s.last_error_at)
        interval = SOURCE_INTERVALS.get(s.source_key)
        age_min = round((now - last_ok).total_seconds() / 60) if last_ok else None
        if last_ok is None or (last_err and last_err > last_ok):
            state = "error"
        elif interval and age_min is not None and age_min > 3 * interval:
            state = "stale"
        else:
            state = "ok"
        out.append(
            {
                "source_key": s.source_key,
                "label": SOURCE_LABELS.get(s.source_key, s.source_key),
                "state": state,
                "last_success_at": iso_local(last_ok),
                "age_minutes": age_min,
                "interval_minutes": interval,
                "last_error_at": iso_local(last_err),
                "last_error": s.last_error if state == "error" else None,
                "record_count": s.record_count,
                "source_updated_at": iso_local(s.source_updated_at),
            }
        )
    return out

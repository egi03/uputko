"""Plausible anonymous demo rows in tool_calls (is_demo = true) for dashboard part C.

    uv run python -m app.jobs.demo_data [--count 1500] [--days 30] [--clear]

Demo rows never feed the real-data parts of the dashboard (A and B).
"""

import argparse
import logging
import random
from datetime import UTC, timedelta

from sqlalchemy import delete, select

from app.config import get_settings
from app.db import init_db, session_scope
from app.models import Demographics, ToolCall
from app.timeutil import now_utc, to_local

log = logging.getLogger(__name__)

TOOLS = [  # (tool, weight, topics, unanswered share, uses a place)
    (
        "find_waiting_times",
        50,
        ["mr", "ct", "ultrasound", "cardiology", "ophthalmology", "endoscopy", "mammography"],
        0.1,
        True,
    ),
    (
        "find_health_facilities",
        30,
        ["family_medicine", "pediatrics", "hospital", "dentistry", "gynecology", "any"],
        0.08,
        True,
    ),
    ("get_drug_info", 20, ["brand", "substance"], 0.12, False),
]
DAY_WEIGHTS = [2, 4, 7, 9, 10, 10, 9, 9, 10, 10, 11, 12, 13, 12, 10, 8, 6, 4]  # 6–23 h


def generate(count: int, days: int, seed: int = 42) -> list[ToolCall]:
    rng = random.Random(seed)  # noqa: S311 - reproducible demo rows, not a secret
    now = now_utc()
    with session_scope() as session:
        jls = [
            (d.municipality, d.municipality_type, d.county, d.population_total)
            for d in session.scalars(select(Demographics))
        ]
    if not jls:
        raise SystemExit("Run the seed first (demographics are needed for realistic counties).")
    weights = [p for *_rest, p in jls]
    rows = []
    for _ in range(count):
        tool, _w, topics, unanswered, uses_place = rng.choices(
            TOOLS, weights=[t[1] for t in TOOLS]
        )[0]
        local = to_local(now) - timedelta(days=rng.randrange(days))
        local = local.replace(
            hour=6 + rng.choices(range(18), weights=DAY_WEIGHTS)[0], minute=rng.randrange(60)
        )
        ts = local.astimezone(UTC)
        if ts > now:  # later today: an earlier day instead, so no single day piles up
            ts = (
                ts - timedelta(days=rng.randrange(1, days))
                if days > 1
                else now - timedelta(minutes=rng.randrange(1, 60))
            )
        municipality, mtype, county, _p = rng.choices(jls, weights=weights)[0]
        status = "ok"
        if rng.random() < unanswered:
            status = "not_found" if uses_place else "no_data"
        has_place = uses_place and status != "not_found"
        rows.append(
            ToolCall(
                ts=ts,
                tool=tool,
                topic=rng.choice(topics),
                place_id=None,
                municipality=f"{'Grad' if mtype == 'Grad' else 'Općina'} {municipality}"
                if has_place
                else None,
                county=county if has_place else None,
                status=status,
                latency_ms=rng.randint(3, 40),
                profile="open" if rng.random() < 0.15 else "premium",
                is_demo=True,
            )
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate demo tool_calls (is_demo = true)")
    parser.add_argument("--count", type=int, default=1500)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--clear", action="store_true", help="only delete existing demo rows")
    args = parser.parse_args()
    logging.basicConfig(
        level=get_settings().log_level, format="%(levelname)s %(name)s: %(message)s"
    )
    init_db()
    with session_scope() as session:
        session.execute(delete(ToolCall).where(ToolCall.is_demo.is_(True)))
    if args.clear:
        log.info("demo rows deleted")
        return
    rows = generate(args.count, args.days)
    with session_scope() as session:
        session.add_all(rows)
    log.info("%s demo rows written (is_demo = true)", len(rows))


if __name__ == "__main__":
    main()

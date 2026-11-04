"""Scheduled ingest jobs (APScheduler)."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

log = logging.getLogger(__name__)

START_DELAY = timedelta(minutes=1)  # let the app finish starting before a catch-up run


@dataclass(frozen=True)
class Job:
    key: str
    func: Callable[[], None]
    interval_min: int
    sources: tuple[str, ...] = ()  # SourceStatus keys the job refreshes


def jobs() -> list[Job]:
    """In run order: CEZIH institutions are located with the HZZO registries."""
    from app.ingest import cezih_jobs as c
    from app.ingest import drugs_jobs as d
    from app.ingest import hzzo_jobs as h
    from app.jobs import maintenance as m

    return [
        Job("hzzo_facilities", h.fetch_health_facilities, 24 * 60, tuple(h.SOURCE_KEYS.values())),
        # HALMED asks for a daily refresh.
        Job("drugs", d.fetch_drugs, 24 * 60, tuple(d.SOURCE_KEYS.values())),
        Job("cezih_lists", c.fetch_waiting_lists, 12 * 60, (c.SOURCE_KEY,)),
        Job("purge_cards", m.purge_old_cards, 60),
    ]


def run_all_jobs_once() -> None:
    for job in jobs():
        try:
            job.func()
        except Exception:  # one failing source must not stop the others
            log.exception("job %s failed", job.key)


def first_run(job: Job, now: datetime) -> datetime:
    """A restart does not postpone a refresh by a whole interval: the job runs when its interval
    since the last success is over, or right away (after START_DELAY) if that is already past."""
    from app.db import session_scope
    from app.models import SourceStatus

    if not job.sources:
        return now + timedelta(minutes=job.interval_min)
    with session_scope() as session:
        times = session.scalars(
            select(SourceStatus.last_success_at).where(SourceStatus.source_key.in_(job.sources))
        ).all()
    known = [t for t in times if t is not None]
    if len(known) < len(job.sources):  # a source never succeeded
        return now + START_DELAY
    return max(min(known) + timedelta(minutes=job.interval_min), now + START_DELAY)


def start_scheduler(*, catch_up: bool = True) -> BackgroundScheduler:
    """One worker thread: ingest jobs run one after another, never competing for SQLite's write
    lock, and a job that waits for the worker still runs (no misfire limit). Without catch_up
    (the seed is fetching everything right now) the first runs come after a full interval."""
    scheduler = BackgroundScheduler(
        timezone="UTC",
        executors={"default": ThreadPoolExecutor(max_workers=1)},
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": None},
    )
    now = datetime.now(UTC)
    for job in jobs():
        start = first_run(job, now) if catch_up else now + timedelta(minutes=job.interval_min)
        scheduler.add_job(
            job.func, "interval", minutes=job.interval_min, id=job.key, next_run_time=start
        )
        log.info("job %s: first run at %s", job.key, start.isoformat(timespec="minutes"))
    scheduler.start()
    return scheduler

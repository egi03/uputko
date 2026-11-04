from datetime import datetime

from sqlalchemy.orm import Session

from app.models import SourceStatus
from app.timeutil import now_utc


def _get(session: Session, key: str) -> SourceStatus:
    status = session.get(SourceStatus, key)
    if status is None:
        status = SourceStatus(source_key=key)
        session.add(status)
    return status


MIN_SHARE_OF_LAST = 0.5  # a source that suddenly shrinks by half more likely changed shape


def check_plausible(session: Session, key: str, count: int) -> None:
    """Refuse to replace a source's rows with far fewer than last time (a changed file or page
    that parses to almost nothing); the old rows stay and the error is recorded."""
    status = session.get(SourceStatus, key)
    last = status.record_count if status and status.record_count else 0
    if count == 0 or count < MIN_SHARE_OF_LAST * last:
        raise ValueError(f"{key}: {count} rows, last time {last}; keeping the old data")


def mark_success(
    session: Session, key: str, record_count: int, source_updated_at: datetime | None = None
) -> None:
    status = _get(session, key)
    status.last_success_at = now_utc()
    status.record_count = record_count
    status.source_updated_at = source_updated_at


def mark_error(session: Session, key: str, error: str) -> None:
    status = _get(session, key)
    status.last_error_at = now_utc()
    status.last_error = error[:500]

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import overload
from zoneinfo import ZoneInfo

from app.config import get_settings


def _system_clock() -> datetime:
    return datetime.now(UTC)


_clock: Callable[[], datetime] = _system_clock


def set_clock(clock: Callable[[], datetime] | None) -> None:
    """Tests only: fix 'now' to the day the fixtures were downloaded."""
    global _clock  # noqa: PLW0603 - the one seam tests use to fix "now"
    _clock = clock or _system_clock


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def now_utc() -> datetime:
    return _clock()


@overload
def ensure_utc(dt: datetime) -> datetime: ...
@overload
def ensure_utc(dt: None) -> None: ...
def ensure_utc(dt: datetime | None) -> datetime | None:
    """SQLite drops tzinfo; values are always stored in UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


@overload
def to_local(dt: datetime) -> datetime: ...
@overload
def to_local(dt: None) -> None: ...
def to_local(dt: datetime | None) -> datetime | None:
    return ensure_utc(dt).astimezone(tz()) if dt is not None else None


def iso_local(dt: datetime | None) -> str | None:
    local = to_local(dt)
    return local.isoformat(timespec="seconds") if local else None


def local_today(now: datetime | None = None) -> date:
    return (now or now_utc()).astimezone(tz()).date()

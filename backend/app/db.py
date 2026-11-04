from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import override

from sqlalchemy import DateTime, MetaData, create_engine, event
from sqlalchemy.engine import Dialect, Engine
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry
from sqlalchemy.types import TypeDecorator

from app.config import get_settings
from app.timeutil import ensure_utc


class Base(DeclarativeBase):
    pass


class UtcDateTime(TypeDecorator[datetime]):
    """A point in time stored as UTC. SQLite keeps no offset, so an aware value (a CEZIH time in
    Europe/Zagreb) is converted on the way in, and values come back aware in UTC."""

    impl = DateTime
    cache_ok = True

    @override
    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None or value.tzinfo is None:  # naive values are UTC by convention
            return value
        return value.astimezone(UTC).replace(tzinfo=None)

    @override
    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        return ensure_utc(value)


def _make_engine(url: str) -> Engine:
    if url.startswith("sqlite:///"):
        path = url.removeprefix("sqlite:///")
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn: DBAPIConnection, _record: ConnectionPoolEntry) -> None:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    return engine


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# Bump when tables change, and export a new snapshot (app.jobs.snapshot): one made for another
# version is not restored. An older database is rebuilt: every table except the usage statistics
# is dropped and refilled on start (AUTO_SEED: the snapshot, else the seed) or by app.jobs.seed.
SCHEMA_VERSION = 6
KEEP_ON_REBUILD = {"tool_calls"}


def init_db(bind: Engine | None = None) -> None:
    from app import models  # noqa: F401  (register tables)

    with (bind or engine).begin() as conn:
        version = conn.exec_driver_sql("PRAGMA user_version").scalar()
        if version != SCHEMA_VERSION:
            old = MetaData()
            old.reflect(conn)
            drop = [t for name, t in old.tables.items() if name not in KEEP_ON_REBUILD]
            old.drop_all(conn, tables=drop)
            conn.exec_driver_sql(f"PRAGMA user_version = {SCHEMA_VERSION}")
        Base.metadata.create_all(conn)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

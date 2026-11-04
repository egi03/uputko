"""A database snapshot kept in the repository: a fresh clone answers right away instead of seeding
for ~20 minutes, and keeps the waiting-time trend, which CEZIH does not publish.

Export after a refresh: uv run python -m app.jobs.snapshot
On first start with an empty database (AUTO_SEED) the app restores it and then refreshes the
sources on schedule; the records keep their own fetch dates, so answers never look fresher.
"""

import argparse
import gzip
import logging
import shutil
import sqlite3
import tempfile
from pathlib import Path

from sqlalchemy import make_url
from sqlalchemy.engine import Engine

from app import models  # noqa: F401  (register tables)
from app.config import get_settings
from app.db import SCHEMA_VERSION, Base

log = logging.getLogger(__name__)

# Usage statistics and conversation cards belong to one installation, never to the snapshot.
LOCAL_TABLES = frozenset({"tool_calls", "cards"})


def export_snapshot(db_path: Path, out: Path) -> int:
    """Gzip a compacted copy of the database without the local tables. Returns the size in bytes."""
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        copy = Path(tmp) / "snapshot.db"
        src, dst = sqlite3.connect(db_path), sqlite3.connect(copy)
        try:
            src.backup(dst)  # consistent even while the app is writing
            for table in sorted(LOCAL_TABLES):
                dst.execute(f'DELETE FROM "{table}"')  # noqa: S608 - the app's own table names
            dst.commit()
            dst.execute("PRAGMA journal_mode=DELETE")  # one self-contained file
            dst.execute("VACUUM")
        finally:
            src.close()
            dst.close()
        with copy.open("rb") as f, gzip.open(out, "wb", compresslevel=9) as g:
            shutil.copyfileobj(f, g)
    return out.stat().st_size


def restore_snapshot(engine: Engine, snapshot: Path) -> bool:
    """Replace the source data with the snapshot; local tables are kept. False when there is no
    snapshot or it was made for another schema version (then the seed fills the database)."""
    if not snapshot.is_file():
        return False
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        copy = Path(tmp) / "snapshot.db"
        with gzip.open(snapshot, "rb") as g, copy.open("wb") as f:
            shutil.copyfileobj(g, f)
        with engine.connect() as conn:
            conn.exec_driver_sql("ATTACH DATABASE ? AS snap", (str(copy),))
            try:
                version = conn.exec_driver_sql("PRAGMA snap.user_version").scalar()
                if version != SCHEMA_VERSION:
                    log.warning("snapshot schema %s, app %s: seeding", version, SCHEMA_VERSION)
                    return False
                tables = [t for t in Base.metadata.sorted_tables if t.name not in LOCAL_TABLES]
                # Table and column names come from the app's own metadata, never from a request.
                for table in reversed(tables):  # children first, for the foreign keys
                    conn.exec_driver_sql(f'DELETE FROM main."{table.name}"')  # noqa: S608
                for table in tables:
                    cols = ", ".join(f'"{c.name}"' for c in table.columns)
                    conn.exec_driver_sql(
                        f'INSERT INTO main."{table.name}" ({cols})'  # noqa: S608
                        f' SELECT {cols} FROM snap."{table.name}"'
                    )
                conn.commit()
            finally:
                conn.rollback()  # DETACH is not allowed inside a transaction
                conn.exec_driver_sql("DETACH DATABASE snap")
    return True


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Export the database snapshot for the repository")
    parser.add_argument("--out", type=Path, default=settings.snapshot_path)
    args = parser.parse_args()
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s: %(message)s")
    db_path = Path(make_url(settings.database_url).database or "")
    size = export_snapshot(db_path, args.out)
    log.info("snapshot %s: %s KB", args.out, size // 1024)


if __name__ == "__main__":
    main()

"""FastAPI dependencies: DB session and in-memory indexes cached on app.state."""

import time
from collections.abc import Callable, Iterator
from typing import cast

from fastapi import Request
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.geo.gazetteer import Gazetteer
from app.geo.store import load_gazetteer
from app.services.procedures import ProcedureIndex, load_procedures

PROCEDURES_TTL_S = 15 * 60  # waiting-list counts change with every fetch


def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def get_gazetteer(request: Request) -> Gazetteer:
    gaz: Gazetteer | None = getattr(request.app.state, "gazetteer", None)
    if gaz is None or len(gaz) == 0:
        with SessionLocal() as session:
            gaz = load_gazetteer(session)
        request.app.state.gazetteer = gaz
    return gaz


def get_procedures(request: Request) -> ProcedureIndex:
    cached: tuple[float, ProcedureIndex] | None = getattr(request.app.state, "procedures", None)
    if cached is None or not len(cached[1]) or time.monotonic() - cached[0] > PROCEDURES_TTL_S:
        with SessionLocal() as session:
            cached = (time.monotonic(), load_procedures(session))
        request.app.state.procedures = cached
    return cached[1]


def app_cached[T](
    request: Request,
    key: str,
    ttl_s: float,
    compute: Callable[[], T],
    keep: Callable[[T], bool] = lambda _value: True,
) -> T:
    """A computed answer kept on app.state for ttl_s seconds (it changes only with a fetch).
    An answer `keep` rejects (no data yet) is not kept: the next request computes it again."""
    store: dict[str, tuple[float, object]] = getattr(request.app.state, "computed", None) or {}
    hit = store.get(key)
    if hit is not None and time.monotonic() - hit[0] <= ttl_s:
        return cast(T, hit[1])
    value = compute()
    if keep(value):
        request.app.state.computed = {**store, key: (time.monotonic(), value)}
    return value

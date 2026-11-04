"""Read-only REST for the premium UI: dashboard and source freshness."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.deps import get_db
from app.services import dashboard

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]


@router.get("/dashboard/access")
def dashboard_access(
    db: Db, county: Annotated[str | None, Query(max_length=80)] = None
) -> dict[str, Any]:
    return dashboard.access(db, county)


@router.get("/dashboard/stats")
def dashboard_stats(db: Db) -> dict[str, Any]:
    return {**dashboard.query_stats(db), "sources": dashboard.source_freshness(db)}


@router.get("/sources")
def sources(db: Db) -> list[dict[str, Any]]:
    return dashboard.source_freshness(db)

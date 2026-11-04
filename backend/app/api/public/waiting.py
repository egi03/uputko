"""Waiting lists for the premium UI (/termini page, front page examples, dashboard part B). Not
logged as tool calls."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.deps import app_cached, get_db, get_gazetteer, get_procedures
from app.geo.gazetteer import Gazetteer
from app.services import waiting, waiting_stats
from app.services.procedures import ProcedureIndex

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
Procedures = Annotated[ProcedureIndex, Depends(get_procedures)]
ProcedureId = Annotated[int, Query(ge=1, le=10_000_000)]
EXAMPLES_TTL_S = 15 * 60  # the lists change twice a day; the examples cost about 0.3 s


def _known(index: ProcedureIndex, procedure_id: int) -> None:
    if index.get(procedure_id) is None:
        raise HTTPException(status_code=404, detail="Postupak nije na listama čekanja.")


@router.get("/procedures")
def procedures(
    q: Annotated[str, Query(min_length=2, max_length=80)],
    index: Procedures,
    limit: Annotated[int, Query(ge=1, le=15)] = 8,
) -> list[dict[str, Any]]:
    return [
        {
            "id": p.id,
            "name": p.name,
            "category": p.category,
            "institutions": p.institutions,
            "median_days": p.median_days,
        }
        for p in index.search(q, limit)
    ]


@router.get("/waiting-times")
def waiting_times(
    db: Db,
    gaz: Annotated[Gazetteer, Depends(get_gazetteer)],
    index: Procedures,
    procedure: Annotated[str, Query(max_length=160)] = "",
    procedure_id: Annotated[int | None, Query(ge=1, le=10_000_000)] = None,
    location: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=5)] = 5,
) -> dict[str, Any]:
    """The same answer as the agent tool, plus the full list for the page."""
    if not procedure and procedure_id is None:
        raise HTTPException(status_code=422, detail="Navedite postupak.")
    res = waiting.find_waiting_times(
        db, gaz, index, procedure, location or None, limit, procedure_id=procedure_id
    )
    return {**res.model_dump(), "extra": res.card_extra}


@router.get("/waiting-times/examples")
def waiting_examples(
    request: Request,
    db: Db,
    gaz: Annotated[Gazetteer, Depends(get_gazetteer)],
    index: Procedures,
    limit: Annotated[int, Query(ge=1, le=5)] = 3,
) -> dict[str, Any]:
    """Today's real cases of a much sooner appointment nearby (the front page)."""
    return app_cached(
        request,
        f"waiting-examples:{limit}",
        EXAMPLES_TTL_S,
        lambda: waiting.examples(db, gaz, index, limit),
        keep=lambda answer: answer["status"] == "ok",
    )


@router.get("/waiting-times/counties")
def waiting_by_county(db: Db, index: Procedures, procedure_id: ProcedureId) -> dict[str, Any]:
    _known(index, procedure_id)
    return waiting_stats.by_county(db, procedure_id)


@router.get("/waiting-times/overview")
def waiting_overview(db: Db) -> dict[str, Any]:
    return waiting_stats.overview(db)


@router.get("/waiting-times/trend")
def waiting_trend(db: Db, index: Procedures, procedure_id: ProcedureId) -> dict[str, Any]:
    _known(index, procedure_id)
    return waiting_stats.trend(db, procedure_id)

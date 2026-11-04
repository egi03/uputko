"""Webhook tools for both voice profiles (/tools/*). Thin: auth, call service, log, card."""

import hmac
import logging
import time
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_db, get_gazetteer, get_procedures
from app.geo.gazetteer import Gazetteer
from app.schemas import DrugRequest, HealthRequest, ToolResponse, WaitingRequest
from app.services import drugs, health, waiting
from app.services.cards import create_card
from app.services.procedures import ProcedureIndex
from app.services.tool_log import log_tool_call

log = logging.getLogger(__name__)


def require_tool_secret(x_tool_secret: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().tool_secret
    if not expected:
        raise HTTPException(status_code=503, detail="TOOL_SECRET is not configured")
    # Bytes: compare_digest refuses non-ASCII str, and a header can carry any byte.
    given = (x_tool_secret or "").encode("utf-8", "surrogateescape")
    if not given or not hmac.compare_digest(given, expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="invalid X-Tool-Secret")


router = APIRouter(prefix="/tools", tags=["tools"], dependencies=[Depends(require_tool_secret)])

Db = Annotated[Session, Depends(get_db)]
Gaz = Annotated[Gazetteer, Depends(get_gazetteer)]
Procedures = Annotated[ProcedureIndex, Depends(get_procedures)]
Profile = Annotated[str | None, Header(alias="X-Profile")]


def run_tool(
    session: Session,
    gazetteer: Gazetteer,
    *,
    tool: str,
    topic: str | Callable[[ToolResponse], str | None] | None,
    conversation_id: str | None,
    profile: str | None,
    call: Callable[[], ToolResponse],
) -> ToolResponse:
    started = time.perf_counter()
    try:
        response = call()
    except Exception:
        log.exception("tool %s failed", tool)
        session.rollback()
        response = ToolResponse(
            status="error",
            summary_hr=(
                "Dogodila se greška pri dohvaćanju podataka. Pokušajte ponovno malo kasnije."
            ),
            source="Uputko",
        )
    response.card_id = create_card(session, tool, response, conversation_id)
    log_tool_call(
        session,
        tool=tool,
        topic=topic(response) if callable(topic) else topic,
        response=response,
        gazetteer=gazetteer,
        latency_ms=round((time.perf_counter() - started) * 1000),
        profile=profile,
    )
    session.commit()
    return response


@router.post("/find_health_facilities")
def find_health_facilities(
    req: HealthRequest, db: Db, gaz: Gaz, x_profile: Profile = None
) -> ToolResponse:
    return run_tool(
        db,
        gaz,
        tool="find_health_facilities",
        topic=req.facility_type,
        conversation_id=req.conversation_id,
        profile=x_profile,
        call=lambda: health.find_health_facilities(
            db, gaz, req.location, req.facility_type, req.limit
        ),
    )


@router.post("/find_waiting_times")
def find_waiting_times(
    req: WaitingRequest, db: Db, gaz: Gaz, procs: Procedures, x_profile: Profile = None
) -> ToolResponse:
    def call() -> ToolResponse:
        return waiting.find_waiting_times(db, gaz, procs, req.procedure, req.location, req.limit)

    def topic(response: ToolResponse) -> str | None:
        # Never the request text: the kind of service it resolved to, or the outcome.
        procedure = response.data.get("procedure") or {}
        return procedure.get("category") or (None if response.status == "ok" else response.status)

    return run_tool(
        db,
        gaz,
        tool="find_waiting_times",
        topic=topic,
        conversation_id=req.conversation_id,
        profile=x_profile,
        call=call,
    )


@router.post("/get_drug_info")
def get_drug_info(req: DrugRequest, db: Db, gaz: Gaz, x_profile: Profile = None) -> ToolResponse:
    return run_tool(
        db,
        gaz,
        tool="get_drug_info",
        topic=lambda r: r.data.get("query_kind") or r.status,
        conversation_id=req.conversation_id,
        profile=x_profile,
        call=lambda: drugs.get_drug_info(db, req.name),
    )

"""Screen cards: one card by id (the open page) and an SSE stream per
conversation (premium: the tools receive system__conversation_id)."""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.deps import get_db
from app.services.cards import cards_for_conversation, get_card

router = APIRouter()

POLL_SECONDS = 0.4  # cards must appear within 1 s of the tool response
STREAM_MAX_SECONDS = 15 * 60  # conversations last at most ~10 minutes
KEEPALIVE_SECONDS = 15
ID_PATTERN = r"^[A-Za-z0-9_\-]{1,80}$"


@router.get("/cards/{card_id}")
def card(
    card_id: Annotated[str, Path(pattern=r"^c_[0-9a-f]{12}$")],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    found = get_card(db, card_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Kartica ne postoji ili je istekla.")
    return found


def _cards_after(conversation_id: str, last: str | None) -> list[dict[str, Any]]:
    """In a worker thread: the event loop keeps serving while SQLite answers."""
    with SessionLocal() as session:
        return cards_for_conversation(session, conversation_id, after=last)


async def _card_events(request: Request, conversation_id: str) -> AsyncIterator[str]:
    last: str | None = None
    started = last_ping = time.monotonic()
    yield "retry: 1000\n\n"
    while time.monotonic() - started < STREAM_MAX_SECONDS:
        if await request.is_disconnected():
            return
        new = await asyncio.to_thread(_cards_after, conversation_id, last)
        for c in new:
            last = c["card_id"]
            yield f"id: {last}\nevent: card\ndata: {json.dumps(c, ensure_ascii=False)}\n\n"
        if time.monotonic() - last_ping > KEEPALIVE_SECONDS:
            last_ping = time.monotonic()
            yield ": keepalive\n\n"
        await asyncio.sleep(POLL_SECONDS)


@router.get("/conversations/{conversation_id}/cards/stream")
async def card_stream(
    request: Request, conversation_id: Annotated[str, Path(pattern=ID_PATTERN)]
) -> StreamingResponse:
    return StreamingResponse(
        _card_events(request, conversation_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

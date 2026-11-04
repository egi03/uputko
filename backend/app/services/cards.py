"""Short-lived screen cards. Deleted after 24 h."""

import json
import secrets
from datetime import timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.orm import Session

from app.models import Card
from app.schemas import ToolResponse
from app.timeutil import ensure_utc, iso_local, now_utc

CARD_TTL = timedelta(hours=24)
CARD_STATUSES = {"ok", "no_data"}


def create_card(
    session: Session, tool: str, response: ToolResponse, conversation_id: str | None
) -> str | None:
    if response.status not in CARD_STATUSES:
        return None
    card_id = f"c_{secrets.token_hex(6)}"
    payload: dict[str, Any] = {
        "tool": tool,
        **response.model_dump(exclude={"card_id"}),
        "extra": response.card_extra,
    }
    session.add(
        Card(
            id=card_id,
            conversation_id=conversation_id,
            tool=tool,
            payload_json=json.dumps(payload, ensure_ascii=False),
            created_at=now_utc(),
        )
    )
    return card_id


def card_out(card: Card) -> dict[str, Any]:
    return {
        "card_id": card.id,
        "created_at": iso_local(card.created_at),
        **json.loads(card.payload_json),
    }


def get_card(session: Session, card_id: str) -> dict[str, Any] | None:
    card = session.get(Card, card_id)
    if card is None or now_utc() - ensure_utc(card.created_at) > CARD_TTL:
        return None
    return card_out(card)


def cards_for_conversation(
    session: Session, conversation_id: str, after: str | None = None
) -> list[dict[str, Any]]:
    rows = session.scalars(
        select(Card).where(Card.conversation_id == conversation_id).order_by(Card.created_at)
    ).all()
    out = [card_out(c) for c in rows if now_utc() - ensure_utc(c.created_at) <= CARD_TTL]
    if after:
        ids = [c["card_id"] for c in out]
        out = out[ids.index(after) + 1 :] if after in ids else out
    return out


def purge_cards(session: Session) -> int:
    stmt = delete(Card).where(Card.created_at < now_utc() - CARD_TTL)
    result = cast(CursorResult[Any], session.execute(stmt))
    return result.rowcount or 0

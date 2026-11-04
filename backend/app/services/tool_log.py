"""Anonymous tool usage log (tool_calls). No query text, transcripts or IP addresses, and no
conversation id: it would link the statistics to the conversation kept by ElevenLabs. The
column stays (the table outlives schema changes) and is always empty."""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.geo.gazetteer import Gazetteer
from app.models import ToolCall
from app.schemas import ToolResponse
from app.timeutil import now_utc

PROFILES = {"premium", "open"}


def log_tool_call(
    session: Session,
    *,
    tool: str,
    topic: str | None,
    response: ToolResponse,
    gazetteer: Gazetteer | None,
    latency_ms: int,
    profile: str | None,
) -> None:
    municipality = county = None
    place_id = None
    if response.location is not None:
        county = response.location.county
        municipality = response.location.municipality
        if gazetteer is not None:
            # With its JLS: a name can repeat inside a county (two Bukevje in Zagrebačka).
            hit = gazetteer.resolve(f"{response.location.name}, {municipality}, {county}")
            place_id = hit.place.id if hit.status == "ok" and hit.place else None
    session.add(
        ToolCall(
            ts=now_utc(),
            tool=tool,
            topic=topic,
            place_id=place_id,
            municipality=municipality,
            county=county,
            status=response.status,
            latency_ms=latency_ms,
            profile=profile if profile in PROFILES else None,
            is_demo=False,
        )
    )


def forget_conversations(session: Session) -> int:
    """Clear the conversation ids an earlier version stored; returns how many rows had one."""
    stored = ToolCall.conversation_id.is_not(None)
    n = session.scalar(select(func.count()).select_from(ToolCall).where(stored)) or 0
    if n:
        session.execute(update(ToolCall).where(stored).values(conversation_id=None))
    return n

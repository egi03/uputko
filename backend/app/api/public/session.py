from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import Settings, get_settings

router = APIRouter()

API = "https://api.elevenlabs.io/v1/convai/conversation"
# WebRTC (voice) needs a conversation token; WebSocket (text-only) needs a signed URL.
ENDPOINTS = {
    "webrtc": (f"{API}/token", "token"),
    "websocket": (f"{API}/get-signed-url", "signed_url"),
}


class SessionToken(BaseModel):
    agent_id: str
    conversation_token: str | None = None
    signed_url: str | None = None  # both None: public agent, start with agent_id


@router.get("/session-token")
def session_token(
    settings: Annotated[Settings, Depends(get_settings)],
    transport: Literal["webrtc", "websocket"] = "webrtc",
) -> SessionToken:
    """Short-lived credentials for a private ElevenLabs agent; the API key stays on the server."""
    agent_id = settings.elevenlabs_agent_id
    if not agent_id:
        raise HTTPException(status_code=503, detail="Agent nije konfiguriran.")
    if not settings.elevenlabs_api_key:
        return SessionToken(agent_id=agent_id)
    url, field = ENDPOINTS[transport]
    try:
        resp = httpx.get(
            url,
            params={"agent_id": agent_id},
            headers={"xi-api-key": settings.elevenlabs_api_key},
            timeout=settings.http_timeout_s,
        )
        resp.raise_for_status()
        value = resp.json()[field]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="Razgovor trenutno nije moguće pokrenuti."
        ) from exc
    if transport == "webrtc":
        return SessionToken(agent_id=agent_id, conversation_token=value)
    return SessionToken(agent_id=agent_id, signed_url=value)

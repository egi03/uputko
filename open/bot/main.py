"""Open profile HTTP server: the page, WebRTC signalling and one bot per connection.

uv run python -m bot.main          # http://localhost:7860
"""

import asyncio
import sys
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from functools import partial

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

from bot.config import OPEN_DIR, Settings, get_settings
from bot.pipeline import run_bot
from bot.tts_local import create_tts, preload

CLIENT = OPEN_DIR / "client" / "index.html"
STATIC = OPEN_DIR / "client" / "static"  # icon and the typeface (Schibsted Grotesk, OFL)


def configure_logging(level: str) -> None:
    """Log at OPEN_LOG_LEVEL (INFO by default) instead of loguru's DEBUG, where Pipecat writes
    what the user said and the text to speak, and without variable values in tracebacks. Called
    before any conversation starts."""
    logger.remove()
    # diagnose=False: loguru would otherwise print every local variable of a failing call,
    # what the user said and the keys among them.
    logger.add(sys.stderr, level=level, backtrace=False, diagnose=False)


def prepare_local(settings: Settings) -> None:
    """Load Whisper and the Ollama model before the first visitor (OPEN_MODE=local)."""
    from bot.local_llm import prepare
    from bot.local_stt import preload as preload_stt

    logger.info(f"Local mode: Whisper {settings.local_stt_model}, Ollama {settings.ollama_model}")
    steps: tuple[Callable[[], None], ...] = (
        partial(preload_stt, settings.local_stt_model, settings.local_stt_device),
        partial(prepare, settings),
    )
    for step in steps:
        try:
            step()
        except Exception:  # noqa: BLE001 - the page still loads; the log says what failed
            logger.exception("Local model could not be prepared")


def create_app() -> FastAPI:
    settings = get_settings()
    ice_servers = [IceServer(urls=url) for url in settings.ice_servers]
    handler = SmallWebRTCRequestHandler(ice_servers=ice_servers or None)
    sessions: set[asyncio.Task[None]] = set()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if settings.mode == "groq" and not settings.groq_api_key:
            logger.warning("GROQ_API_KEY is not set: the page loads, conversations will fail")
        try:  # before the server listens, so no conversation waits for the voice
            await asyncio.to_thread(preload, settings.tts_model)
        except Exception:  # noqa: BLE001 - the page still loads; the log says what failed
            logger.exception("Speech synthesis model could not be loaded")
        if settings.mode == "local":
            await asyncio.to_thread(prepare_local, settings)
        yield
        for task in sessions:
            task.cancel()

    app = FastAPI(title="Uputko – open profil", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(CLIENT, media_type="text/html; charset=utf-8")

    @app.get("/config")
    async def config() -> dict[str, object]:
        # Only the public backend URL for cards and ICE URLs; no keys ever reach the browser.
        return {"api_url": settings.public_api_url, "ice_servers": list(settings.ice_servers)}

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    async def guarded(connection: SmallWebRTCConnection) -> None:
        """A session that fails to start is logged and closed, not left hanging."""
        try:
            await run_bot(connection, settings, create_tts)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - one failed session must not affect the others
            logger.exception("Open bot session failed")
            await connection.disconnect()

    @app.post("/api/offer")
    async def offer(request: Request) -> JSONResponse:
        if len(sessions) >= settings.max_sessions:
            # Each conversation uses Groq and this machine's CPU: a fixed cap, not a queue.
            detail = "Svi razgovori su trenutno zauzeti. Pokušajte za minutu."
            return JSONResponse({"detail": detail}, status_code=503)
        body = await request.json()

        async def on_connection(connection: SmallWebRTCConnection) -> None:
            task = asyncio.create_task(guarded(connection))
            sessions.add(task)
            task.add_done_callback(sessions.discard)

        answer = await handler.handle_web_request(SmallWebRTCRequest.from_dict(body), on_connection)
        return JSONResponse(answer)

    @app.patch("/api/offer")
    async def patch_offer(request: Request) -> dict[str, str]:
        await handler.handle_patch_request(SmallWebRTCPatchRequest(**(await request.json())))
        return {"status": "ok"}

    return app


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    # No access log: it would record client IP addresses (privacy).
    uvicorn.run(create_app(), host=settings.host, port=settings.port, access_log=False)


if __name__ == "__main__":
    main()

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.public import cards, drugs, info, locate, places, session, waiting
from app.api.tools import router as tools
from app.config import get_settings
from app.db import SessionLocal, engine, init_db, session_scope
from app.geo.store import load_gazetteer
from app.ingest.hzzo_jobs import reclassify_hospitals
from app.ratelimit import RateLimitMiddleware
from app.services.tool_log import forget_conversations

log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s: %(message)s")
    # Access logs would keep client addresses and query strings (places, coordinates, medicines).
    logging.getLogger("uvicorn.access").disabled = True
    init_db()
    with SessionLocal() as db:
        # Load once at startup so the first tool call is fast (reloaded lazily if empty).
        app.state.gazetteer = load_gazetteer(db)
    if settings.auto_seed and len(app.state.gazetteer) == 0:
        from app.jobs.snapshot import restore_snapshot

        # A fresh clone: answer from the repository snapshot, the scheduler then catches up.
        if restore_snapshot(engine, settings.snapshot_path):
            log.info("restored the database snapshot %s", settings.snapshot_path)
            with SessionLocal() as db:
                app.state.gazetteer = load_gazetteer(db)
    with session_scope() as db:
        # A database or snapshot from before specialty clinics were told apart from hospitals.
        if reclassified := reclassify_hospitals(db):
            log.info("%s specialty clinics are no longer general hospitals", reclassified)
        # Statistics stored by an earlier version kept the conversation id.
        if forgotten := forget_conversations(db):
            log.info("conversation ids removed from %s tool calls", forgotten)
    seeding = settings.auto_seed and len(app.state.gazetteer) == 0
    if seeding:
        # First start with an empty database (Docker): seed in the background.
        import threading

        from app.jobs.seed import run as run_seed

        threading.Thread(target=run_seed, name="seed", daemon=True).start()
    scheduler = None
    if settings.scheduler_enabled:
        from app.jobs.scheduler import start_scheduler

        scheduler = start_scheduler(catch_up=not seeding)
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


_LOOPBACK = {"localhost": "127.0.0.1", "127.0.0.1": "localhost"}


def with_loopback_twins(origins: list[str]) -> list[str]:
    """Each origin, and on this computer its twin: the open bot prints http://127.0.0.1:7860,
    while the setting says http://localhost:7860; to the browser they are different origins."""
    out: list[str] = []
    for origin in origins:
        out.append(origin)
        host = urlsplit(origin).hostname or ""
        if host in _LOOPBACK:
            out.append(origin.replace(f"//{host}", f"//{_LOOPBACK[host]}", 1))
    return list(dict.fromkeys(o for o in out if o))


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Uputko API",
        version="0.3.0",
        description=(
            "Alati (/tools) i javni REST (/api) nad otvorenim podacima o zdravstvu: liste čekanja"
            " (HZZO, CEZIH), registri ustanova HZZO-a, lijekovi (HALMED, HZZO) i DZS."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=with_loopback_twins([settings.frontend_origin, settings.open_origin]),
        allow_methods=["GET"],  # tools are called server to server, never from a browser
        allow_headers=["Content-Type"],
    )
    app.add_middleware(RateLimitMiddleware, limit=settings.rate_limit_per_minute)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    for module in (locate, session, cards, info, places, waiting, drugs):
        app.include_router(module.router, prefix="/api", tags=["public"])
    app.include_router(tools.router)
    return app


app = create_app()

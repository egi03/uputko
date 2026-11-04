"""Simple per-client rate limit for public /api endpoints.

Client addresses live only in memory for the current window; they are never stored or logged.
Opening a card stream counts as one request; the stream itself is not limited.
"""

import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

MAX_CLIENTS = 10_000  # above this, clients idle for a whole window are forgotten


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self, app: ASGIApp, limit: int = 120, window_s: float = 60.0, prefix: str = "/api/"
    ) -> None:
        super().__init__(app)
        self.limit, self.window_s, self.prefix = limit, window_s, prefix
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _forget_idle(self, now: float) -> None:
        idle = [k for k, v in self._hits.items() if not v or now - v[-1] > self.window_s]
        for key in idle:
            del self._hits[key]

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if not request.url.path.startswith(self.prefix):
            return await call_next(request)
        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        if len(self._hits) > MAX_CLIENTS:
            self._forget_idle(now)
        hits = self._hits[client]
        while hits and now - hits[0] > self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            return JSONResponse({"detail": "Previše zahtjeva. Pokušajte malo kasnije."}, 429)
        hits.append(now)
        return await call_next(request)

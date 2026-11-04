"""HTTP fetching for ingest jobs: User-Agent from .env, 10 s timeout, max 3 retries with backoff."""

import logging
import time
from pathlib import Path

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


class FetchError(RuntimeError):
    pass


def http_client(timeout: float | None = None) -> httpx.Client:
    """A client that keeps cookies and the connection (several requests to one site)."""
    settings = get_settings()
    return httpx.Client(
        timeout=timeout if timeout is not None else settings.http_timeout_s,
        follow_redirects=True,
        headers={"User-Agent": settings.http_user_agent},
    )


def fetch_bytes(
    url: str,
    *,
    timeout: float | None = None,
    retries: int | None = None,
    client: httpx.Client | None = None,
    form: dict[str, str] | None = None,
) -> bytes:
    """GET (or POST of `form`) with retries; the client is closed only if created here."""
    retries = retries if retries is not None else get_settings().http_retries
    own = client is None
    client = client or http_client(timeout)
    last_error: Exception | None = None
    try:
        for attempt in range(retries + 1):
            try:
                if form is None:
                    resp = client.get(url, timeout=timeout or client.timeout)
                else:
                    resp = client.post(url, data=form, timeout=timeout or client.timeout)
                resp.raise_for_status()
            except (httpx.HTTPError, OSError) as exc:
                last_error = exc
                if attempt < retries:
                    delay = 2**attempt
                    log.warning("fetch %s failed (%s), retry in %ss", url, exc, delay)
                    time.sleep(delay)
            else:
                return resp.content
    finally:
        if own:
            client.close()
    raise FetchError(f"{url}: {last_error}")


def fetch_to_file(
    url: str,
    dest: Path,
    *,
    refresh: bool = False,
    timeout: float | None = None,
    client: httpx.Client | None = None,
) -> Path:
    """Download into the raw cache; without `refresh` an existing file is kept (seed files)."""
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = fetch_bytes(url, timeout=timeout, client=client)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return dest

# Backend (FastAPI + scheduler). Build context: repository root.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1 PYTHONUNBUFFERED=1

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/snapshot ./snapshot

# SQLite database and downloaded source files live in a volume.
VOLUME /app/backend/data
ENV PATH="/app/backend/.venv/bin:$PATH" \
    DATABASE_URL=sqlite:////app/backend/data/uputko.db
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
# On first start with an empty database the app restores the snapshot, else seeds itself in the
# background (AUTO_SEED).
# No access log: it would keep client addresses and query strings (privacy).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]

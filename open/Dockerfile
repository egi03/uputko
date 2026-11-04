# Open profile bot (Pipecat, Groq, speech synthesis on CPU). Build context: repository root.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1 PYTHONUNBUFFERED=1

WORKDIR /app/open
COPY open/pyproject.toml open/uv.lock ./
# The tts group brings coqui-tts and piper-tts with CPU-only torch.
RUN uv sync --frozen --no-dev --group tts --no-install-project

COPY open/bot ./bot
COPY open/client ./client
COPY agent /app/agent

ENV PATH="/app/open/.venv/bin:$PATH" AGENT_DIR=/app/agent COQUI_TOS_AGREED=1
EXPOSE 7860
# The first start downloads the voice before the server listens.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m CMD ["python", "-c", \
  "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('OPEN_PORT', '7860') + '/health')"]
CMD ["python", "-m", "bot.main"]

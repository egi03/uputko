"""The language model on this machine (OPEN_MODE=local), served by Ollama.

Ollama gives a model a 4,096-token context unless told otherwise, and its OpenAI-compatible
endpoint (the one Pipecat uses) ignores a per-request size. Uputko's instructions alone are
about 2,400 tokens, so one answer with data would push them out of the window. At startup the
bot therefore creates its own variant of the chosen model in Ollama: the same weights (nothing
is copied), with a larger context. It also loads it, so the first visitor does not wait.
"""

import httpx
from loguru import logger
from pipecat.services.ollama.llm import OLLamaLLMService

from bot.config import Settings

KEEP_ALIVE = "45m"  # how long Ollama keeps the model in memory after the last question


def variant_name(settings: Settings) -> str:
    """The variant with Uputko's context size: "qwen3:8b" -> "uputko-qwen3-8b"."""
    return "uputko-" + settings.ollama_model.replace(":", "-").replace("/", "-")


def _api(settings: Settings) -> str:
    """The native Ollama API next to the OpenAI-compatible one: http://host:11434/api."""
    return settings.ollama_url.removesuffix("/v1") + "/api"


def prepare(settings: Settings) -> None:
    """Create (or refresh) the variant and load it (blocking: call it in a thread)."""
    api, variant = _api(settings), variant_name(settings)
    with httpx.Client(timeout=600) as client:
        names = {m["name"] for m in client.get(f"{api}/tags").json().get("models", [])}
        base = settings.ollama_model
        if base not in names and f"{base}:latest" not in names:
            raise RuntimeError(f"Ollama has no model {base!r}: run `ollama pull {base}`")
        client.post(
            f"{api}/create",
            json={
                "model": variant,
                "from": base,
                "parameters": {"num_ctx": settings.ollama_ctx},
                "stream": False,
            },
        ).raise_for_status()
        client.post(
            f"{api}/generate",
            json={"model": variant, "keep_alive": KEEP_ALIVE, "stream": False},
        ).raise_for_status()
    logger.info(f"Ollama model {variant} ready ({settings.ollama_ctx} tokens)")


def create_llm(settings: Settings) -> OLLamaLLMService:
    return OLLamaLLMService(
        base_url=settings.ollama_url,
        settings=OLLamaLLMService.Settings(
            model=variant_name(settings),
            temperature=settings.llm_temperature,
            # No visible "thinking" before a spoken answer: it cost about 10x the time in tests.
            extra={"reasoning_effort": "none", "extra_body": {"keep_alive": KEEP_ALIVE}},
        ),
    )

"""Open bot configuration from the environment (and the repository .env in development)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

OPEN_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = OPEN_DIR.parent
# In Docker the agent files are mounted at /app/agent; locally they are in the repository.
AGENT_DIR = Path(os.environ.get("AGENT_DIR", REPO_DIR / "agent"))

load_dotenv(REPO_DIR / ".env")

MODES = {"groq", "local"}


@dataclass(frozen=True)
class Settings:
    # "groq": Whisper and gpt-oss on Groq; "local": Whisper on this machine (faster-whisper)
    # and a language model served by Ollama, so a conversation needs no outside service.
    mode: str
    # Never in a repr: a logged traceback or settings object must not carry the keys.
    groq_api_key: str = field(repr=False)
    tool_secret: str = field(repr=False)
    stt_model: str
    llm_model: str
    tts_model: str
    tools_base_url: str
    public_api_url: str
    port: int
    # The page is opened on this machine (http://localhost:7860); the microphone needs a secure
    # origin anyway. 0.0.0.0 would let anyone on the network start conversations.
    host: str = "127.0.0.1"
    # Optional STUN/TURN URLs (comma separated), used by the bot and the page.
    ice_servers: tuple[str, ...] = ()
    llm_temperature: float = 0.25
    user_speech_timeout_s: float = 1.0  # slightly longer than the default for longer pauses
    max_conversation_s: int = 600
    tool_timeout_s: float = 5.0
    max_sessions: int = 4  # each session runs speech synthesis on this machine's CPU
    local_stt_model: str = "large-v3-turbo"
    local_stt_device: str = "auto"  # "cuda" (NVIDIA), "cpu", or "auto": the GPU when it works
    ollama_model: str = "qwen3:8b"  # with Whisper it fits a 12 GB GPU; qwen3:14b needs ~16 GB
    ollama_url: str = "http://localhost:11434/v1"
    ollama_ctx: int = 12288  # tokens: the instructions take ~2,400, each answer with data more
    # Pipecat logs what the user said ("Transcription: [...]") and the text to speak at DEBUG;
    # logs must hold no transcripts, so DEBUG is only for development.
    log_level: str = "INFO"


def get_settings() -> Settings:
    mode = os.environ.get("OPEN_MODE", "groq").strip().lower()
    if mode not in MODES:
        raise ValueError(f"OPEN_MODE must be one of {sorted(MODES)}, not {mode!r}")
    return Settings(
        mode=mode,
        groq_api_key=os.environ.get("GROQ_API_KEY", ""),
        tool_secret=os.environ.get("TOOL_SECRET", ""),
        stt_model=os.environ.get("OPEN_STT_MODEL", "whisper-large-v3-turbo"),
        llm_model=os.environ.get("OPEN_LLM_MODEL", "openai/gpt-oss-120b"),
        tts_model=os.environ.get("OPEN_TTS_MODEL", "tts_models/hr/cv/vits"),
        tools_base_url=os.environ.get("TOOLS_BASE_URL", "http://localhost:8000").rstrip("/"),
        public_api_url=os.environ.get("OPEN_PUBLIC_API_URL", "http://localhost:8000").rstrip("/"),
        port=int(os.environ.get("OPEN_PORT", "7860")),
        host=os.environ.get("OPEN_HOST", "127.0.0.1"),
        user_speech_timeout_s=float(os.environ.get("OPEN_USER_SPEECH_TIMEOUT", "1.0")),
        ice_servers=tuple(
            u.strip() for u in os.environ.get("OPEN_ICE_SERVERS", "").split(",") if u.strip()
        ),
        max_sessions=int(os.environ.get("OPEN_MAX_SESSIONS", "4")),
        local_stt_model=os.environ.get("OPEN_LOCAL_STT_MODEL", "large-v3-turbo"),
        local_stt_device=os.environ.get("OPEN_LOCAL_STT_DEVICE", "auto"),
        ollama_model=os.environ.get("OPEN_OLLAMA_MODEL", "qwen3:8b"),
        ollama_url=os.environ.get("OPEN_OLLAMA_URL", "http://localhost:11434/v1").rstrip("/"),
        ollama_ctx=int(os.environ.get("OPEN_OLLAMA_CTX", "12288")),
        log_level=os.environ.get("OPEN_LOG_LEVEL", "INFO").strip().upper() or "INFO",
    )


def first_message() -> str:
    """The greeting both profiles use (agent/first_message.txt)."""
    return (AGENT_DIR / "first_message.txt").read_text(encoding="utf-8").strip()


def system_prompt() -> str:
    """agent/system_prompt.md + agent/system_prompt_open.md; location is always unknown."""
    base = (AGENT_DIR / "system_prompt.md").read_text(encoding="utf-8")
    extra = (AGENT_DIR / "system_prompt_open.md").read_text(encoding="utf-8")
    return f"{base}\n\n{extra}".replace("{{user_location}}", "nepoznato")

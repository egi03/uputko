from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    tool_secret: str = ""
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'uputko.db').as_posix()}"
    http_user_agent: str = "Uputko/0.3 (+https://github.com/egi03/uputko)"
    timezone: str = "Europe/Zagreb"
    log_level: str = "INFO"
    frontend_origin: str = "http://localhost:5173"
    open_origin: str = "http://localhost:7860"

    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""

    data_dir: Path = BACKEND_DIR / "data"
    # Restored into an empty database on first start (app.jobs.snapshot).
    snapshot_path: Path = BACKEND_DIR / "snapshot" / "uputko.db.gz"

    http_timeout_s: float = 10.0
    http_retries: int = 3
    scheduler_enabled: bool = True
    auto_seed: bool = True
    rate_limit_per_minute: int = 120
    # false where HALMED does not serve the server (cloud addresses time out): its database is
    # then uploaded from a computer it serves (scripts/push_halmed.py); the lists still refresh.
    halmed_download: bool = True

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"


@lru_cache
def get_settings() -> Settings:
    return Settings()

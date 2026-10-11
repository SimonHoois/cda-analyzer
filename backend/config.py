"""Runtime configuration, read from environment variables (see README / render.yaml)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# Where uploads and history live. On Render, point this at a persistent disk
# (for example /var/data). Without a disk it is wiped on every restart.
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data")).resolve()

# Optional HTTP Basic password. When set, the whole app (UI and API) is private
# and all devices that know the password share one workspace (files + history).
APP_USER = os.getenv("APP_USER", "cda")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 25)
MAX_FILES_PER_OWNER = _int("MAX_FILES_PER_OWNER", 40)
RETENTION_DAYS = _int("RETENTION_DAYS", 30)       # uploaded .fit files are deleted after this
MAX_CACHED_ANALYZERS = _int("MAX_CACHED_ANALYZERS", 12)

# Built frontend (Vite output). The Dockerfile copies it to ./static.
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", BASE_DIR / "static")).resolve()

# Extra allowed origins for local development only (same-origin in production).
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

VERSION = "3.0.0"

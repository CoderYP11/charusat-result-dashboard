import os
import sys
from pathlib import Path

from dotenv import load_dotenv


# Load environment variables from the dashboard backend .env
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is missing: {name}")
    return value


# ---------------------------------------------------------------------------
# Core Result Tracker repository
# ---------------------------------------------------------------------------

_repo_root_raw = _require_env("RESULT_TRACKER_REPO_ROOT")
REPO_ROOT = Path(_repo_root_raw).expanduser().resolve()

if not REPO_ROOT.is_dir():
    raise RuntimeError(
        f"RESULT_TRACKER_REPO_ROOT does not exist or is not a directory: "
        f"{REPO_ROOT}"
    )

_required_repo_files = (
    "database.py",
    "crawl_results.py",
    "crawler_service.py",
)

_missing_repo_files = [
    filename
    for filename in _required_repo_files
    if not (REPO_ROOT / filename).is_file()
]

if _missing_repo_files:
    raise RuntimeError(
        "RESULT_TRACKER_REPO_ROOT does not appear to be the core "
        "CHARUSAT Result Tracker repository. Missing: "
        + ", ".join(_missing_repo_files)
    )

# Make the CORE repository available for imports.
# Insert at position 0 so `import database` resolves to the core
# repository's database.py, not dashboard/backend/database.py.
repo_root_str = str(REPO_ROOT)

if repo_root_str in sys.path:
    sys.path.remove(repo_root_str)

sys.path.insert(0, repo_root_str)


# ---------------------------------------------------------------------------
# Dashboard authentication
# ---------------------------------------------------------------------------

JWT_SECRET_KEY = _require_env("JWT_SECRET_KEY")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256").strip() or "HS256"

try:
    JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
except ValueError as exc:
    raise RuntimeError("JWT_EXPIRE_MINUTES must be an integer") from exc

if JWT_EXPIRE_MINUTES <= 0:
    raise RuntimeError("JWT_EXPIRE_MINUTES must be greater than 0")


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

_cors_raw = os.getenv("CORS_ORIGINS", "").strip()

CORS_ORIGINS = [
    origin.strip()
    for origin in _cors_raw.split(",")
    if origin.strip()
]


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

BOT_TOKEN_CONFIGURED = bool(os.getenv("BOT_TOKEN", "").strip())
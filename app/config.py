import logging
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5432/deanery")
SESSION_TTL = int(os.getenv("SESSION_TTL_HOURS", "12")) * 3600
TRUSTED_HOSTS = [h.strip() for h in os.getenv("TRUSTED_HOSTS", "127.0.0.1,localhost").split(",") if h.strip()]
COOKIE_SECURE = os.getenv("COOKIE_SECURE") == "1"

SESSION_SECRET = os.getenv("SESSION_SECRET", "")
if not SESSION_SECRET:
    SESSION_SECRET = secrets.token_hex(32)
    logging.getLogger("deanery").warning(
        "SESSION_SECRET не задан: создан временный ключ, после перезапуска сессии сбросятся")

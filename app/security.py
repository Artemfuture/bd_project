"""Пароли (scrypt) и подписанные токены сессии (HMAC-SHA256), только стандартная библиотека."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

from . import config

_N, _R, _P = 2 ** 14, 8, 1


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"scrypt${salt.hex()}${_scrypt(password, salt).hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        return hmac.compare_digest(_scrypt(password, bytes.fromhex(salt_hex)), bytes.fromhex(hash_hex))
    except ValueError:
        return False


DUMMY_HASH = hash_password("dummy")  # чтобы время ответа не выдавало существование логина


def _sign(payload: str) -> str:
    return hmac.new(config.SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(account_id: int, ttl: int | None = None) -> str:
    exp = int(time.time()) + (config.SESSION_TTL if ttl is None else ttl)
    payload = f"{account_id}.{exp}"
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=") + "." + _sign(payload)


def parse_token(token: str | None) -> int | None:
    """Возвращает account_id или None, если токен подделан или просрочен."""
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    try:
        payload = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode()
        account_id, exp = payload.split(".")
        if not hmac.compare_digest(sig, _sign(payload)) or int(exp) < time.time():
            return None
        return int(account_id)
    except (ValueError, UnicodeDecodeError):
        return None

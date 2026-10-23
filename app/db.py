"""Пул соединений PostgreSQL и транзакция на один запрос."""
from __future__ import annotations

import logging

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from . import config

log = logging.getLogger("deanery")
_pool: ConnectionPool | None = None


def open_pool() -> None:
    global _pool
    _pool = ConnectionPool(config.DATABASE_URL, min_size=1, max_size=8, open=False,
                           kwargs={"row_factory": dict_row})
    try:
        _pool.open(wait=True, timeout=10)
    except PoolTimeout:
        _pool.close()
        _pool = None
        raise RuntimeError(
            "Не удалось подключиться к PostgreSQL. Проверьте DATABASE_URL в файле .env "
            "(хост, порт, пользователь, пароль, имя базы deanery).") from None


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_conn():
    """Зависимость FastAPI: одно соединение и одна транзакция на запрос.
    Успех — commit, любое исключение — rollback (в БД не остаётся половины записи)."""
    assert _pool is not None, "пул соединений не открыт"
    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)

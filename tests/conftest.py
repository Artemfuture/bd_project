"""Фикстуры тестов. Нужен запущенный PostgreSQL: тесты сами создают отдельную базу deanery_test
из db/deanery.sql (рабочая база deanery не затрагивается)."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from dotenv import load_dotenv
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")


def _swap_db(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path="/" + name))


TEST_URL = os.getenv("TEST_DATABASE_URL") or _swap_db(
    os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5432/deanery"), "deanery_test")
os.environ["DATABASE_URL"] = TEST_URL  # приложение в тестах работает с тестовой базой
os.environ["TRUSTED_HOSTS"] = "testserver,127.0.0.1,localhost"
os.environ["SESSION_SECRET"] = "test-secret"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from scripts.seed_demo import DEMO_PASSWORD, seed_accounts  # noqa: E402
from app.security import hash_password  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    admin = psycopg.connect(_swap_db(TEST_URL, "postgres"), autocommit=True)
    name = urlsplit(TEST_URL).path.lstrip("/")
    admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    admin.execute(f'CREATE DATABASE "{name}" TEMPLATE template0 ENCODING \'UTF8\'')
    admin.close()
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        conn.execute((ROOT / "db" / "deanery.sql").read_text(encoding="utf-8"))
    with psycopg.connect(TEST_URL, row_factory=dict_row) as conn:
        seed_accounts(conn)  # ivanov (студент), petrova (сотрудник деканата), petrov (преподаватель)
    yield


@pytest.fixture(scope="session")
def server(database):
    with TestClient(app) as c:  # открывает пул соединений через lifespan
        yield c


@pytest.fixture()
def db(database):
    with psycopg.connect(TEST_URL, autocommit=True, row_factory=dict_row) as conn:
        yield conn


@pytest.fixture(autouse=True)
def clean(db):
    """После каждого теста удаляем созданное им, база возвращается к исходному дампу."""
    mx = lambda t, c: db.execute(f"SELECT COALESCE(max({c}), 0) AS m FROM {t}").fetchone()["m"]
    mark = {"a": mx("achievement", "achievement_id"), "p": mx("publication", "publication_id"),
            "s": mx("student", "student_id")}
    yield
    db.execute("DELETE FROM achievement WHERE achievement_id > %s", (mark["a"],))
    db.execute("DELETE FROM publication WHERE publication_id > %s", (mark["p"],))
    db.execute("DELETE FROM student WHERE student_id > %s", (mark["s"],))
    db.execute("UPDATE student SET status = 'studying' WHERE student_id = 1")


def make_client(login: str, password: str = DEMO_PASSWORD) -> TestClient:
    c = TestClient(app)
    r = c.post("/api/login", json={"username": login, "password": password})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture()
def student(server):
    return make_client("ivanov")


@pytest.fixture()
def staff(server):
    return make_client("petrova")


@pytest.fixture()
def lecturer(server):
    return make_client("petrov")


@pytest.fixture()
def second_student(server, db):
    """Другой студент той же группы (чужие данные) со своей учётной записью."""
    sid = db.execute("""INSERT INTO student (record_book_no, full_name, birth_date, group_id)
                        VALUES ('T-002', 'Test Second Student', '2006-01-01', 1) RETURNING student_id""").fetchone()["student_id"]
    db.execute("INSERT INTO user_account (login, password_hash, student_id) VALUES ('tester2', %s, %s)",
               (hash_password(DEMO_PASSWORD), sid))
    return make_client("tester2")


@pytest.fixture()
def expelled_student(server, db):
    sid = db.execute("""INSERT INTO student (record_book_no, full_name, birth_date, status, group_id)
                        VALUES ('T-003', 'Test Expelled Student', '2005-01-01', 'expelled', 1)
                        RETURNING student_id""").fetchone()["student_id"]
    db.execute("INSERT INTO user_account (login, password_hash, student_id) VALUES ('expelled1', %s, %s)",
               (hash_password(DEMO_PASSWORD), sid))
    return make_client("expelled1")


DOC = {"doc_type": "diploma", "file_ref": "/documents/test.pdf"}


def participation(**over):
    """Участие: событие 2 (вузовский уровень), роль «докладчик» (2) → по правилу 10 баллов за 1 место.
    (В дампе Иванов уже участвует в событии 1, поэтому берём событие 2.)"""
    body = {"kind": "participation", "title": "1st place at the conference", "achieved_on": "2026-10-01",
            "category_id": 1, "event_id": 2, "role_id": 2, "result": "1st place", "submit": True, "document": DOC}
    body.update(over)
    return body

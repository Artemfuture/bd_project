from fastapi.testclient import TestClient

from app.main import app
from app.security import make_token, parse_token

from .conftest import make_client


def test_login_ok_and_cookie_flags(server):
    c = TestClient(app)
    r = c.post("/api/login", json={"username": "ivanov", "password": "demo1234"})
    assert r.status_code == 200
    assert r.json()["role"] == "student"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert c.get("/api/me").json()["login"] == "ivanov"


def test_login_is_case_insensitive(server):
    assert TestClient(app).post("/api/login", json={"username": "  IVANOV ", "password": "demo1234"}).status_code == 200


def test_wrong_password_and_unknown_user_look_the_same(server):
    c = TestClient(app)
    a = c.post("/api/login", json={"username": "ivanov", "password": "nope"})
    b = c.post("/api/login", json={"username": "nobody", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_protected_routes_need_login(server):
    c = TestClient(app)
    assert c.get("/api/me").status_code == 401
    assert c.get("/api/modules").status_code == 401
    assert c.get("/api/rating").status_code == 401
    assert c.get("/api/session").json() == {"logged_in": False}


def test_tampered_and_expired_tokens_rejected(server):
    token = make_token(1)
    assert parse_token(token) == 1
    assert parse_token(token[:-2] + "00") is None
    assert parse_token(make_token(1, ttl=-10)) is None
    c = TestClient(app)
    c.cookies.set("deanery_sid", token[:-2] + "00")
    assert c.get("/api/me").status_code == 401


def test_logout(server):
    c = make_client("ivanov")
    assert c.post("/api/logout").status_code == 200
    c.cookies.clear()
    assert c.get("/api/me").status_code == 401


def test_modules_depend_on_role(student, staff, lecturer):
    ids = lambda c: {m["id"] for m in c.get("/api/modules").json()}
    assert "achievements" in ids(student) and "review" not in ids(student)
    assert "review" in ids(staff) and "achievements" not in ids(staff)
    assert "review" in ids(lecturer)


def test_foreign_origin_is_blocked(student):
    r = student.post("/api/logout", headers={"Origin": "http://evil.example"})
    assert r.status_code == 403

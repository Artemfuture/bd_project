from .conftest import participation


def test_rating_table_and_me(student, staff):
    meta = student.get("/api/rating/meta").json()
    assert meta["periods"] and meta["default_period_id"]
    rows = student.get("/api/rating", params={"period_id": 1}).json()["rows"]
    assert any(r["student_name"] == "Ivanov Ivan Ivanovich" for r in rows)
    me = student.get("/api/rating/me", params={"period_id": 1}).json()
    assert float(me["total_points"]) == 25 and me["rank_in_group"] == 1


def test_new_student_with_no_rating_gets_zero(second_student):
    me = second_student.get("/api/rating/me", params={"period_id": 1}).json()
    assert float(me["total_points"]) == 0 and me["rank_in_group"] is None


def test_recalculate_is_staff_only(student, staff, lecturer):
    assert student.post("/api/rating/recalculate", params={"period_id": 1}).status_code == 403
    assert lecturer.post("/api/rating/recalculate", params={"period_id": 1}).status_code == 403
    assert staff.post("/api/rating/recalculate", params={"period_id": 1}).status_code == 200


def test_ranks_follow_points(student, staff, second_student):
    aid = second_student.post("/api/achievements", json=participation()).json()["achievement_id"]
    staff.post(f"/api/review/{aid}/confirm")
    rows = {r["student_name"]: r for r in student.get("/api/rating", params={"period_id": 1}).json()["rows"]}
    assert rows["Ivanov Ivan Ivanovich"]["rank_in_group"] == 1  # 25 против 10
    assert rows["Test Second Student"]["rank_in_group"] == 2


def test_events_and_rules(student, staff):
    events = student.get("/api/events").json()
    assert {e["title"] for e in events} >= {"Student Scientific Conference", "Information Technology Section"}
    child = next(e for e in events if e["title"] == "Information Technology Section")
    assert child["parent_title"] == "Student Scientific Conference"
    assert student.get("/api/events", params={"type_id": 999}).json() == []
    assert student.get("/api/events/upcoming", params={"days": 30}).status_code == 200
    rules = staff.get("/api/rules").json()
    assert len(rules) >= 2 and all("points" in r for r in rules)


def test_home_summary_by_role(student, staff):
    s = student.get("/api/home/summary").json()
    assert s["role"] == "student" and s["counts"].get("confirmed", 0) >= 2 and "rating" in s
    h = staff.get("/api/home/summary").json()
    assert h["role"] == "staff" and "queue" in h


def test_search_scoped_by_role(student, staff):
    assert student.get("/api/search", params={"q": "Publication"}).json()["achievements"]
    assert student.get("/api/search", params={"q": "Ivanov"}).json()["students"] == []  # студент студентов не ищет
    assert staff.get("/api/search", params={"q": "Ivanov"}).json()["students"]
    assert student.get("/api/search", params={"q": "a"}).json() == {"achievements": [], "events": [], "students": []}

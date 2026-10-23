from .conftest import participation


def submitted(student, **over):
    return student.post("/api/achievements", json=participation(**over)).json()["achievement_id"]


def test_confirm_gives_points_by_rule_and_updates_rating(student, staff):
    before = student.get("/api/rating/me").json()["total_points"]
    aid = submitted(student)  # событие 1 (вузовский), докладчик, 1 место → правило: 10 баллов
    r = staff.post(f"/api/review/{aid}/confirm")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "confirmed" and float(d["points"]) == 10 and d["reviewer_name"] and d["rule_id"]
    assert float(student.get("/api/rating/me").json()["total_points"]) == float(before) + 10


def test_confirm_requires_document(staff, db, student):
    aid = student.post("/api/achievements", json=participation(submit=False, document=None)).json()["achievement_id"]
    db.execute("UPDATE achievement SET status = 'under review' WHERE achievement_id = %s", (aid,))
    r = staff.post(f"/api/review/{aid}/confirm")
    assert r.status_code == 400 and "supporting document" in r.json()["detail"]
    assert staff.get(f"/api/achievements/{aid}").json()["status"] == "under review"


def test_confirm_twice_fails(student, staff):
    aid = submitted(student)
    assert staff.post(f"/api/review/{aid}/confirm").status_code == 200
    assert staff.post(f"/api/review/{aid}/confirm").status_code == 400


def test_no_matching_rule_means_error_and_no_change(student, staff):
    aid = submitted(student, category_id=3, result="no place", title="no rule for this")  # у «спортивной» нет правила в дампе
    r = staff.post(f"/api/review/{aid}/confirm")
    assert r.status_code == 400 and "rule" in r.json()["detail"]
    assert staff.get(f"/api/achievements/{aid}").json()["status"] == "under review"


def test_only_staff_can_confirm_or_reject(student, lecturer, second_student):
    aid = submitted(student)
    for c in (student, lecturer, second_student):
        assert c.post(f"/api/review/{aid}/confirm").status_code == 403
        assert c.post(f"/api/review/{aid}/reject", json={"comment": "x"}).status_code == 403


def test_reject_requires_comment_and_student_sees_it(student, staff):
    aid = submitted(student)
    assert staff.post(f"/api/review/{aid}/reject", json={"comment": ""}).status_code == 422
    assert staff.post(f"/api/review/{aid}/reject", json={"comment": "   "}).status_code == 400
    r = staff.post(f"/api/review/{aid}/reject", json={"comment": "Diploma is unreadable"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    mine = student.get(f"/api/achievements/{aid}").json()
    assert mine["reviewer_comment"] == "Diploma is unreadable" and mine["points"] is None


def test_review_list_filters_and_roles(student, staff, lecturer):
    aid = submitted(student, title="Findable title xyz")
    rows = staff.get("/api/review/list", params={"status": "under review", "q": "findable title xyz"}).json()
    assert [r["achievement_id"] for r in rows] == [aid]
    assert lecturer.get("/api/review/list").status_code == 200
    assert student.get("/api/review/list").status_code == 403
    assert staff.get("/api/review/counts").json()["under review"] >= 1


def test_confirm_unknown_id_is_404(staff):
    assert staff.post("/api/review/999999/confirm").status_code == 404

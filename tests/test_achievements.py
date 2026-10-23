from .conftest import DOC, participation


def test_create_submitted_participation(student):
    r = student.post("/api/achievements", json=participation())
    assert r.status_code == 201, r.text
    aid = r.json()["achievement_id"]
    d = student.get(f"/api/achievements/{aid}").json()
    assert d["status"] == "under review"
    assert d["details"]["event_title"] and d["details"]["result"] == "1st place"
    assert len(d["documents"]) == 1
    assert any(a["achievement_id"] == aid for a in student.get("/api/achievements/mine").json())


def test_draft_attach_document_then_submit(student):
    aid = student.post("/api/achievements", json=participation(submit=False, document=None)).json()["achievement_id"]
    assert student.get(f"/api/achievements/{aid}").json()["status"] == "draft"
    assert student.post(f"/api/achievements/{aid}/submit").status_code == 400  # без документа нельзя
    assert student.post(f"/api/achievements/{aid}/documents", json={"document": DOC}).status_code == 201
    r = student.post(f"/api/achievements/{aid}/submit")
    assert r.status_code == 200 and r.json()["status"] == "under review"
    assert student.post(f"/api/achievements/{aid}/submit").status_code == 400  # уже отправлено


def test_authorship_with_new_publication(student):
    body = {"kind": "authorship", "title": "My article", "achieved_on": "2026-10-02", "category_id": 1,
            "submit": True, "document": {"doc_type": "publication copy", "file_ref": "/d/a.pdf"},
            "publication": {"title": "A study of indexes", "published_on": "2026-10-02", "source_id": 1,
                            "doi": "10.9999/test.1", "supervisor_id": 1}, "author_order": 1}
    r = student.post("/api/achievements", json=body)
    assert r.status_code == 201, r.text
    d = student.get(f"/api/achievements/{r.json()['achievement_id']}").json()
    assert d["details"]["publication_title"] == "A study of indexes" and d["details"]["supervisor"]


def membership_body(org_id, joined="2026-10-03"):
    return {"kind": "membership", "title": "Science society", "achieved_on": joined, "category_id": 4,
            "organization_id": org_id, "position": "member", "joined_on": joined, "submit": True, "document": DOC}


def test_membership(student, db):
    org = db.execute("INSERT INTO organization (name, org_type) VALUES ('Test Club', 'club') "
                     "RETURNING organization_id").fetchone()["organization_id"]
    try:
        assert student.post("/api/achievements", json=membership_body(org)).status_code == 201
    finally:
        db.execute("DELETE FROM achievement WHERE achievement_id > 3")
        db.execute("DELETE FROM organization WHERE organization_id = %s", (org,))


def test_overlapping_membership_is_conflict(student):
    """У Иванова в дампе уже есть бессрочное членство в организации 1: пересечение запрещает БД."""
    r = student.post("/api/achievements", json=membership_body(1))
    assert r.status_code == 409 and "пересека" in r.json()["detail"]


def test_failed_create_leaves_nothing_behind(student, db):
    """Научный руководитель не преподаватель → триггер БД отказывает, откатывается вся запись целиком."""
    before = db.execute("SELECT count(*) AS n FROM achievement").fetchone()["n"]
    body = {"kind": "authorship", "title": "Bad supervisor", "achieved_on": "2026-10-02", "category_id": 1,
            "submit": True, "document": DOC,
            "publication": {"title": "Should not exist", "published_on": "2026-10-02", "source_id": 1, "supervisor_id": 2}}
    r = student.post("/api/achievements", json=body)
    assert r.status_code == 400 and "lecturer" in r.json()["detail"]
    assert db.execute("SELECT count(*) AS n FROM achievement").fetchone()["n"] == before
    assert db.execute("SELECT count(*) AS n FROM publication WHERE title = 'Should not exist'").fetchone()["n"] == 0


def test_validation_errors(student):
    assert student.post("/api/achievements", json=participation(event_id=None)).status_code == 422
    assert student.post("/api/achievements", json=participation(document=None)).status_code == 422
    assert student.post("/api/achievements", json=participation(title="   ")).status_code == 422
    assert student.post("/api/achievements", json={"kind": "bad"}).status_code == 422


def test_date_outside_any_period(student):
    r = student.post("/api/achievements", json=participation(achieved_on="2001-01-01"))
    assert r.status_code == 400 and "период" in r.json()["detail"]


def test_future_date_is_rejected(student):
    r = student.post("/api/achievements", json=participation(achieved_on="2999-01-01"))
    assert r.status_code == 422 and "в будущем" in r.text


def test_duplicate_participation_is_conflict(student):
    assert student.post("/api/achievements", json=participation()).status_code == 201
    r = student.post("/api/achievements", json=participation(title="same again"))
    assert r.status_code == 409


def test_other_student_cannot_see_or_change(student, second_student):
    aid = student.post("/api/achievements", json=participation(submit=False)).json()["achievement_id"]
    assert second_student.get(f"/api/achievements/{aid}").status_code == 404
    assert second_student.post(f"/api/achievements/{aid}/submit").status_code == 404
    assert second_student.delete(f"/api/achievements/{aid}").status_code == 404
    assert all(a["achievement_id"] != aid for a in second_student.get("/api/achievements/mine").json())


def test_drafts_are_private_from_staff(student, staff, lecturer):
    aid = student.post("/api/achievements", json=participation(submit=False)).json()["achievement_id"]
    assert staff.get(f"/api/achievements/{aid}").status_code == 404
    assert lecturer.get(f"/api/achievements/{aid}").status_code == 404
    assert all(a["achievement_id"] != aid for a in staff.get("/api/review/list").json())
    student.post(f"/api/achievements/{aid}/documents", json={"document": DOC})
    student.post(f"/api/achievements/{aid}/submit")
    assert staff.get(f"/api/achievements/{aid}").status_code == 200


def test_delete_only_drafts(student):
    draft = student.post("/api/achievements", json=participation(submit=False)).json()["achievement_id"]
    sent = student.post("/api/achievements", json=participation(event_id=1, role_id=1, title="other")).json()["achievement_id"]
    assert student.delete(f"/api/achievements/{draft}").status_code == 200
    assert student.get(f"/api/achievements/{draft}").status_code == 404
    assert student.delete(f"/api/achievements/{sent}").status_code == 400


def test_expelled_student_cannot_add(expelled_student):
    r = expelled_student.post("/api/achievements", json=participation())
    assert r.status_code == 400 and "expelled" in r.json()["detail"]


def test_staff_cannot_create(staff):
    assert staff.post("/api/achievements", json=participation()).status_code == 403

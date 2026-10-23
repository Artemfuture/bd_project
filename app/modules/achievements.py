"""Достижения студента: создание, просмотр, отправка на проверку.

Модуль в меню только у студента, но маршруты /{id} открыты и сотрудникам (без черновиков):
доступ проверяется в каждом маршруте."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator

from ..db import get_conn
from ..deps import current_user, require_roles
from ..enums import DOC_TYPES, KINDS, RESULTS, STATUSES

META = {"id": "achievements", "title": "Мои достижения", "script": "/static/modules/achievements.js",
        "order": 2, "roles": ["student"]}
router = APIRouter()

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]

BASE_SQL = """
SELECT a.achievement_id, a.kind, a.title, a.achieved_on, a.status, a.points, a.verified_at, a.reviewer_comment,
       a.category_id, c.name AS category, a.period_id, p.academic_year, p.semester,
       a.student_id, s.full_name AS student_name, s.record_book_no, g.code AS group_name,
       a.verified_by, rv.full_name AS reviewer_name, a.rule_id
FROM achievement a
JOIN achievement_category c ON c.category_id = a.category_id
JOIN academic_period p ON p.period_id = a.period_id
JOIN student s ON s.student_id = a.student_id
JOIN study_group g ON g.group_id = s.group_id
LEFT JOIN employee rv ON rv.employee_id = a.verified_by
"""


# ---------------------------------------------------------------- схемы запроса
class DocumentIn(BaseModel):
    doc_type: Literal["diploma", "certificate", "certificate of honor", "statement",
                      "publication copy", "order", "other"]
    file_ref: str = Field(min_length=1, max_length=500)
    doc_number: Optional[str] = Field(default=None, max_length=50)
    issued_on: Optional[date] = None


class NewPublicationIn(BaseModel):
    title: Title
    published_on: date
    source_id: int
    doi: Optional[str] = Field(default=None, max_length=100)
    pages: Optional[str] = Field(default=None, max_length=20)
    supervisor_id: Optional[int] = None


class AchievementIn(BaseModel):
    kind: Literal["participation", "authorship", "membership"]
    title: Title
    achieved_on: date
    category_id: int
    submit: bool = False
    document: Optional[DocumentIn] = None
    # участие
    event_id: Optional[int] = None
    role_id: Optional[int] = None
    result: Optional[Literal["no place", "3rd place", "2nd place", "1st place", "grand prix"]] = None
    # публикация
    publication_id: Optional[int] = None
    publication: Optional[NewPublicationIn] = None
    author_order: int = Field(default=1, ge=1)
    # членство
    organization_id: Optional[int] = None
    position: str = Field(default="participant", min_length=1, max_length=100)
    joined_on: Optional[date] = None
    left_on: Optional[date] = None

    @model_validator(mode="after")
    def check_kind_fields(self):
        if self.achieved_on > date.today():
            raise ValueError("Дата достижения не может быть в будущем")
        if self.kind == "participation" and None in (self.event_id, self.role_id, self.result):
            raise ValueError("Для участия укажите мероприятие, роль и результат")
        if self.kind == "authorship" and (self.publication_id is None) == (self.publication is None):
            raise ValueError("Выберите существующую публикацию или заполните новую (что-то одно)")
        if self.kind == "membership" and (self.organization_id is None or self.joined_on is None):
            raise ValueError("Для членства укажите организацию и дату вступления")
        if self.submit and self.document is None:
            raise ValueError("Чтобы отправить на проверку, приложите подтверждающий документ")
        return self


class DocumentOnly(BaseModel):
    document: DocumentIn


# ---------------------------------------------------------------- чтение
def fetch_one(conn, achievement_id: int) -> dict | None:
    return conn.execute(BASE_SQL + " WHERE a.achievement_id = %s", (achievement_id,)).fetchone()


def can_view(user: dict, row: dict) -> bool:
    if user["role"] == "student":
        return row["student_id"] == user["student_id"]
    return row["status"] != "draft"  # черновики видны только автору


def details(conn, row: dict) -> dict:
    aid = row["achievement_id"]
    if row["kind"] == "participation":
        d = conn.execute("""
            SELECT ev.event_id, ev.title AS event_title, ev.start_date, ev.end_date, ev.place,
                   et.name AS event_type, lv.name AS level, pr.name AS role, ae.result
            FROM achievement_event ae
            JOIN event ev ON ev.event_id = ae.event_id
            JOIN event_type et ON et.event_type_id = ev.event_type_id
            JOIN significance_level lv ON lv.level_id = ev.level_id
            JOIN participation_role pr ON pr.role_id = ae.role_id
            WHERE ae.achievement_id = %s""", (aid,)).fetchone()
    elif row["kind"] == "authorship":
        d = conn.execute("""
            SELECT pb.publication_id, pb.title AS publication_title, pb.published_on, pb.doi, pb.pages,
                   ps.name AS source, ps.source_type, lv.name AS level, au.author_order,
                   sv.full_name AS supervisor
            FROM achievement_authorship au
            JOIN publication pb ON pb.publication_id = au.publication_id
            JOIN publication_source ps ON ps.source_id = pb.source_id
            JOIN significance_level lv ON lv.level_id = ps.level_id
            LEFT JOIN employee sv ON sv.employee_id = pb.supervisor_id
            WHERE au.achievement_id = %s""", (aid,)).fetchone()
    else:
        d = conn.execute("""
            SELECT og.organization_id, og.name AS organization, og.org_type, am.position, am.joined_on, am.left_on
            FROM achievement_membership am
            JOIN organization og ON og.organization_id = am.organization_id
            WHERE am.achievement_id = %s""", (aid,)).fetchone()
    return d or {}


def documents(conn, achievement_id: int) -> list[dict]:
    return conn.execute("""SELECT document_id, doc_type, doc_number, issued_on, file_ref, uploaded_at
                           FROM supporting_document WHERE achievement_id = %s ORDER BY document_id""",
                        (achievement_id,)).fetchall()


def full_detail(conn, row: dict) -> dict:
    return {**row, "details": details(conn, row), "documents": documents(conn, row["achievement_id"])}


# ---------------------------------------------------------------- маршруты
@router.get("/reference")
def reference(user: dict = Depends(require_roles("student")), conn=Depends(get_conn)):
    q = lambda sql: conn.execute(sql).fetchall()
    return {
        "categories": q("SELECT category_id, name, description FROM achievement_category ORDER BY category_id"),
        "events": q("""SELECT e.event_id, e.title, e.start_date, et.name AS event_type, lv.name AS level,
                              p.title AS parent_title
                       FROM event e JOIN event_type et USING (event_type_id)
                       JOIN significance_level lv USING (level_id)
                       LEFT JOIN event p ON p.event_id = e.parent_event_id
                       ORDER BY e.start_date DESC, e.event_id"""),
        "roles": q("SELECT role_id, name FROM participation_role ORDER BY role_id"),
        "organizations": q("SELECT organization_id, name, org_type FROM organization WHERE is_active ORDER BY name"),
        "publications": q("""SELECT pb.publication_id, pb.title, pb.published_on, ps.name AS source
                             FROM publication pb JOIN publication_source ps USING (source_id)
                             ORDER BY pb.published_on DESC"""),
        "sources": q("""SELECT ps.source_id, ps.name, ps.source_type, lv.name AS level
                        FROM publication_source ps JOIN significance_level lv USING (level_id) ORDER BY ps.name"""),
        "supervisors": q("SELECT employee_id, full_name FROM employee WHERE role_type = 'lecturer' ORDER BY full_name"),
        "enums": {"kinds": KINDS, "statuses": STATUSES, "doc_types": DOC_TYPES, "results": RESULTS},
    }


@router.get("/mine")
def mine(status: Optional[str] = None, user: dict = Depends(require_roles("student")), conn=Depends(get_conn)):
    sql, args = BASE_SQL + " WHERE a.student_id = %s", [user["student_id"]]
    if status:
        sql += " AND a.status = %s"
        args.append(status)
    return conn.execute(sql + " ORDER BY a.achieved_on DESC, a.achievement_id DESC", args).fetchall()


@router.get("/{achievement_id}")
def one(achievement_id: int, user: dict = Depends(current_user), conn=Depends(get_conn)):
    row = fetch_one(conn, achievement_id)
    if not row or not can_view(user, row):
        raise HTTPException(404, "Достижение не найдено")
    return full_detail(conn, row)


@router.post("", status_code=201)
def create(body: AchievementIn, user: dict = Depends(require_roles("student")), conn=Depends(get_conn)):
    period = conn.execute("SELECT period_id FROM academic_period WHERE %s BETWEEN start_date AND end_date",
                          (body.achieved_on,)).fetchone()
    if not period:
        raise HTTPException(400, "Нет учебного периода, в который попадает дата достижения")
    sid = user["student_id"]
    status = "under review" if body.submit else "draft"
    aid = conn.execute("""
        INSERT INTO achievement (kind, title, achieved_on, status, student_id, category_id, period_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING achievement_id""",
                       (body.kind, body.title.strip(), body.achieved_on, status, sid, body.category_id,
                        period["period_id"])).fetchone()["achievement_id"]
    if body.kind == "participation":
        conn.execute("""INSERT INTO achievement_event (achievement_id, student_id, event_id, role_id, result)
                        VALUES (%s, %s, %s, %s, %s)""", (aid, sid, body.event_id, body.role_id, body.result))
    elif body.kind == "authorship":
        pub_id = body.publication_id
        if body.publication:
            p = body.publication
            pub_id = conn.execute("""
                INSERT INTO publication (title, published_on, doi, pages, source_id, supervisor_id)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING publication_id""",
                                  (p.title.strip(), p.published_on, p.doi or None, p.pages or None,
                                   p.source_id, p.supervisor_id)).fetchone()["publication_id"]
        conn.execute("""INSERT INTO achievement_authorship (achievement_id, student_id, publication_id, author_order)
                        VALUES (%s, %s, %s, %s)""", (aid, sid, pub_id, body.author_order))
    else:
        conn.execute("""INSERT INTO achievement_membership
                          (achievement_id, student_id, organization_id, position, joined_on, left_on)
                        VALUES (%s, %s, %s, %s, %s, %s)""",
                     (aid, sid, body.organization_id, body.position.strip(), body.joined_on, body.left_on))
    if body.document:
        add_document(conn, aid, body.document)
    return {"achievement_id": aid, "status": status}


def add_document(conn, aid: int, d: DocumentIn) -> None:
    conn.execute("""INSERT INTO supporting_document (doc_type, doc_number, issued_on, file_ref, achievement_id)
                    VALUES (%s, %s, %s, %s, %s)""",
                 (d.doc_type, d.doc_number or None, d.issued_on, d.file_ref.strip(), aid))


def own_row(conn, achievement_id: int, user: dict) -> dict:
    row = fetch_one(conn, achievement_id)
    if not row or row["student_id"] != user["student_id"]:
        raise HTTPException(404, "Достижение не найдено")
    return row


@router.post("/{achievement_id}/documents", status_code=201)
def attach_document(achievement_id: int, body: DocumentOnly, user: dict = Depends(require_roles("student")),
                    conn=Depends(get_conn)):
    row = own_row(conn, achievement_id, user)
    if row["status"] != "draft":
        raise HTTPException(400, "Документ можно добавить только к черновику")
    add_document(conn, achievement_id, body.document)
    return {"ok": True}


@router.post("/{achievement_id}/submit")
def submit(achievement_id: int, user: dict = Depends(require_roles("student")), conn=Depends(get_conn)):
    row = own_row(conn, achievement_id, user)
    if row["status"] != "draft":
        raise HTTPException(400, "Отправить на проверку можно только черновик")
    if not documents(conn, achievement_id):
        raise HTTPException(400, "Сначала приложите подтверждающий документ")
    conn.execute("UPDATE achievement SET status = 'under review' WHERE achievement_id = %s", (achievement_id,))
    return {"ok": True, "status": "under review"}


@router.delete("/{achievement_id}")
def delete(achievement_id: int, user: dict = Depends(require_roles("student")), conn=Depends(get_conn)):
    row = own_row(conn, achievement_id, user)
    if row["status"] != "draft":
        raise HTTPException(400, "Удалить можно только черновик")
    conn.execute("DELETE FROM achievement WHERE achievement_id = %s", (achievement_id,))
    return {"ok": True}

"""Поиск по достижениям и мероприятиям (клавиша «/»). Сотрудникам и преподавателям — ещё и по студентам."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import get_conn
from ..deps import current_user
from .achievements import BASE_SQL
from .events import EVENT_SQL

META = {"id": "search", "title": "Поиск", "script": "/static/modules/search.js", "order": 90, "hidden": True}
router = APIRouter()


@router.get("")
def search(q: str = "", user: dict = Depends(current_user), conn=Depends(get_conn)):
    q = q.strip()
    if len(q) < 2:
        return {"achievements": [], "events": [], "students": []}
    like = f"%{q}%"
    if user["role"] == "student":
        achievements = conn.execute(BASE_SQL + " WHERE a.student_id = %s AND a.title ILIKE %s "
                                    "ORDER BY a.achieved_on DESC LIMIT 20", (user["student_id"], like)).fetchall()
        students = []
    else:
        achievements = conn.execute(BASE_SQL + " WHERE a.status <> 'draft' AND (a.title ILIKE %s OR s.full_name ILIKE %s) "
                                    "ORDER BY a.achieved_on DESC LIMIT 20", (like, like)).fetchall()
        students = conn.execute("""SELECT s.student_id, s.full_name, s.record_book_no, g.code AS group_name, s.status
                                   FROM student s JOIN study_group g USING (group_id)
                                   WHERE s.full_name ILIKE %s OR s.record_book_no ILIKE %s
                                   ORDER BY s.full_name LIMIT 20""", (like, like)).fetchall()
    events = conn.execute(EVENT_SQL + " WHERE e.title ILIKE %s ORDER BY e.start_date DESC LIMIT 20", (like,)).fetchall()
    return {"achievements": achievements, "events": events, "students": students}

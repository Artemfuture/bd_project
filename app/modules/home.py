"""Главная: сводка по роли пользователя. Ближайшие мероприятия берутся из модуля events."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import get_conn
from ..deps import current_user
from .achievements import BASE_SQL
from .rating import default_period

META = {"id": "home", "title": "Главная", "script": "/static/modules/home.js", "order": 1}
router = APIRouter()


@router.get("/summary")
def summary(user: dict = Depends(current_user), conn=Depends(get_conn)):
    if user["role"] == "student":
        sid = user["student_id"]
        counts = {r["status"]: r["n"] for r in conn.execute(
            "SELECT status, count(*) AS n FROM achievement WHERE student_id = %s GROUP BY status", (sid,)).fetchall()}
        period_id = default_period(conn)
        rating = conn.execute("""SELECT total_points, rank_in_group, rank_in_direction
                                 FROM student_rating WHERE student_id = %s AND period_id = %s""",
                              (sid, period_id)).fetchone()
        group_size = conn.execute("SELECT count(*) AS n FROM student WHERE group_id = %s AND status <> 'expelled'",
                                  (user["group_id"],)).fetchone()["n"]
        recent = conn.execute(BASE_SQL + " WHERE a.student_id = %s ORDER BY a.achievement_id DESC LIMIT 6",
                              (sid,)).fetchall()
        return {"role": "student", "counts": counts, "recent": recent, "group_size": group_size,
                "rating": rating or {"total_points": 0, "rank_in_group": None, "rank_in_direction": None}}
    counts = {r["status"]: r["n"] for r in conn.execute(
        "SELECT status, count(*) AS n FROM achievement WHERE status <> 'draft' GROUP BY status").fetchall()}
    queue = conn.execute(BASE_SQL + " WHERE a.status = 'under review' ORDER BY a.achievement_id LIMIT 6").fetchall()
    return {"role": user["role"], "counts": counts, "queue": queue}

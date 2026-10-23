"""Рейтинг студентов за учебный период. Баллы и места считает БД (триггеры и функция пересчёта)."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_conn
from ..deps import current_user, require_roles

META = {"id": "rating", "title": "Рейтинг", "script": "/static/modules/rating.js", "order": 3}
router = APIRouter()


def default_period(conn) -> Optional[int]:
    row = conn.execute("SELECT period_id FROM academic_period WHERE %s BETWEEN start_date AND end_date",
                       (date.today(),)).fetchone()
    if not row:
        row = conn.execute("SELECT period_id FROM academic_period ORDER BY start_date DESC LIMIT 1").fetchone()
    return row["period_id"] if row else None


@router.get("/meta")
def meta(user: dict = Depends(current_user), conn=Depends(get_conn)):
    return {
        "periods": conn.execute("""SELECT period_id, academic_year, semester, start_date, end_date
                                   FROM academic_period ORDER BY start_date DESC""").fetchall(),
        "groups": conn.execute("SELECT group_id, code FROM study_group ORDER BY code").fetchall(),
        "default_period_id": default_period(conn),
    }


@router.get("")
def table(period_id: Optional[int] = None, group_id: Optional[int] = None,
          user: dict = Depends(current_user), conn=Depends(get_conn)):
    period_id = period_id or default_period(conn)
    sql = """
        SELECT rt.rating_id, rt.student_id, rt.student_name, rt.record_book_no, rt.group_name, rt.direction_name,
               rt.total_points, rt.rank_in_group, rt.rank_in_direction, rt.calculated_at, s.group_id, s.status AS student_status
        FROM rating_table rt
        JOIN student_rating sr ON sr.rating_id = rt.rating_id
        JOIN student s ON s.student_id = rt.student_id
        WHERE sr.period_id = %s"""
    args = [period_id]
    if group_id:
        sql += " AND s.group_id = %s"
        args.append(group_id)
    sql += " ORDER BY rt.total_points DESC, rt.student_name"
    return {"period_id": period_id, "rows": conn.execute(sql, args).fetchall()}


@router.get("/me")
def mine(period_id: Optional[int] = None, user: dict = Depends(require_roles("student")),
         conn=Depends(get_conn)):
    period_id = period_id or default_period(conn)
    row = conn.execute("""
        SELECT total_points, rank_in_group, rank_in_direction, calculated_at
        FROM student_rating WHERE student_id = %s AND period_id = %s""",
                       (user["student_id"], period_id)).fetchone()
    size = conn.execute("""SELECT count(*) AS n FROM student WHERE group_id = %s AND status <> 'expelled'""",
                        (user["group_id"],)).fetchone()["n"]
    return {"period_id": period_id, "group_size": size,
            "total_points": row["total_points"] if row else 0,
            "rank_in_group": row["rank_in_group"] if row else None,
            "rank_in_direction": row["rank_in_direction"] if row else None}


@router.post("/recalculate")
def recalculate(period_id: Optional[int] = None, user: dict = Depends(require_roles("staff")),
                conn=Depends(get_conn)):
    period_id = period_id or default_period(conn)
    if period_id is None:
        raise HTTPException(400, "Нет учебных периодов")
    conn.execute("SELECT recalculate_period_rating(%s)", (period_id,))
    return {"ok": True, "period_id": period_id}

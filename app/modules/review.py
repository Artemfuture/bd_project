"""Реестр достижений и проверка. Сотрудник деканата подтверждает и отклоняет,
преподаватель только смотрит. Правила (документ, правило начисления, рейтинг) выполняет БД."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_conn
from ..deps import require_roles
from .achievements import BASE_SQL, fetch_one, full_detail

META = {"id": "review", "title": "Проверка", "script": "/static/modules/review.js",
        "order": 2, "roles": ["staff", "lecturer"]}
router = APIRouter()


class RejectIn(BaseModel):
    comment: str = Field(min_length=1, max_length=1000)


@router.get("/list")
def list_(status: Optional[str] = None, q: Optional[str] = None, period_id: Optional[int] = None,
          student_id: Optional[int] = None,
          user: dict = Depends(require_roles("staff", "lecturer")), conn=Depends(get_conn)):
    sql, args = BASE_SQL + " WHERE a.status <> 'draft'", []  # черновики принадлежат студенту
    if status:
        sql += " AND a.status = %s"
        args.append(status)
    if period_id:
        sql += " AND a.period_id = %s"
        args.append(period_id)
    if student_id:
        sql += " AND a.student_id = %s"
        args.append(student_id)
    if q and q.strip():
        sql += " AND (a.title ILIKE %s OR s.full_name ILIKE %s)"
        args += [f"%{q.strip()}%"] * 2
    sql += " ORDER BY (a.status = 'under review') DESC, a.achievement_id DESC LIMIT 300"
    return conn.execute(sql, args).fetchall()


@router.get("/counts")
def counts(user: dict = Depends(require_roles("staff", "lecturer")), conn=Depends(get_conn)):
    rows = conn.execute("SELECT status, count(*) AS n FROM achievement GROUP BY status").fetchall()
    return {r["status"]: r["n"] for r in rows}


def after(conn, achievement_id: int) -> dict:
    return full_detail(conn, fetch_one(conn, achievement_id))


@router.post("/{achievement_id}/confirm")
def confirm(achievement_id: int, user: dict = Depends(require_roles("staff")), conn=Depends(get_conn)):
    if not fetch_one(conn, achievement_id):
        raise HTTPException(404, "Достижение не найдено")
    # функция сама проверит: сотрудник деканата, статус «на проверке», документ, правило начисления
    conn.execute("SELECT confirm_achievement(%s, %s)", (achievement_id, user["employee_id"]))
    return after(conn, achievement_id)


@router.post("/{achievement_id}/reject")
def reject(achievement_id: int, body: RejectIn, user: dict = Depends(require_roles("staff")),
           conn=Depends(get_conn)):
    if not fetch_one(conn, achievement_id):
        raise HTTPException(404, "Достижение не найдено")
    conn.execute("SELECT reject_achievement(%s, %s, %s)", (achievement_id, user["employee_id"], body.comment))
    return after(conn, achievement_id)

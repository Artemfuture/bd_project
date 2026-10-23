"""Мероприятия: каталог с фильтрами, календарь и ближайшие даты для «линейки»."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from ..db import get_conn
from ..deps import current_user

META = {"id": "events", "title": "Мероприятия", "script": "/static/modules/events.js", "order": 4}
router = APIRouter()

EVENT_SQL = """
SELECT e.event_id, e.title, e.start_date, e.end_date, e.place, e.event_type_id, e.level_id,
       et.name AS event_type, lv.name AS level, lv.rank AS level_rank,
       o.name AS organization, p.title AS parent_title
FROM event e
JOIN event_type et ON et.event_type_id = e.event_type_id
JOIN significance_level lv ON lv.level_id = e.level_id
LEFT JOIN organization o ON o.organization_id = e.organization_id
LEFT JOIN event p ON p.event_id = e.parent_event_id
"""


@router.get("/meta")
def meta(user: dict = Depends(current_user), conn=Depends(get_conn)):
    return {"types": conn.execute("SELECT event_type_id, name FROM event_type ORDER BY event_type_id").fetchall(),
            "levels": conn.execute("SELECT level_id, name FROM significance_level ORDER BY rank").fetchall()}


@router.get("")
def list_(type_id: Optional[int] = None, level_id: Optional[int] = None, date_from: Optional[date] = None,
          date_to: Optional[date] = None, q: Optional[str] = None,
          user: dict = Depends(current_user), conn=Depends(get_conn)):
    sql, args = EVENT_SQL + " WHERE true", []
    if type_id:
        sql += " AND e.event_type_id = %s"
        args.append(type_id)
    if level_id:
        sql += " AND e.level_id = %s"
        args.append(level_id)
    if date_from:
        sql += " AND e.end_date >= %s"
        args.append(date_from)
    if date_to:
        sql += " AND e.start_date <= %s"
        args.append(date_to)
    if q and q.strip():
        sql += " AND e.title ILIKE %s"
        args.append(f"%{q.strip()}%")
    return conn.execute(sql + " ORDER BY e.start_date, e.event_id LIMIT 500", args).fetchall()


@router.get("/upcoming")
def upcoming(days: int = 21, user: dict = Depends(current_user), conn=Depends(get_conn)):
    today = date.today()
    return conn.execute(EVENT_SQL + " WHERE e.end_date >= %s AND e.start_date <= %s ORDER BY e.start_date, e.event_id",
                        (today, today + timedelta(days=max(1, min(days, 120))))).fetchall()

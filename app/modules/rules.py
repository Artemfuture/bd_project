"""Правила начисления баллов (только просмотр): сколько баллов даёт каждое сочетание условий."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import get_conn
from ..deps import require_roles

META = {"id": "rules", "title": "Правила баллов", "script": "/static/modules/rules.js", "order": 5,
        "roles": ["staff", "lecturer", "student"]}
router = APIRouter()


@router.get("")
def list_(user: dict = Depends(require_roles("staff", "lecturer", "student")), conn=Depends(get_conn)):
    return conn.execute("""
        SELECT r.rule_id, r.kind, r.points, r.result, r.valid_from, r.valid_to,
               c.name AS category, lv.name AS level, lv.rank AS level_rank, pr.name AS role
        FROM scoring_rule r
        JOIN achievement_category c ON c.category_id = r.category_id
        LEFT JOIN significance_level lv ON lv.level_id = r.level_id
        LEFT JOIN participation_role pr ON pr.role_id = r.role_id
        ORDER BY (r.valid_to IS NULL) DESC, r.kind, c.category_id, r.valid_from DESC, r.points DESC""").fetchall()

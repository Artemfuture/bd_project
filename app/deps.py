from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from .db import get_conn
from .security import parse_token

COOKIE = "deanery_sid"

USER_SQL = """
SELECT ua.account_id, ua.login, ua.is_active, ua.student_id, ua.employee_id,
       COALESCE(s.full_name, e.full_name) AS full_name,
       e.role_type, s.group_id, s.status AS student_status
FROM user_account ua
LEFT JOIN student  s ON s.student_id  = ua.student_id
LEFT JOIN employee e ON e.employee_id = ua.employee_id
WHERE ua.account_id = %s
"""


def role_of(row: dict) -> str:
    """student | lecturer | staff (сотрудник деканата и администратор)."""
    if row["student_id"] is not None:
        return "student"
    return "lecturer" if row["role_type"] == "lecturer" else "staff"


def load_user(conn, account_id: int) -> dict | None:
    row = conn.execute(USER_SQL, (account_id,)).fetchone()
    if not row or not row["is_active"]:
        return None
    row["role"] = role_of(row)
    return row


def user_from_cookie(request: Request, conn) -> dict | None:
    account_id = parse_token(request.cookies.get(COOKIE))
    return None if account_id is None else load_user(conn, account_id)


def current_user(request: Request, conn=Depends(get_conn)) -> dict:
    user = user_from_cookie(request, conn)
    if user is None:
        raise HTTPException(401, "Не выполнен вход")
    return user


def require_roles(*roles: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Недостаточно прав")
        return user
    return dep

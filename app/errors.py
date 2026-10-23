"""Ошибки PostgreSQL → понятные ответы API.

Бизнес-правила живут в БД (триггеры, функции, CHECK, EXCLUDE). Бэкенд не дублирует их,
а переводит нарушения в HTTP-статусы. Сообщения RAISE EXCEPTION отдаются как есть,
русский перевод известных сообщений делает фронтенд."""
from __future__ import annotations

import logging

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg import errors as pg

log = logging.getLogger("deanery")

CHECK_TEXT = {
    "chk_event_dates": "Дата окончания не может быть раньше даты начала",
    "chk_period_dates": "Дата окончания периода должна быть позже даты начала",
    "chk_membership_dates": "Дата выхода не может быть раньше даты вступления",
    "chk_rule_validity": "Срок действия правила задан неверно",
    "chk_issn_format": "ISSN должен быть в формате NNNN-NNNN",
    "chk_author_order": "Порядковый номер автора должен быть не меньше 1",
}


CONFLICT_TEXT = {
    "excl_membership_overlap": "Вы уже состоите в этой организации в указанный период: периоды членства не должны пересекаться",
    "excl_academic_period_overlap": "Учебные периоды не должны пересекаться",
    "excl_scoring_rule_overlap": "Для этих условий уже действует правило в указанный срок",
    "uq_participation": "Это участие в мероприятии в этой роли уже оформлено",
    "uq_publication_author": "Вы уже указаны автором этой публикации",
    "uq_author_order": "Этот номер в списке авторов уже занят",
    "publication_doi_key": "Публикация с таким DOI уже есть",
}


def translate(exc: psycopg.Error) -> tuple[int, str]:
    d = exc.diag
    if isinstance(exc, pg.RaiseException):
        return 400, d.message_primary or "Нарушено правило базы данных"
    if isinstance(exc, pg.CheckViolation):
        return 400, CHECK_TEXT.get(d.constraint_name or "", f"Недопустимое значение ({d.constraint_name})")
    if isinstance(exc, pg.UniqueViolation):
        return 409, CONFLICT_TEXT.get(d.constraint_name or "", "Такая запись уже существует")
    if isinstance(exc, pg.ForeignKeyViolation):
        return 409, "Связанная запись не найдена или ещё используется"
    if isinstance(exc, pg.ExclusionViolation):
        return 409, CONFLICT_TEXT.get(d.constraint_name or "", "Конфликт: пересекающийся период или правило")
    if isinstance(exc, pg.NotNullViolation):
        return 400, f"Не заполнено обязательное поле: {d.column_name}"
    if isinstance(exc, pg.DataError):
        return 400, "Некорректное значение в запросе"
    return 500, "Ошибка базы данных"


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(psycopg.Error)
    async def db_error(_: Request, exc: psycopg.Error):
        status, message = translate(exc)
        if status == 500:
            log.exception("database error", exc_info=exc)
        return JSONResponse({"detail": message}, status_code=status)

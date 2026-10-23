"""Демо-данные и учётные записи.

    python -m scripts.seed_demo                  # учётные записи + демо-данные (безопасно запускать повторно)
    python -m scripts.seed_demo --accounts-only  # только учётные записи для людей из исходного дампа

Все демо-пароли одинаковые (DEMO_PASSWORD) и годятся только для локального показа.
Бизнес-правила не обходятся: подтверждение и отклонение идут через функции БД."""
from __future__ import annotations

import sys
from datetime import date, timedelta

import psycopg
from psycopg import errors as pg
from psycopg.rows import dict_row

from app import config
from app.security import hash_password

DEMO_PASSWORD = "demo1234"
REVIEWER_EMAIL = "petrova@example.ru"  # сотрудник деканата из исходного дампа

BASE_ACCOUNTS = [  # (логин, студент по номеру зачётки | сотрудник по e-mail)
    ("ivanov", "student", "2024-001"),
    ("petrova", "employee", "petrova@example.ru"),
    ("petrov", "employee", "petrov@example.ru"),
]
DEMO_ACCOUNTS = BASE_ACCOUNTS + [
    ("sidorova", "student", "2024-002"),
    ("smirnova", "student", "2024-004"),
    ("orlov", "employee", "orlov@example.ru"),
    ("kuznetsova", "employee", "kuznetsova@example.ru"),
]


def scalar(conn, sql, args=()):
    row = conn.execute(sql, args).fetchone()
    return None if row is None else next(iter(row.values()))


def seed_accounts(conn, accounts=BASE_ACCOUNTS, password=DEMO_PASSWORD) -> list[str]:
    done = []
    for login, kind, key in accounts:
        if kind == "student":
            owner = scalar(conn, "SELECT student_id FROM student WHERE record_book_no = %s", (key,))
        else:
            owner = scalar(conn, "SELECT employee_id FROM employee WHERE email = %s", (key,))
        if owner is None:
            continue
        conn.execute(
            f"""INSERT INTO user_account (login, password_hash, {kind}_id) VALUES (%s, %s, %s)
                ON CONFLICT (login) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true""",
            (login, hash_password(password), owner))
        done.append(login)
    return done


# ------------------------------------------------------------------ демо-данные
def period_start(conn, day: date) -> date:
    return scalar(conn, "SELECT start_date FROM academic_period WHERE %s BETWEEN start_date AND end_date", (day,))


def ensure_periods(conn, today: date) -> None:
    for year, sem, start, end in [("2025/2026", 1, date(2025, 9, 1), date(2026, 1, 31)),
                                  ("2025/2026", 2, date(2026, 2, 1), date(2026, 8, 31))]:
        conn.execute("""INSERT INTO academic_period (academic_year, semester, start_date, end_date)
                        VALUES (%s, %s, %s, %s) ON CONFLICT (academic_year, semester) DO NOTHING""",
                     (year, sem, start, end))
    if period_start(conn, today) is None:  # запуск вне известных периодов: добавим текущий
        y = today.year
        if today.month >= 9:
            row = (f"{y}/{y + 1}", 1, date(y, 9, 1), date(y + 1, 1, 31))
        elif today.month == 1:
            row = (f"{y - 1}/{y}", 1, date(y - 1, 9, 1), date(y, 1, 31))
        else:
            row = (f"{y - 1}/{y}", 2, date(y, 2, 1), date(y, 8, 31))
        try:
            with conn.transaction():
                conn.execute("INSERT INTO academic_period (academic_year, semester, start_date, end_date) "
                             "VALUES (%s, %s, %s, %s)", row)
        except (pg.ExclusionViolation, pg.UniqueViolation):
            pass


def lookup(conn, table, id_col, name):
    return scalar(conn, f"SELECT {id_col} FROM {table} WHERE name = %s", (name,))


def add_rule(conn, kind, category, level, role, result, points, valid_from, valid_to=None):
    ids = (lookup(conn, "achievement_category", "category_id", category),
           lookup(conn, "significance_level", "level_id", level) if level else None,
           lookup(conn, "participation_role", "role_id", role) if role else None)
    try:
        with conn.transaction():  # повторный запуск: пересекающееся правило молча пропускаем
            conn.execute("""INSERT INTO scoring_rule (kind, category_id, level_id, role_id, result, points,
                                                      valid_from, valid_to)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                         (kind, *ids, result, points, valid_from, valid_to))
    except pg.ExclusionViolation:
        pass


def ensure_event(conn, title, start, end, place, type_name, level_name, parent=None, org=None):
    eid = scalar(conn, "SELECT event_id FROM event WHERE title = %s", (title,))
    if eid:
        return eid
    return scalar(conn, """INSERT INTO event (title, start_date, end_date, place, event_type_id, level_id,
                                              parent_event_id, organization_id)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING event_id""",
                  (title, start, end, place, lookup(conn, "event_type", "event_type_id", type_name),
                   lookup(conn, "significance_level", "level_id", level_name), parent,
                   lookup(conn, "organization", "organization_id", org) if org else None))


def add_achievement(conn, student_rb, kind, title, day, category, target, comment=None, **sub):
    """Создаёт достижение со статусом «на проверке» (или «черновик») и доводит до target
    теми же функциями БД, которыми пользуется приложение."""
    sid = scalar(conn, "SELECT student_id FROM student WHERE record_book_no = %s", (student_rb,))
    status = "draft" if target == "draft" else "under review"
    aid = scalar(conn, """INSERT INTO achievement (kind, title, achieved_on, status, student_id, category_id, period_id)
                          VALUES (%s, %s, %s, %s, %s, %s, (SELECT period_id FROM academic_period
                                                           WHERE %s BETWEEN start_date AND end_date))
                          RETURNING achievement_id""",
                 (kind, title, day, status, sid, lookup(conn, "achievement_category", "category_id", category), day))
    if kind == "participation":
        conn.execute("""INSERT INTO achievement_event (achievement_id, student_id, event_id, role_id, result)
                        VALUES (%s, %s, %s, %s, %s)""",
                     (aid, sid, sub["event_id"], lookup(conn, "participation_role", "role_id", sub["role"]), sub["result"]))
    elif kind == "authorship":
        conn.execute("""INSERT INTO achievement_authorship (achievement_id, student_id, publication_id, author_order)
                        VALUES (%s, %s, %s, %s)""", (aid, sid, sub["publication_id"], sub.get("order", 1)))
    else:
        conn.execute("""INSERT INTO achievement_membership (achievement_id, student_id, organization_id, position, joined_on)
                        VALUES (%s, %s, %s, %s, %s)""", (aid, sid, sub["organization_id"], sub.get("position", "member"), day))
    conn.execute("""INSERT INTO supporting_document (doc_type, doc_number, issued_on, file_ref, achievement_id)
                    VALUES (%s, %s, %s, %s, %s)""",
                 (sub.get("doc_type", "certificate"), None, day, f"/documents/demo-{aid}.pdf", aid))
    reviewer = scalar(conn, "SELECT employee_id FROM employee WHERE email = %s", (REVIEWER_EMAIL,))
    if target == "confirmed":
        conn.execute("SELECT confirm_achievement(%s, %s)", (aid, reviewer))
    elif target == "rejected":
        conn.execute("SELECT reject_achievement(%s, %s, %s)", (aid, reviewer, comment or "The document is unreadable"))
    return aid


def seed_demo_data(conn) -> bool:
    if scalar(conn, "SELECT 1 FROM student WHERE record_book_no = '2024-002'"):
        return False  # уже заполнено
    today = date.today()
    ensure_periods(conn, today)
    floor = period_start(conn, today)
    past = lambda n: max(today - timedelta(days=n), floor)  # дата в текущем периоде
    soon = lambda n: today + timedelta(days=n)

    # группы, студенты, сотрудники
    dept = scalar(conn, "SELECT department_id FROM department ORDER BY department_id LIMIT 1")
    direction = scalar(conn, "SELECT direction_id FROM study_direction ORDER BY direction_id LIMIT 1")
    for code, year in (("CSE-24-2", 2024), ("CSE-23-1", 2023)):
        conn.execute("INSERT INTO study_group (code, admission_year, direction_id) VALUES (%s, %s, %s) "
                     "ON CONFLICT (code) DO NOTHING", (code, year, direction))
    for rb, name, born, email, group in [
        ("2024-002", "Sidorova Maria Petrovna", date(2006, 8, 21), "sidorova@example.com", "CSE-24-1"),
        ("2024-003", "Kozlov Dmitry Andreevich", date(2005, 11, 2), "kozlov@example.com", "CSE-24-1"),
        ("2024-004", "Smirnova Elena Igorevna", date(2006, 3, 9), "smirnova@example.com", "CSE-24-2"),
        ("2024-005", "Volkov Pavel Sergeevich", date(2005, 12, 30), "volkov@example.com", "CSE-24-2"),
        ("2023-001", "Novikova Daria Alexandrovna", date(2005, 1, 17), "novikova@example.com", "CSE-23-1"),
        ("2023-002", "Morozov Alexey Viktorovich", date(2004, 10, 5), "morozov@example.com", "CSE-23-1"),
    ]:
        conn.execute("""INSERT INTO student (record_book_no, full_name, birth_date, email, group_id)
                        VALUES (%s, %s, %s, %s, (SELECT group_id FROM study_group WHERE code = %s))
                        ON CONFLICT (record_book_no) DO NOTHING""", (rb, name, born, email, group))
    for name, position, role, email, d in [
        ("Kuznetsova Olga Nikolaevna", "professor", "lecturer", "kuznetsova@example.ru", dept),
        ("Orlov Sergey Pavlovich", "deanery specialist", "deanery staff", "orlov@example.ru", None),
    ]:
        conn.execute("""INSERT INTO employee (full_name, position, role_type, email, department_id)
                        VALUES (%s, %s, %s, %s, %s) ON CONFLICT (email) DO NOTHING""", (name, position, role, email, d))
    kuznetsova = scalar(conn, "SELECT employee_id FROM employee WHERE email = 'kuznetsova@example.ru'")
    for name, typ, founded in (("Robotics Club", "club", date(2022, 9, 1)), ("Student Council", "student council", date(2020, 9, 1))):
        conn.execute("""INSERT INTO organization (name, org_type, founded_on, curator_id) VALUES (%s, %s, %s, %s)
                        ON CONFLICT (name) DO NOTHING""", (name, typ, founded, kuznetsova))

    # правила начисления: версии по времени и условия «любой» (NULL)
    d0, d1 = date(2025, 9, 1), date(2026, 8, 31)
    add_rule(conn, "participation", "scientific", "university", "speaker", "1st place", 8, d0, d1)   # прежняя версия
    add_rule(conn, "authorship", "scientific", "national", None, None, 12, d0, d1)                    # прежняя версия
    for kind, cat, lvl, role, res, pts in [
        ("participation", "scientific", None, None, None, 3),
        ("participation", "scientific", "regional", None, "1st place", 20),
        ("participation", "scientific", "national", "speaker", None, 12),
        ("participation", "scientific", "international", None, None, 25),
        ("participation", "olympiad", None, None, None, 5),
        ("participation", "olympiad", "regional", None, "1st place", 15),
        ("participation", "creative", None, None, None, 4),
        ("participation", "sports", "university", None, None, 4),
        ("participation", "sports", "university", None, "1st place", 8),
        ("authorship", "scientific", "university", None, None, 6),
        ("authorship", "scientific", "international", None, None, 30),
        ("membership", "social", None, None, None, 2),
        ("membership", "scientific", None, None, None, 2),
        ("membership", "creative", None, None, None, 2),
    ]:
        add_rule(conn, kind, cat, lvl, role, res, pts, d0)

    # мероприятия: часть в будущем (для «линейки»), часть в прошлом (для достижений)
    forum = ensure_event(conn, "All-Russian Student Science Forum", soon(16), soon(18), "Moscow", "conference", "national")
    ensure_event(conn, "Section: Databases", soon(17), soon(17), "Room 204", "conference", "national", parent=forum)
    ensure_event(conn, "Regional Programming Olympiad", soon(4), soon(4), "Moscow", "olympiad", "regional")
    ensure_event(conn, "Hackathon: Smart Campus", soon(9), soon(10), "Online", "hackathon", "university", org="Robotics Club")
    ensure_event(conn, "Open Doors Day", soon(2), soon(2), "Main building", "contest", "university", org="Student Council")
    spartakiad = ensure_event(conn, "University Spartakiad", past(20), past(19), "Stadium", "competition", "university")
    creative = ensure_event(conn, "Regional Creative Contest", past(35), past(35), "Cultural center", "contest", "regional")
    intl = ensure_event(conn, "International IT Conference", past(30), past(29), "Online", "conference", "international")
    reg_math = ensure_event(conn, "Regional Mathematics Olympiad", past(25), past(25), "Kazan", "olympiad", "regional")
    hack = ensure_event(conn, "Autumn Hackathon", past(14), past(14), "Campus", "hackathon", "university")
    spring = ensure_event(conn, "Spring Programming Olympiad", date(2026, 4, 15), date(2026, 4, 15), "Moscow", "olympiad", "regional")

    # издания и публикации
    for name, typ, level in (("Journal of Applied Informatics", "VAK journal", "national"),
                             ("IEEE Access", "Scopus/WoS journal", "international"),
                             ("Proceedings of the University Conference", "conference proceedings", "university")):
        conn.execute("""INSERT INTO publication_source (name, source_type, level_id)
                        VALUES (%s, %s, (SELECT level_id FROM significance_level WHERE name = %s))
                        ON CONFLICT (name, source_type) DO NOTHING""", (name, typ, level))
    def publication(title, day, source, doi):
        conn.execute("""INSERT INTO publication (title, published_on, doi, pages, source_id, supervisor_id)
                        VALUES (%s, %s, %s, '1-8', (SELECT source_id FROM publication_source WHERE name = %s), %s)
                        ON CONFLICT (doi) DO NOTHING""", (title, day, doi, source, kuznetsova))
        return scalar(conn, "SELECT publication_id FROM publication WHERE doi = %s", (doi,))
    pub_pg = publication("Query Optimization in PostgreSQL", past(12), "Journal of Applied Informatics", "10.1234/demo.2026.101")
    pub_ml = publication("Machine Learning for Timetable Scheduling", past(40), "IEEE Access", "10.1234/demo.2026.102")

    org_robot = scalar(conn, "SELECT organization_id FROM organization WHERE name = 'Robotics Club'")
    org_council = scalar(conn, "SELECT organization_id FROM organization WHERE name = 'Student Council'")
    A = lambda *a, **k: add_achievement(conn, *a, **k)

    # Ивановым занимался исходный дамп; добавим ему прошлый семестр
    A("2024-001", "participation", "1st place at the Spring Programming Olympiad", date(2026, 4, 15), "olympiad",
      "confirmed", event_id=spring, role="participant", result="1st place")
    A("2024-002", "participation", "Spartakiad: 1st place in chess", past(20), "sports", "confirmed",
      event_id=spartakiad, role="participant", result="1st place")
    A("2024-002", "authorship", "Article: Query Optimization in PostgreSQL", past(12), "scientific", "confirmed",
      publication_id=pub_pg, doc_type="publication copy")
    A("2024-002", "membership", "Member of the Robotics Club", past(10), "social", "under review", organization_id=org_robot)
    A("2024-004", "participation", "Speaker at the International IT Conference", past(30), "scientific", "confirmed",
      event_id=intl, role="speaker", result="no place")
    A("2024-004", "participation", "Regional Mathematics Olympiad: 1st place", past(25), "olympiad", "confirmed",
      event_id=reg_math, role="participant", result="1st place", doc_type="diploma")
    A("2024-004", "membership", "Student Council member", past(8), "social", "draft", organization_id=org_council)
    A("2024-005", "participation", "Autumn Hackathon participant", past(14), "scientific", "under review",
      event_id=hack, role="participant", result="no place")
    A("2024-005", "participation", "Regional Creative Contest: 3rd place", past(35), "creative", "rejected",
      comment="The diploma scan is unreadable, please attach it again", event_id=creative, role="participant", result="3rd place")
    A("2023-001", "authorship", "Article in IEEE Access", past(40), "scientific", "confirmed", publication_id=pub_ml)
    A("2023-001", "participation", "University Spartakiad: 1st place", past(20), "sports", "confirmed",
      event_id=spartakiad, role="participant", result="1st place")
    A("2023-001", "membership", "Robotics Club member", past(6), "scientific", "under review", organization_id=org_robot)
    A("2023-002", "participation", "Spring Programming Olympiad: 2nd place", date(2026, 4, 15), "olympiad", "confirmed",
      event_id=spring, role="participant", result="2nd place")
    A("2024-003", "participation", "Spartakiad: participation", past(20), "sports", "confirmed",
      event_id=spartakiad, role="participant", result="no place")
    conn.execute("UPDATE student SET status = 'expelled' WHERE record_book_no = '2024-003'")  # после достижений: триггер запретил бы вставку

    for pid in [r["period_id"] for r in conn.execute("SELECT period_id FROM academic_period").fetchall()]:
        conn.execute("SELECT recalculate_period_rating(%s)", (pid,))
    return True


def main(argv: list[str]) -> None:
    with psycopg.connect(config.DATABASE_URL, row_factory=dict_row) as conn:
        if "--accounts-only" in argv:
            logins = seed_accounts(conn)
        else:
            filled = seed_demo_data(conn)
            print("Демо-данные добавлены." if filled else "Демо-данные уже были добавлены, пропускаю.")
            logins = seed_accounts(conn, DEMO_ACCOUNTS)
    print("Учётные записи:", ", ".join(logins))
    print(f"Пароль для всех: {DEMO_PASSWORD}  (только для локальной демонстрации)")


if __name__ == "__main__":
    main(sys.argv[1:])

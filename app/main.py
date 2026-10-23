"""Деканат: достижения студентов и рейтинг. Запуск: python run.py"""
from __future__ import annotations

import importlib
import logging
import pkgutil
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import config, db, modules
from .deps import COOKIE, current_user, load_user, user_from_cookie
from .errors import install_handlers
from .security import DUMMY_HASH, make_token, verify_password

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    yield
    db.close_pool()


app = FastAPI(title="Deanery", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)
# защита от DNS rebinding: приложение отвечает только на локальные имена
app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.TRUSTED_HOSTS)
install_handlers(app)


@app.middleware("http")
async def guard_and_timing(request: Request, call_next):
    # изменяющие запросы принимаем только со страницы самого приложения (защита от CSRF)
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        if origin and origin != f"{request.url.scheme}://{request.headers.get('host', '')}":
            return JSONResponse({"detail": "Запрос не со страницы приложения"}, status_code=403)
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - start) * 1000:.0f}"
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"   # браузер сверяет файл по ETag: правки стилей и скриптов видны сразу
    return response


class Login(BaseModel):
    username: str
    password: str


def public_user(u: dict) -> dict:
    return {"full_name": u["full_name"], "login": u["login"], "role": u["role"],
            "student_id": u["student_id"], "employee_id": u["employee_id"], "group_id": u["group_id"],
            "position": u["role_type"]}


@app.post("/api/login")
def login(body: Login, response: Response, conn=Depends(db.get_conn)):
    row = conn.execute("SELECT account_id, password_hash, is_active FROM user_account "
                       "WHERE lower(login) = lower(%s)", (body.username.strip(),)).fetchone()
    ok = verify_password(body.password, row["password_hash"] if row else DUMMY_HASH)
    if not row or not ok or not row["is_active"]:
        raise HTTPException(401, "Неверный логин или пароль")
    response.set_cookie(COOKIE, make_token(row["account_id"]), httponly=True, samesite="lax",
                        max_age=config.SESSION_TTL, secure=config.COOKIE_SECURE)
    return public_user(load_user(conn, row["account_id"]))


@app.get("/api/session")
def session(request: Request, conn=Depends(db.get_conn)):
    """Без авторизации: вошли ли мы."""
    return {"logged_in": user_from_cookie(request, conn) is not None}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return public_user(user)


# --- загрузка модулей: каждый файл в app/modules с META и router -----------------
LOADED: list[dict] = []
for info in pkgutil.iter_modules(modules.__path__):
    mod = importlib.import_module(f"{modules.__name__}.{info.name}")
    if hasattr(mod, "META") and hasattr(mod, "router"):
        app.include_router(mod.router, prefix=f"/api/{mod.META['id']}", dependencies=[Depends(current_user)])
        LOADED.append(mod.META)
LOADED.sort(key=lambda m: m.get("order", 100))


@app.get("/api/modules")
def list_modules(user: dict = Depends(current_user)):
    """Модули, доступные роли пользователя (пункты меню)."""
    return [m for m in LOADED if user["role"] in m.get("roles", ("student", "staff", "lecturer"))]


app.mount("/static", StaticFiles(directory=config.ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(config.ROOT / "static" / "index.html")

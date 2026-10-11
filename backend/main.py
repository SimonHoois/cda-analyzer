"""
CdA Lab API + static frontend.

    uvicorn main:app --host 0.0.0.0 --port $PORT

Every request belongs to an *owner*: the shared workspace when APP_PASSWORD is set,
otherwise an anonymous browser session (cookie). Owners never see each other's files.
"""
import asyncio
import base64
import logging
import secrets
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import config
import store
from routes import charts, files, history_routes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("cda")
COOKIE = "cda_sid"


async def _janitor():
    while True:
        try:
            n = await asyncio.to_thread(store.cleanup)
            if n:
                log.info("retention cleanup removed %s old uploads", n)
        except Exception:
            log.exception("cleanup failed")
        await asyncio.sleep(6 * 3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    task = asyncio.create_task(_janitor())
    log.info("CdA Lab %s, data in %s, password %s", config.VERSION, config.DATA_DIR,
             "ON" if config.APP_PASSWORD else "off")
    yield
    task.cancel()


app = FastAPI(title="CdA Lab", version=config.VERSION, lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")

if config.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def access_and_owner(request: Request, call_next):
    if request.url.path == "/healthz":
        return Response("ok", media_type="text/plain")

    if config.APP_PASSWORD:
        ok = False
        header = request.headers.get("authorization", "")
        if header.lower().startswith("basic "):
            try:
                user, _, pw = base64.b64decode(header[6:]).decode("utf-8").partition(":")
                ok = (secrets.compare_digest(user, config.APP_USER)
                      and secrets.compare_digest(pw, config.APP_PASSWORD))
            except Exception:
                ok = False
        if not ok:
            return Response("Authentication required", status_code=401,
                            headers={"WWW-Authenticate": 'Basic realm="CdA Lab", charset="UTF-8"'})
        request.state.owner, new_cookie = "shared", None
    else:
        sid = request.cookies.get(COOKIE, "")
        new_cookie = None
        if not store.ID_RE.match(sid):
            sid = uuid.uuid4().hex
            new_cookie = sid
        request.state.owner = sid

    response = await call_next(request)
    if new_cookie:
        https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
        response.set_cookie(COOKIE, new_cookie, max_age=365 * 86400, httponly=True,
                            samesite="lax", secure=https)
    return response


@app.exception_handler(ValueError)
async def value_error(_, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(x) for x in first.get("loc", [])[1:])
    return JSONResponse({"detail": f"Invalid value for {where or 'request'}: {first.get('msg', '')}"},
                        status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on the server. Please try again."}, status_code=500)


app.include_router(files.router)
app.include_router(charts.router)
app.include_router(history_routes.router)


@app.get("/api/config")
def app_config():
    return {"version": config.VERSION, "private": bool(config.APP_PASSWORD),
            "max_upload_mb": config.MAX_UPLOAD_MB, "retention_days": config.RETENTION_DAYS}


# ── static frontend (the Vite build) ────────────────────────────────────────
_dist = config.FRONTEND_DIR
if (_dist / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    if not (_dist / "index.html").exists():
        return JSONResponse({"detail": "Frontend not built. Run `npm run build` in /frontend, "
                                       "or use the Vite dev server."}, status_code=404)
    target = (_dist / path).resolve()
    if path and target.is_file() and _dist in target.parents:
        return FileResponse(target)
    return FileResponse(_dist / "index.html", headers={"Cache-Control": "no-cache"})

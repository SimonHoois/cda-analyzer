# CdA Lab

Estimate your aerodynamic drag (CdA) from out-and-back rides (.fit files) using the virtual-elevation method.
FastAPI backend + React/Vite frontend, shipped as one Docker service.

## Deploy on Render (free plan, personal testing)

1. Push this repo to GitHub (keep `frontend/package-lock.json`; `node_modules` and `dist` are ignored).
2. Render → **New → Blueprint** → pick the repo. Render reads `render.yaml` (free plan, Docker).
3. Set `APP_PASSWORD` when asked. Log in with user `cda` and that password. Every device you log in on sees the same rides.
4. Open the URL Render gives you. Health check: `/healthz`.

**Free plan notes**
- The service sleeps after about 15 minutes without traffic. The first visit afterwards takes up to a minute.
- Uploaded rides and history are stored on the container disk, which is wiped on every restart and redeploy.
  Analyse a session, note the results, and expect to re-upload next time.
- For permanent storage, set `plan: starter` and uncomment the `disk:` block in `render.yaml`.
- Without `APP_PASSWORD` the app is open and each browser gets its own private workspace (cookie).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `APP_PASSWORD` / `APP_USER` | unset / `cda` | Enables HTTP Basic login |
| `DATA_DIR` | `backend/data` | Where uploads and history are stored |
| `MAX_UPLOAD_MB` | see `config.py` | Per-file upload limit |
| `MAX_FILES_PER_OWNER` | see `config.py` | File cap per workspace |
| `RETENTION_DAYS` | 30 | Old uploads are deleted after this |
| `MAX_CACHED_ANALYZERS` | see `config.py` | In-memory LRU size |

## Local development

```
cd backend && pip install -r requirements.txt && uvicorn main:app --reload      # :8000
cd frontend && npm install && npm run dev                                       # :5173, proxies /api
pytest                                                                          # from repo root
```

Old `cda_history.json` files can be imported from the History page.

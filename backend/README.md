# CHARUSAT Result Tracker — Admin Dashboard

A real admin dashboard for the crawler/notification/Telegram system on the
`postgres-migration` branch. No mock data, no second database — this reads
and writes the same PostgreSQL database the crawler, notification worker,
and Telegram bot already use, through the existing `database.py` module.

## What's here

```
backend/
  app/
    config.py     — env loading, adds repo root to sys.path
    security.py   — password hashing (bcrypt) + JWT
    deps.py       — auth guard (get_current_admin)
    schemas.py    — request/response models
    main.py       — every API route
  create_admin.py — safe, explicit admin account creation
  requirements.txt
  .env.example
frontend/
  index.html
  style.css
  app.js          — vanilla JS, no build step, no framework
deploy/
  nginx.conf.example
  result-tracker-dashboard.service
  crawler.service → crawler_service.py
  notification-worker.service
  telegram-bot.service
```

## Local setup

1. **Database** — you already have this if the crawler/bot are running.
   If setting up fresh:
   ```bash
   createdb charusat_tracker
   psql charusat_tracker -f schema.sql
   ```

2. **Backend**
   ```bash
   cd backend
   python3 -m venv venv && source venv/bin/activate
   pip install -r requirements.txt -r ../requirements.txt
   cp .env.example .env
   # edit .env: DB credentials, and generate a real JWT secret:
   python3 -c "import secrets; print(secrets.token_hex(32))"
   python3 create_admin.py   # create your first login
   uvicorn app.main:app --reload --port 8000
   ```

3. **Frontend** — no build step. Either open `frontend/index.html` directly
   through a static server, or point Nginx at it (see `deploy/nginx.conf.example`).
   For local dev without Nginx:
   ```bash
   cd frontend
   python3 -m http.server 8080
   ```
   and set `API_BASE` at the top of `app.js` to `http://localhost:8000/api`
   for that session (leave it as `/api` once Nginx is proxying both from
   one origin).

## What's real vs. what's a known gap

- Every page is wired to a real endpoint — nothing in the frontend is mocked.
- **Bot token rotation is not exposed in the UI.** The token lives in the
  server's `.env`/environment, not the database, so it's never returned by
  any API response. Rotating it means updating `.env` and restarting the
  service — this was a deliberate choice, not an oversight (see the plan's
  own warning about not exposing tokens through a general settings API).
- The Health page's service checks (`crawler.service`,
  `notification-worker.service`, `telegram-bot.service`) use `systemctl
  is-active` on whatever host the dashboard API runs on. They'll read
  "unknown" anywhere that's not how those processes are actually run —
  adjust the unit names in `backend/app/main.py`'s `health()` function to
  match your real service names if they differ from the `deploy/*.service`
  examples here.
- `crawler.workers` is capped at 11 by `crawl_results.py` itself (a
  pre-existing validation in that file, not something this dashboard adds)
  — the Crawler settings form will let you type 12, but the next crawl run
  will fail with a clear error until it's back in range.

## Bugs found and fixed while building this

- `admin_users` queries in `database.py` referenced a column named
  `active`, but the table (per `schema.sql`) only has `is_active`. Every
  admin-related query would have failed at runtime. Fixed in `database.py`.
- `get_admin_users()` / `get_admin_user()` were each defined twice
  (the second definition silently overriding the first). Deduplicated.
- `passlib`'s bcrypt backend doesn't work with the `bcrypt` package version
  that installs today (a known upstream incompatibility) — it throws on
  every hash/verify call. Switched to calling `bcrypt` directly.

All three were caught by actually running the backend against a real
PostgreSQL instance and a real login, not just reading the code.

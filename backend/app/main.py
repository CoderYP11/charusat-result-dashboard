"""
CHARUSAT Result Tracker — Admin Dashboard API

Implements the target API structure from
CHARUSAT_Dashboard_Complete_Change_Plan.txt (section 40), backed directly
by the existing PostgreSQL database via the repo-root `database.py` module.
No second database, no mock data, no fake crawler simulation.
"""

import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .deps import get_current_admin
from .security import create_access_token, hash_password, verify_password
from .schemas import (
    AdminCreate,
    AdminUpdate,
    LoginRequest,
    SettingUpdate,
    SettingsBulkUpdate,
    SubscriberCreate,
    SubscriberUpdate,
    TelegramTestMessage,
    TokenResponse,
)

import database as db

app = FastAPI(title="CHARUSAT Result Tracker — Admin Dashboard API")

def validate_setting(key: str, value):
    allowed_settings = {
        "crawler.enabled",
        "crawler.interval_minutes",
        "crawler.workers",
        "crawler.retry_count",
        "crawler.retry_delay_seconds",
        "crawler.request_timeout_seconds",
        "notifications.enabled",
        "notifications.poll_interval_seconds",
        "notifications.batch_size",
        "notifications.retry_delay_seconds",
        "notifications.max_attempts",
        "telegram.enabled",
        "telegram.notifications_enabled",
        "telegram.admin_chat_id",
        "system.maintenance_mode",
        "system.timezone",
        "system.log_retention_days",
    }

    if key not in allowed_settings:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported setting: {key}",
        )

    boolean_settings = {
        "crawler.enabled",
        "notifications.enabled",
        "telegram.enabled",
        "telegram.notifications_enabled",
        "system.maintenance_mode",
    }

    if key in boolean_settings:
        if not isinstance(value, bool):
            raise HTTPException(
                status_code=400,
                detail=f"{key} must be a boolean",
            )
        return

    integer_limits = {
        "crawler.interval_minutes": (1, 1440),
        "crawler.workers": (1, 11),
        "crawler.retry_count": (0, 10),
        "crawler.retry_delay_seconds": (0, 300),
        "crawler.request_timeout_seconds": (1, 300),
        "notifications.poll_interval_seconds": (1, 3600),
        "notifications.batch_size": (1, 100),
        "notifications.retry_delay_seconds": (0, 86400),
        "notifications.max_attempts": (1, 20),
        "system.log_retention_days": (1, 3650),
    }

    if key in integer_limits:
        if isinstance(value, bool) or not isinstance(value, int):
            raise HTTPException(
                status_code=400,
                detail=f"{key} must be an integer",
            )

        minimum, maximum = integer_limits[key]

        if not minimum <= value <= maximum:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{key} must be between "
                    f"{minimum} and {maximum}"
                ),
            )
        return

    if key == "telegram.admin_chat_id":
        if value is None:
            return

        if isinstance(value, bool) or not isinstance(value, int):
            raise HTTPException(
                status_code=400,
                detail="telegram.admin_chat_id must be an integer or null",
            )

        if value == 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "telegram.admin_chat_id must be a "
                    "non-zero integer or null"
                ),
            )

        return

    if key == "system.timezone":
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(
                status_code=400,
                detail="system.timezone must be a non-empty string",
            )
        return

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Row -> dict helpers (match the column order of the corresponding
# database.py query exactly)
# ============================================================

def _row(fields, row):
    return dict(zip(fields, row)) if row else None


def _rows(fields, rows):
    return [dict(zip(fields, r)) for r in rows]


ADMIN_FIELDS = ["id", "username", "password_hash", "display_name", "is_active", "created_at", "updated_at", "last_login_at"]
CRAWL_RUN_FIELDS = ["id", "status", "started_at", "completed_at", "duration_ms", "workers", "institutes_total", "institutes_completed", "institutes_failed", "results_discovered", "results_new", "error_message", "triggered_by"]
SUBSCRIBER_FIELDS = ["chat_id", "username", "first_name", "is_active", "created_at", "updated_at"]
LOG_FIELDS = ["id", "level", "actor", "action", "target", "message", "details", "created_at"]
RESULT_FIELDS = ["id", "institute_id", "institute_name", "degree_id", "degree_name", "semester_id", "exam_name", "first_seen_at", "last_seen_at", "notified_count", "pending_count"]
RESULT_DETAIL_FIELDS = ["id", "institute_id", "institute_name", "degree_id", "degree_name", "semester_id", "exam_name", "first_seen_at", "last_seen_at"]
NOTIFICATION_FIELDS = ["id", "result_id", "exam_name", "chat_id", "status", "attempts", "next_attempt_at", "last_error", "created_at", "sent_at"]


def _admin_public(admin_dict):
    """Never send password_hash to the client."""
    return {k: v for k, v in admin_dict.items() if k != "password_hash"}


# ============================================================
# AUTH
# ============================================================

@app.post("/api/auth/login", response_model=TokenResponse)
def login(body: LoginRequest):
    row = db.get_admin_user(body.username)
    admin = _row(ADMIN_FIELDS, row)

    if admin is None or not verify_password(body.password, admin["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    if not admin["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This admin account is disabled")

    db.update_admin_last_login(admin["id"])
    db.log_activity(level="INFO", action="auth.login", message="Admin logged in", actor=admin["username"])

    token = create_access_token(subject=admin["username"])
    return TokenResponse(access_token=token)


@app.get("/api/auth/me")
def read_me(current=Depends(get_current_admin)):
    return current


@app.post("/api/auth/logout")
def logout(current=Depends(get_current_admin)):
    # JWTs are stateless — "logout" is a client-side token discard.
    # Logged here for audit purposes only.
    db.log_activity(level="INFO", action="auth.logout", message="Admin logged out", actor=current["username"])
    return {"ok": True}


# ============================================================
# OVERVIEW
# ============================================================

@app.get("/api/overview")
def overview(current=Depends(get_current_admin)):
    latest_run = _row(CRAWL_RUN_FIELDS, db.get_latest_crawl_run())
    running_run = _row(CRAWL_RUN_FIELDS, db.get_running_crawl_run())
    notif_counts = db.get_notification_queue_counts()

    return {
        "results_total": db.get_result_count(),
        "results_new_24h": db.get_new_results_count(24),
        "subscribers_active": db.get_subscriber_count(),
        "subscribers_total": db.get_total_subscriber_count(),
        "notification_queue": notif_counts,
        "crawler_enabled": db.get_setting("crawler.enabled", True),
        "telegram_enabled": db.get_setting("telegram.enabled", True),
        "latest_run": latest_run,
        "running_run": running_run,
        "recent_runs": _rows(CRAWL_RUN_FIELDS, db.get_crawl_runs(limit=5)),
        "recent_activity": _rows(LOG_FIELDS, db.get_activity_logs(limit=10)),
    }


# ============================================================
# RESULTS
# ============================================================

@app.get("/api/results")
def list_results(
    institute_id: str | None = None,
    degree_id: str | None = None,
    semester_id: str | None = None,
    search: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    current=Depends(get_current_admin),
):
    rows = db.get_results(limit, offset, institute_id, degree_id, semester_id, search)
    total = db.get_results_count(institute_id, degree_id, semester_id, search)
    return {"items": _rows(RESULT_FIELDS, rows), "total": total, "limit": limit, "offset": offset}


@app.get("/api/results/{result_id}")
def get_result(result_id: int, current=Depends(get_current_admin)):
    row = _row(RESULT_DETAIL_FIELDS, db.get_result_by_id(result_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Result not found")
    return row


@app.get("/api/structure/institutes")
def list_institutes(current=Depends(get_current_admin)):
    return _rows(["id", "name"], db.get_institutes())


@app.get("/api/structure/degrees")
def list_degrees(institute_id: str | None = None, current=Depends(get_current_admin)):
    return _rows(["id", "institute_id", "name"], db.get_degrees(institute_id))


@app.get("/api/structure/semesters")
def list_semesters(degree_id: str | None = None, current=Depends(get_current_admin)):
    return _rows(["id", "degree_id", "name"], db.get_semesters(degree_id))


# ============================================================
# CRAWLER
# ============================================================

@app.get("/api/crawler/status")
def crawler_status(current=Depends(get_current_admin)):
    return {
        "settings": db.get_settings("crawler."),
        "running_run": _row(CRAWL_RUN_FIELDS, db.get_running_crawl_run()),
        "latest_run": _row(CRAWL_RUN_FIELDS, db.get_latest_crawl_run()),
    }


@app.post("/api/crawler/run", status_code=status.HTTP_202_ACCEPTED)
def trigger_crawler_run(current=Depends(get_current_admin)):
    if db.get_running_crawl_run() is not None:
        raise HTTPException(
            status_code=409,
            detail="A crawl run is already in progress",
        )

    # Request the existing crawler.service to perform a manual crawl.
    # The crawler scheduler consumes this flag and runs the crawl
    # inside the systemd-managed crawler process.
    try:
        db.set_setting(
            "crawler.manual_trigger",
            True,
            updated_by=current["username"],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to trigger crawler: {exc}",
        ) from exc

    db.log_activity(
        level="INFO",
        action="crawler.run_triggered",
        message="Manual crawl run triggered from dashboard",
        actor=current["username"],
    )

    return {
        "ok": True,
        "message": "Crawl run triggered",
    }


@app.get("/api/crawler/runs")
def list_crawl_runs(limit: int = Query(50, le=200), offset: int = 0, current=Depends(get_current_admin)):
    return _rows(CRAWL_RUN_FIELDS, db.get_crawl_runs(limit, offset))


@app.get("/api/crawler/runs/{run_id}")
def get_crawl_run_detail(run_id: int, current=Depends(get_current_admin)):
    row = _row(CRAWL_RUN_FIELDS, db.get_crawl_run(run_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return row


# ============================================================
# TELEGRAM
# ============================================================

@app.get("/api/telegram/status")
def telegram_status(current=Depends(get_current_admin)):
    return {
        "settings": db.get_settings("telegram."),
        "bot_token_configured": config.BOT_TOKEN_CONFIGURED,
        "subscribers_active": db.get_subscriber_count(),
        "subscribers_total": db.get_total_subscriber_count(),
    }


@app.post("/api/telegram/test")
def telegram_test(body: TelegramTestMessage, current=Depends(get_current_admin)):
    if not config.BOT_TOKEN_CONFIGURED:
        raise HTTPException(status_code=503, detail="BOT_TOKEN is not configured on the server")

    target_chat_id = body.chat_id or db.get_setting("telegram.admin_chat_id")
    if not target_chat_id:
        raise HTTPException(status_code=400, detail="No chat_id provided and telegram.admin_chat_id is not set")

    try:
        # Lazy import: telegram_bot.py reads BOT_TOKEN from the environment
        # at import time, so this is only imported once we know it's set.
        import telegram_bot

        telegram_bot.send_message(int(target_chat_id), body.message)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to send test message: {exc}")

    db.log_activity(
        level="INFO",
        action="telegram.test_message",
        message=f"Test message sent to {target_chat_id}",
        actor=current["username"],
    )
    return {"ok": True}


@app.get("/api/telegram/subscribers")
def telegram_subscribers(current=Depends(get_current_admin)):
    return list_subscribers(is_active=None, limit=100, offset=0, current=current)


# ============================================================
# NOTIFICATIONS
# ============================================================

@app.get("/api/notifications/status")
def notifications_status(current=Depends(get_current_admin)):
    return {
        "settings": db.get_settings("notifications."),
        "queue_counts": db.get_notification_queue_counts(),
    }


@app.get("/api/notifications/queue")
def notifications_queue(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, le=200),
    offset: int = 0,
    current=Depends(get_current_admin),
):
    return _rows(NOTIFICATION_FIELDS, db.get_notification_queue(limit, offset, status_filter))


# ============================================================
# SUBSCRIBERS
# ============================================================

@app.get("/api/subscribers")
def list_subscribers(
    is_active: bool | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    current=Depends(get_current_admin),
):
    rows = db.get_subscribers(limit, offset, is_active)
    total = db.get_subscribers_count(is_active)
    return {"items": _rows(SUBSCRIBER_FIELDS, rows), "total": total, "limit": limit, "offset": offset}


@app.post("/api/subscribers", status_code=201)
def create_subscriber(body: SubscriberCreate, current=Depends(get_current_admin)):
    db.add_subscriber(body.chat_id, body.username, body.first_name)
    db.log_activity(level="INFO", action="subscribers.create", target=str(body.chat_id), message="Subscriber added manually", actor=current["username"])
    return {"ok": True}


@app.patch("/api/subscribers/{chat_id}")
def update_subscriber(chat_id: int, body: SubscriberUpdate, current=Depends(get_current_admin)):
    changed = db.set_subscriber_status(chat_id, body.is_active)
    if not changed:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    db.log_activity(
        level="INFO",
        action="subscribers.update",
        target=str(chat_id),
        message=f"Subscriber set to {'active' if body.is_active else 'inactive'}",
        actor=current["username"],
    )
    return {"ok": True}


@app.delete("/api/subscribers/{chat_id}")
def delete_subscriber(chat_id: int, current=Depends(get_current_admin)):
    deleted = db.delete_subscriber_row(chat_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    db.log_activity(level="WARN", action="subscribers.delete", target=str(chat_id), message="Subscriber deleted", actor=current["username"])
    return {"ok": True}


# ============================================================
# SETTINGS
# ============================================================

@app.get("/api/settings")
def get_settings_route(prefix: str | None = None, current=Depends(get_current_admin)):
    return db.get_settings(prefix)

@app.patch("/api/settings/bulk")
def update_settings_bulk(
    body: SettingsBulkUpdate,
    current=Depends(get_current_admin),
):
    settings = body.settings

    if not settings:
        raise HTTPException(
            status_code=400,
            detail="At least one setting is required",
        )

    for key in settings:
        
        if not isinstance(key, str) or not key.strip():
            raise HTTPException(
                status_code=400,
                detail="Setting keys must be non-empty strings",
            )

        validate_setting(key, settings[key])

        if key.startswith("telegram.") and "token" in key.lower():
            raise HTTPException(
                status_code=400,
                detail="Bot token cannot be set through the settings API",
            )

    db.set_settings(
        settings,
        updated_by=current["username"],
    )

    db.log_activity(
        level="INFO",
        action="settings.bulk_update",
        target="multiple",
        message=f"{len(settings)} settings updated",
        actor=current["username"],
        details={"keys": list(settings.keys())},
    )

    return {
        "ok": True,
        "updated": list(settings.keys()),
    }


@app.patch("/api/settings/{key}")
def update_setting(
    key: str,
    body: SettingUpdate,
    current=Depends(get_current_admin),
):
    validate_setting(key, body.value)

    if key.startswith("telegram.") and "token" in key.lower():
        raise HTTPException(
            status_code=400,
            detail="Bot token cannot be set through the settings API",
        )

    row = db.set_setting(
        key,
        body.value,
        updated_by=current["username"],
    )




# ============================================================
# LOGS
# ============================================================

@app.get("/api/logs")
def list_logs(
    level: str | None = None,
    actor: str | None = None,
    action: str | None = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    current=Depends(get_current_admin),
):
    rows = db.get_activity_logs(limit=limit, offset=offset, level=level, action=action, actor=actor)
    total = db.get_activity_log_count(level=level, action=action)
    return {"items": _rows(LOG_FIELDS, rows), "total": total, "limit": limit, "offset": offset}


# ============================================================
# ADMINS
# ============================================================

@app.get("/api/admins")
def list_admins(current=Depends(get_current_admin)):
    return [_admin_public(_row(ADMIN_FIELDS, r)) for r in db.get_admin_users()]


@app.post("/api/admins", status_code=201)
def create_admin(body: AdminCreate, current=Depends(get_current_admin)):
    if db.get_admin_user(body.username) is not None:
        raise HTTPException(status_code=409, detail="Username already exists")

    admin_id = db.create_admin_user(body.username, hash_password(body.password), body.display_name)
    db.log_activity(level="INFO", action="admins.create", target=body.username, message="Admin created", actor=current["username"])
    return _admin_public(_row(ADMIN_FIELDS, db.get_admin_user_by_id(admin_id)))


@app.patch("/api/admins/{admin_id}")
def update_admin(admin_id: int, body: AdminUpdate, current=Depends(get_current_admin)):
    target = _row(ADMIN_FIELDS, db.get_admin_user_by_id(admin_id))
    if target is None:
        raise HTTPException(status_code=404, detail="Admin not found")

    if body.is_active is False:
        if admin_id == current["id"]:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
        if target["is_active"] and db.get_active_admin_count() <= 1:
            raise HTTPException(status_code=400, detail="Cannot deactivate the last remaining active admin")
        db.set_admin_user_status(admin_id, False)

    if body.is_active is True:
        db.set_admin_user_status(admin_id, True)

    if body.display_name is not None:
        db.update_admin_display_name(admin_id, body.display_name)

    if body.password:
        db.update_admin_password(admin_id, hash_password(body.password))

    db.log_activity(level="INFO", action="admins.update", target=str(admin_id), message="Admin updated", actor=current["username"])
    return _admin_public(_row(ADMIN_FIELDS, db.get_admin_user_by_id(admin_id)))


@app.delete("/api/admins/{admin_id}")
def delete_admin(admin_id: int, current=Depends(get_current_admin)):
    if admin_id == current["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    target = _row(ADMIN_FIELDS, db.get_admin_user_by_id(admin_id))
    if target is None:
        raise HTTPException(status_code=404, detail="Admin not found")
    if target["is_active"] and db.get_active_admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last remaining active admin")

    db.delete_admin_user(admin_id)
    db.log_activity(level="WARN", action="admins.delete", target=str(admin_id), message="Admin deleted", actor=current["username"])
    return {"ok": True}


# ============================================================
# HEALTH
# ============================================================

def _check_systemd_service(name: str) -> str:
    try:
        result = subprocess.run(
            ["systemctl", "is-active", name],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return result.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


@app.get("/api/health")
def health():
    try:
        db.get_result_count()
        postgres_status = "healthy"
    except Exception:
        postgres_status = "unhealthy"

    disk = shutil.disk_usage(str(config.REPO_ROOT))
    disk_free_pct = round(disk.free / disk.total * 100, 1)

    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "postgres": postgres_status,
        "crawler_service": _check_systemd_service("crawler.service"),
        "notification_worker": _check_systemd_service("notification-worker.service"),
        "telegram_bot": _check_systemd_service("telegram-bot.service"),
        "dashboard_api": "healthy",
        "disk_free_percent": disk_free_pct,
    }

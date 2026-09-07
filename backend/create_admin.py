"""
Safe, explicit admin account creation for the dashboard.

Replaces the old backend/app/seed.py demo-data seeding — this script
never touches results/settings/crawl history, and never runs
automatically. It must be invoked deliberately:

    cd backend
    python3 create_admin.py

Run from the backend/ directory (or adjust the path insert below) so
that `app.config` — and through it, the repo-root database.py — resolves.
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import config  # noqa: E402  (adds repo root to sys.path)
from app.security import hash_password  # noqa: E402

import database as db  # noqa: E402


def main():
    print("=== CHARUSAT Dashboard — create admin account ===")
    username = input("Username: ").strip()

    if not username:
        print("Username cannot be empty.")
        sys.exit(1)

    if db.get_admin_user(username) is not None:
        print(f"An admin with username '{username}' already exists.")
        sys.exit(1)

    password = getpass.getpass("Password: ")
    confirm = getpass.getpass("Confirm password: ")

    if password != confirm:
        print("Passwords do not match.")
        sys.exit(1)

    if len(password) < 8:
        print("Password must be at least 8 characters.")
        sys.exit(1)

    display_name = input("Display name (optional): ").strip() or None

    admin_id = db.create_admin_user(username, hash_password(password), display_name)
    db.log_activity(
        level="INFO",
        action="admins.create",
        message=f"Admin '{username}' created via create_admin.py",
        actor="system",
    )

    print(f"Created admin '{username}' (id={admin_id}).")


if __name__ == "__main__":
    main()

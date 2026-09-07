from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config  # noqa: F401  (ensures repo root is on sys.path first)
from .security import decode_access_token

import database as db

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    username = decode_access_token(credentials.credentials)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    row = db.get_admin_user(username)
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found")

    admin = {
        "id": row[0],
        "username": row[1],
        "display_name": row[3],
        "is_active": row[4],
    }

    if not admin["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin account is disabled")

    return admin

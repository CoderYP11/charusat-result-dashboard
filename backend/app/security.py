from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from . import config


_BCRYPT_MAX_BYTES = 72


def _password_bytes(password: str) -> bytes:
    if not isinstance(password, str):
        raise ValueError("Password must be a string.")

    password_bytes = password.encode("utf-8")

    if len(password_bytes) > _BCRYPT_MAX_BYTES:
        raise ValueError(
            "Password must not exceed 72 bytes when encoded as UTF-8."
        )

    return password_bytes


def hash_password(password: str) -> str:
    password_bytes = _password_bytes(password)
    return bcrypt.hashpw(
        password_bytes,
        bcrypt.gensalt(),
    ).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        password_bytes = _password_bytes(password)
        return bcrypt.checkpw(
            password_bytes,
            password_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=config.JWT_EXPIRE_MINUTES
    )

    payload = {
        "sub": subject,
        "exp": expire,
    }

    return jwt.encode(
        payload,
        config.JWT_SECRET_KEY,
        algorithm=config.JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token,
            config.JWT_SECRET_KEY,
            algorithms=[config.JWT_ALGORITHM],
        )

        subject = payload.get("sub")

        if not isinstance(subject, str) or not subject.strip():
            return None

        return subject

    except JWTError:
        return None
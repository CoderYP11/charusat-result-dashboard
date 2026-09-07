from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


_BCRYPT_MAX_BYTES = 72


def _validate_password_bytes(value: str) -> str:
    if len(value.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        raise ValueError("Password must not exceed 72 bytes when encoded as UTF-8.")
    return value


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("Username cannot be empty.")

        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password_bytes(value)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8)
    display_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("Username cannot be empty.")

        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password_bytes(value)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        value = value.strip()
        return value or None


class AdminUpdate(BaseModel):
    is_active: Optional[bool] = None
    display_name: Optional[str] = Field(default=None, max_length=120)
    password: Optional[str] = Field(default=None, min_length=8)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        return _validate_password_bytes(value)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        value = value.strip()
        return value or None


class SettingUpdate(BaseModel):
    value: Any

class SettingsBulkUpdate(BaseModel):
    settings: dict[str, Any]

class SubscriberCreate(BaseModel):
    chat_id: int
    username: Optional[str] = Field(default=None, max_length=255)
    first_name: Optional[str] = Field(default=None, max_length=255)

    @field_validator("username", "first_name")
    @classmethod
    def clean_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        value = value.strip()
        return value or None


class SubscriberUpdate(BaseModel):
    is_active: bool


class TelegramTestMessage(BaseModel):
    chat_id: Optional[int] = None
    message: str = Field(
        default="✅ Test message from the admin dashboard.",
        min_length=1,
        max_length=4096,
    )

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("Message cannot be empty.")

        return value
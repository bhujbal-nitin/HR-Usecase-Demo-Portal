"""What an admin can do: add and change users, and see each user's token usage."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.core.passwords import hash_password
from app.repositories.user_repository import ACCESS_TYPES, ROLES, PortalUser, UserRepository
from app.services.usage_service import UsageService

MIN_PASSWORD_LENGTH = 8


def _check_role(role: str) -> str:
    if role not in ROLES:
        raise ValidationFailedError("The role must be 'admin' or 'user'.")
    return role


def _check_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValidationFailedError(f"The password must be at least {MIN_PASSWORD_LENGTH} characters.")
    return password


def user_view(user: PortalUser) -> dict:
    return {
        "username": user.username,
        "fullName": user.full_name,
        "role": user.role,
        "isActive": user.is_active,
        "isExpired": user.is_expired,
        "accessType": user.access_type or "lifetime",
        "accessDays": user.access_days,
        "firstLoginAt": user.first_login_at.isoformat() if user.first_login_at else None,
        "expiresAt": user.expires_at.isoformat() if user.expires_at else None,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
    }


class UserAdminService:
    def __init__(self, users: UserRepository, usage: UsageService):
        self._users = users
        self._usage = usage

    # ---------------------------------------------------------------- users
    def list_users(self) -> list[dict]:
        return [user_view(u) for u in self._users.list_all()]

    def create(
        self,
        username: str,
        full_name: str,
        password: str,
        role: str,
        access_type: str = "days",
        access_days: int | None = 10,
        expires_at: datetime | None = None,
        must_change_password: bool = False,
    ) -> dict:
        name = username.strip()
        if len(name) < 3 or any(ch.isspace() for ch in name):
            raise ValidationFailedError("The user name must be at least 3 characters, with no spaces.")
        _check_role(role)
        _check_password(password)
        if self._users.get(name) is not None:
            raise ConflictError(f"The user name '{name}' is already taken.")

        if access_type not in ACCESS_TYPES:
            raise ValidationFailedError(f"Access type must be one of: {', '.join(ACCESS_TYPES)}.")

        parsed_days = None
        parsed_expires = None
        if access_type == "days":
            parsed_days = int(access_days) if access_days is not None else 10
            if parsed_days < 1 or parsed_days > 3650:
                raise ValidationFailedError("Access duration must be between 1 and 3650 days.")
        elif access_type == "date":
            if expires_at is None:
                raise ValidationFailedError("An expiration date must be selected for fixed date access.")
            parsed_expires = expires_at
        # lifetime leaves parsed_days and parsed_expires as None

        new_user = PortalUser(
            username=name,
            password_hash=hash_password(password),
            full_name=full_name.strip(),
            is_active=True,
            role=role,
            access_type=access_type,
            access_days=parsed_days,
            first_login_at=None,
            expires_at=parsed_expires,
            must_change_password=must_change_password,
        )
        self._users.save(new_user)
        return user_view(self._users.get(name))

    def update(
        self,
        username: str,
        *,
        full_name: str | None = None,
        role: str | None = None,
        is_active: bool | None = None,
        password: str | None = None,
        access_type: str | None = None,
        access_days: int | None = None,
        expires_at: datetime | None = None,
    ) -> dict:
        current = self._users.get(username)
        if current is None:
            raise NotFoundError(f"User '{username}' was not found.")
        user = replace(current)  # change a copy, so a refused change leaves the stored user as it was
        if full_name is not None:
            user.full_name = full_name.strip()
        if role is not None:
            user.role = _check_role(role)
        if is_active is not None:
            user.is_active = is_active
        if password is not None:
            user.password_hash = hash_password(_check_password(password))

        if access_type is not None:
            if access_type not in ACCESS_TYPES:
                raise ValidationFailedError(f"Access type must be one of: {', '.join(ACCESS_TYPES)}.")
            user.access_type = access_type
            if access_type == "lifetime":
                user.access_days = None
                user.expires_at = None
            elif access_type == "date":
                if expires_at is None and user.expires_at is None:
                    raise ValidationFailedError("An expiration date must be selected for fixed date access.")
                user.access_days = None
                if expires_at is not None:
                    user.expires_at = expires_at
            elif access_type == "days":
                days = int(access_days) if access_days is not None else (user.access_days or 10)
                if days < 1 or days > 3650:
                    raise ValidationFailedError("Access duration must be between 1 and 3650 days.")
                user.access_days = days
                # If the user has already logged in previously, extend their expiration from now
                if user.first_login_at is not None:
                    user.expires_at = datetime.now(timezone.utc) + timedelta(days=days)
                else:
                    user.expires_at = None
        else:
            if access_days is not None and user.access_type == "days":
                days = int(access_days)
                if days < 1 or days > 3650:
                    raise ValidationFailedError("Access duration must be between 1 and 3650 days.")
                user.access_days = days
                if user.first_login_at is not None:
                    user.expires_at = datetime.now(timezone.utc) + timedelta(days=days)
            if expires_at is not None and user.access_type == "date":
                user.expires_at = expires_at

        others = [u for u in self._users.list_all() if u.username.lower() != user.username.lower()]
        if not any(u.is_admin and u.is_active and not u.is_expired for u in others) and not (user.is_admin and user.is_active and not user.is_expired):
            raise ConflictError("There must always be at least one active admin.")
        self._users.save(user)
        return user_view(self._users.get(username))

    # ---------------------------------------------------------------- usage
    def usage_summary(self, days: int | None = None) -> list[dict]:
        """One row per user, including users who have not used the AI yet, then any other names found in the log."""
        totals = {row["username"].lower(): row for row in self._usage.totals(days)}
        rows = []
        for user in self._users.list_all():
            rows.append(self._usage_row(user.username, user.full_name, user.role, user.is_active, totals.pop(user.username.lower(), None)))
        rows.extend(self._usage_row(row["username"], "", None, None, row) for row in totals.values())  # e.g. calls made while login was off
        return sorted(rows, key=lambda r: r["totalTokens"], reverse=True)

    @staticmethod
    def _usage_row(username: str, full_name: str, role: str | None, is_active: bool | None, row: dict | None) -> dict:
        row = row or {}
        last = row.get("last_used")
        return {
            "username": username, "fullName": full_name, "role": role, "isActive": is_active,
            "calls": int(row.get("calls") or 0), "inputTokens": int(row.get("input_tokens") or 0),
            "outputTokens": int(row.get("output_tokens") or 0), "totalTokens": int(row.get("total_tokens") or 0),
            "lastUsed": last.isoformat() if last else None,
        }

    def usage_history(self, username: str | None, limit: int, offset: int) -> dict:
        rows, total = self._usage.history(username, limit, offset)
        items = [
            {
                "id": r["id"], "username": r["username"], "feature": r["feature"], "model": r["model"],
                "inputTokens": r["input_tokens"], "outputTokens": r["output_tokens"], "totalTokens": r["total_tokens"],
                "at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
        return {"items": items, "total": total}

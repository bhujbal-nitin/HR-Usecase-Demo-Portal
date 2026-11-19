"""Admin only: add and change users, and see each user's token usage and the demos they ran."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import ContainerDep
from app.api.routes.auth import COOKIE
from app.repositories.user_repository import PortalUser


def require_admin(request: Request, container: ContainerDep) -> PortalUser:
    return container.auth.require_admin(request.cookies.get(COOKIE))


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class NewUser(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    fullName: str = Field(default="", max_length=200)
    password: str = Field(min_length=1, max_length=500)
    role: str = "user"
    accessType: str = Field(default="days", pattern="^(days|date|lifetime)$")
    accessDays: int | None = Field(default=10, ge=1, le=3650)
    expiresAt: datetime | None = None


class ApproveRequest(BaseModel):
    role: str = "user"
    accessType: str = Field(default="days", pattern="^(days|date|lifetime)$")
    accessDays: int | None = Field(default=13, ge=1, le=3650)
    expiresAt: datetime | None = None


class UserChange(BaseModel):
    fullName: str | None = Field(default=None, max_length=200)
    role: str | None = None
    isActive: bool | None = None
    password: str | None = Field(default=None, max_length=500)
    accessType: str | None = Field(default=None, pattern="^(days|date|lifetime)$")
    accessDays: int | None = Field(default=None, ge=1, le=3650)
    expiresAt: datetime | None = None


@router.get("/users")
def list_users(container: ContainerDep) -> list[dict]:
    return container.user_admin.list_users()


@router.post("/users", status_code=201)
def create_user(data: NewUser, container: ContainerDep) -> dict:
    return container.user_admin.create(
        data.username,
        data.fullName,
        data.password,
        data.role,
        access_type=data.accessType,
        access_days=data.accessDays,
        expires_at=data.expiresAt,
    )


@router.patch("/users/{username}")
def change_user(username: str, data: UserChange, container: ContainerDep) -> dict:
    return container.user_admin.update(
        username,
        full_name=data.fullName,
        role=data.role,
        is_active=data.isActive,
        password=data.password,
        access_type=data.accessType,
        access_days=data.accessDays,
        expires_at=data.expiresAt,
    )


@router.get("/access-requests")
def access_requests(container: ContainerDep) -> list[dict]:
    """People who asked for access on the login page: waiting ones first."""
    return container.access_requests.list_requests()


@router.post("/access-requests/{request_id}/approve")
def approve_request(request_id: int, data: ApproveRequest, request: Request, container: ContainerDep) -> dict:
    """Make the user and e-mail the user name and a generated password to the address they gave."""
    admin = container.auth.require_admin(request.cookies.get(COOKIE))
    return container.access_requests.approve(request_id, admin.username, data.role, data.accessType, data.accessDays, data.expiresAt)


@router.post("/access-requests/{request_id}/reject")
def reject_request(request_id: int, request: Request, container: ContainerDep) -> dict:
    admin = container.auth.require_admin(request.cookies.get(COOKIE))
    return container.access_requests.reject(request_id, admin.username)


@router.get("/usage")
def usage_summary(container: ContainerDep, days: Annotated[int | None, Query(ge=1, le=3650)] = None) -> list[dict]:
    """Calls and tokens per user (all time, or the last ``days`` days)."""
    return container.user_admin.usage_summary(days)


@router.get("/usage/history")
def usage_history(
    container: ContainerDep,
    username: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    """Every AI call, newest first; ``username`` narrows it to one user."""
    return container.user_admin.usage_history(username or None, limit, offset)


@router.get("/demo-runs")
def demo_runs(
    container: ContainerDep,
    username: str | None = None,
    agent: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    """Every demo run, newest first; ``username`` and ``agent`` narrow it."""
    return container.demo_runs.history(username or None, agent or None, limit, offset)

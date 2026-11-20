"""Sign in, sign out, 'who am I' and changing your own password for the portal."""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.api.deps import ContainerDep

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "hr_session"


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=500)


@router.post("/login")
def login(data: LoginRequest, request: Request, response: Response, container: ContainerDep) -> dict:
    auth = container.auth
    _, token = auth.login(data.username, data.password, request.client.host if request.client else "unknown")
    response.set_cookie(
        COOKIE, token, max_age=auth.lifetime_seconds, httponly=True, samesite="lax",
        secure=container.settings.auth_cookie_secure, path="/",
    )
    return auth.describe(token)


class PasswordChange(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=500)
    newPassword: str = Field(min_length=1, max_length=500)


@router.post("/change-password")
def change_password(data: PasswordChange, request: Request, container: ContainerDep) -> dict:
    """The signed-in user changes their own password. Other people's passwords are reset by an admin on the Admin page."""
    container.auth.change_password(
        request.cookies.get(COOKIE), data.currentPassword, data.newPassword, request.client.host if request.client else "unknown"
    )
    return {"changed": True}


class AccessRequest(BaseModel):
    fullName: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=40)
    email: str = Field(min_length=3, max_length=200)
    country: str = Field(min_length=1, max_length=100)


@router.post("/request-access", status_code=202)
def request_access(data: AccessRequest, request: Request, container: ContainerDep) -> dict:
    """From the login page: ask for a portal account. An admin approves or rejects it; the answer is e-mailed."""
    container.access_requests.submit(data.fullName, data.email, request.client.host if request.client else "unknown", data.phone, data.country)
    return {"received": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE, path="/")
    return {"authenticated": False}


@router.get("/me")
def me(request: Request, container: ContainerDep) -> dict:
    return container.auth.describe(request.cookies.get(COOKIE))

"""FastAPI application factory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.routes import documents, employees, hr_policy, leave, offboardings, payroll, reimbursement, system
from app.container import Container, build_container
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.core.exceptions import AppError, IntegrationError, NotFoundError
from app.core.logging_config import configure_logging

logger = logging.getLogger(__name__)
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    configure_logging()
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = container or build_container(settings)
        app.state.container.task_queue.start()
        app.state.container.onboarding.recover_interrupted()
        app.state.container.offboarding.recover_interrupted()
        if settings.approval_poller_enabled:
            app.state.container.poller.start()
        yield
        app.state.container.poller.stop()
        app.state.container.task_queue.stop()

    app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    @app.exception_handler(IntegrationError)
    async def handle_integration_error(_: Request, exc: IntegrationError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = {str(err["loc"][-1]): err["msg"].removeprefix("Value error, ") for err in exc.errors()}
        summary = "; ".join(f"{name}: {msg}" for name, msg in fields.items())
        return JSONResponse(status_code=422, content={"detail": summary or "Invalid request.", "fields": fields})

    app.include_router(system.router, prefix="/api")
    app.include_router(employees.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(offboardings.router, prefix="/api")
    app.include_router(leave.router, prefix="/api")
    app.include_router(payroll.router, prefix="/api")
    app.include_router(reimbursement.router, prefix="/api")
    app.include_router(hr_policy.router, prefix="/api")

    _serve_built_frontend(app)
    return app


def _serve_built_frontend(app: FastAPI) -> None:
    """If ``frontend/dist`` exists (after ``npm run build``) serve it, so one process runs the whole app."""
    if not FRONTEND_DIST.is_dir():
        return
    index = FRONTEND_DIST / "index.html"
    root = FRONTEND_DIST.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise NotFoundError("Unknown API endpoint.")
        candidate = (FRONTEND_DIST / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        if "." in Path(path).name:  # a missing asset (js/css/png...) must 404, not return the HTML shell
            raise NotFoundError("File not found.")
        return FileResponse(index)  # client-side route: let React Router handle it


app = create_app()

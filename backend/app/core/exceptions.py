"""Domain exceptions. API-level translation lives in ``app.main``."""


class AppError(Exception):
    """Base class for expected, user-facing errors."""

    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class ValidationFailedError(AppError):
    status_code = 422


class IntegrationError(Exception):
    """An external system (ServiceNow, AutomationEdge, ...) failed or rejected a call."""

    def __init__(self, system: str, message: str):
        super().__init__(f"{system}: {message}")
        self.system = system
        self.message = message


class IntegrationNotConfiguredError(IntegrationError):
    """Credentials for the external system are missing from the environment."""

    def __init__(self, system: str):
        super().__init__(system, "not configured (set its credentials in .env)")

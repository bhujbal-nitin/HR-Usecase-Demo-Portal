"""FastAPI dependencies."""

from typing import Annotated

from fastapi import Depends, Request

from app.container import Container
from app.core.config import Settings
from app.services.autofill_service import AutofillService
from app.services.health_service import HealthService
from app.services.onboarding_service import OnboardingService
from app.utils.task_queue import TaskQueue


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def get_onboarding_service(container: ContainerDep) -> OnboardingService:
    return container.onboarding


def get_autofill_service(container: ContainerDep) -> AutofillService:
    return container.autofill


def get_health_service(container: ContainerDep) -> HealthService:
    return container.health


def get_task_queue(container: ContainerDep) -> TaskQueue:
    return container.task_queue


def get_app_settings(container: ContainerDep) -> Settings:
    return container.settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
OnboardingDep = Annotated[OnboardingService, Depends(get_onboarding_service)]
AutofillDep = Annotated[AutofillService, Depends(get_autofill_service)]
HealthDep = Annotated[HealthService, Depends(get_health_service)]
TaskQueueDep = Annotated[TaskQueue, Depends(get_task_queue)]

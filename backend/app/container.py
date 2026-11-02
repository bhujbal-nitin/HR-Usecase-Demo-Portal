"""Composition root: builds every long-lived object once and wires them together."""

from dataclasses import dataclass

from app.core.config import Settings, get_settings
from app.integrations.automationedge import AutomationEdgeClient
from app.integrations.km import KnowledgeBaseClient
from app.integrations.mailer import Mailer
from app.integrations.office365 import Office365Client
from app.integrations.openai_documents import OpenAIDocumentReader
from app.integrations.orangehrm import OrangeHRMClient
from app.integrations.servicenow import ServiceNowClient
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.leave_repository import LeaveRepository
from app.repositories.offboarding_repository import OffboardingRepository
from app.repositories.reimbursement_repository import ReimbursementRepository
from app.services.approval_poller import ApprovalPoller
from app.services.autofill_service import AutofillService
from app.services.document_store import DocumentStore
from app.services.document_verification_service import DocumentVerificationService
from app.services.health_service import HealthService
from app.services.hr_documents import HrDocuments
from app.services.hr_policy_service import HrPolicyService
from app.services.leave_service import LeaveGateways, LeaveService
from app.services.employee_directory import EmployeeDirectory
from app.services.offboarding.relieving_letter_service import RelievingLetterService
from app.services.offboarding.steps import OffboardingGateways
from app.services.offboarding_service import OffboardingService
from app.services.onboarding_service import OnboardingService
from app.services.payroll_service import PayrollService
from app.services.reimbursement.bill_reader import BillReader
from app.services.reimbursement_service import ReimbursementGateways, ReimbursementService
from app.services.pipeline.context import Gateways
from app.services.pipeline.runner import ProvisioningRunner
from app.utils.task_queue import TaskQueue


@dataclass
class Container:
    settings: Settings
    repository: EmployeeRepository
    task_queue: TaskQueue
    onboarding: OnboardingService
    offboarding: OffboardingService
    leave: LeaveService
    payroll: PayrollService
    reimbursement: ReimbursementService
    hr_policy: HrPolicyService
    autofill: AutofillService
    health: HealthService
    automationedge: AutomationEdgeClient
    document_verification: DocumentVerificationService
    poller: ApprovalPoller


def build_container(settings: Settings | None = None) -> Container:
    settings = settings or get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    servicenow = ServiceNowClient(settings)
    automationedge = AutomationEdgeClient(settings)
    office365 = Office365Client(settings)
    orangehrm = OrangeHRMClient(settings)
    mailer = Mailer(settings)

    repository = EmployeeRepository(settings.employees_file)
    task_queue = TaskQueue(settings.task_queue_workers)
    gateways = Gateways(
        settings=settings,
        servicenow=servicenow,
        automationedge=automationedge,
        office365=office365,
        orangehrm=orangehrm,
        documents=DocumentStore(settings.uploads_dir, settings.max_upload_bytes),
    )
    onboarding = OnboardingService(repository, gateways, ProvisioningRunner(repository), task_queue)

    offboardings = OffboardingRepository(settings.offboardings_file)
    offboarding = OffboardingService(
        offboardings,
        repository,
        OffboardingGateways(
            settings=settings, servicenow=servicenow, automationedge=automationedge, office365=office365, orangehrm=orangehrm, mailer=mailer,
            letters=RelievingLetterService(settings, mailer),
        ),
        task_queue,
    )

    leave = LeaveService(LeaveRepository(settings.leave_requests_file), repository, LeaveGateways(settings=settings, orangehrm=orangehrm), offboardings)

    directory = EmployeeDirectory(repository, orangehrm, offboardings)
    payroll = PayrollService(directory, orangehrm)
    document_reader = OpenAIDocumentReader(settings)
    reimbursement = ReimbursementService(
        ReimbursementRepository(settings.reimbursement_claims_file), directory,
        ReimbursementGateways(settings=settings, orangehrm=orangehrm, bills=BillReader(document_reader)),
    )

    hr_policy = HrPolicyService(directory, KnowledgeBaseClient(settings), HrDocuments(settings.hr_documents_dir))

    return Container(
        settings=settings,
        repository=repository,
        task_queue=task_queue,
        onboarding=onboarding,
        offboarding=offboarding,
        leave=leave,
        payroll=payroll,
        reimbursement=reimbursement,
        hr_policy=hr_policy,
        autofill=AutofillService(repository, orangehrm),
        automationedge=automationedge,
        document_verification=DocumentVerificationService(settings, document_reader),
        health=HealthService(
            {
                "servicenow": (servicenow.is_configured, servicenow.check_connection),
                "automationedge": (automationedge.is_configured, automationedge.check_connection),
                "office365": (office365.is_configured, office365.check_connection),
                "orangehrm": (orangehrm.is_configured, orangehrm.check_connection),
            }
        ),
        poller=ApprovalPoller(onboarding, settings.approval_poll_interval_seconds),
    )

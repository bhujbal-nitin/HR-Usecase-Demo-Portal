"""Composition root: builds every long-lived object once and wires them together."""

from dataclasses import dataclass, field

from app.core.config import Settings, get_settings
from app.integrations.automationedge import AutomationEdgeClient
from app.integrations.km import KnowledgeBaseClient
from app.integrations.mailer import Mailer
from app.integrations.office365 import Office365Client
from app.integrations.gemini_documents import GeminiDocumentReader
from app.hrms.service import HrmsService
from app.hrms.store import HrmsStore, PgHrmsCollection
from app.integrations.orangehrm import OrangeHRMClient
from app.integrations.servicenow import ServiceNowClient
from app.repositories.database import Database
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.leave_repository import LeaveRepository
from app.repositories.offboarding_repository import OffboardingRepository
from app.repositories.pg_store import (
    PgEmployeeRepository,
    PgLeaveRepository,
    PgOffboardingRepository,
    PgPreOnboardingRepository,
    PgReimbursementRepository,
)
from app.repositories.preonboarding_repository import PreOnboardingRepository
from app.repositories.reimbursement_repository import ReimbursementRepository
from app.repositories.access_request_repository import PostgresAccessRequestRepository
from app.repositories.demo_run_repository import NoDemoRunRepository, PostgresDemoRunRepository
from app.repositories.usage_repository import NoUsageRepository, PostgresUsageRepository
from app.repositories.user_repository import PostgresUserRepository
from app.services.approval_poller import ApprovalPoller
from app.services.auth_service import AuthService
from app.services.autofill_service import AutofillService
from app.services.document_store import DocumentStore
from app.services.document_verification_service import DocumentVerificationService
from app.services.health_service import CheckDef, HealthService
from app.services.hr_documents import HrDocuments
from app.services.hr_policy_service import HrPolicyService
from app.services.leave_service import LeaveGateways, LeaveService
from app.services.employee_directory import EmployeeDirectory
from app.services.offboarding.relieving_letter_service import RelievingLetterService
from app.services.offboarding.steps import OffboardingGateways
from app.services.offboarding_service import OffboardingService
from app.services.onboarding_service import OnboardingService
from app.services.payroll_service import PayrollService
from app.services.preonboarding_service import PreOnboardingGateways, PreOnboardingService
from app.services.reimbursement.bill_reader import BillReader
from app.services.access_request_service import AccessRequestService
from app.services.demo_run_service import DemoRunService
from app.services.usage_service import UsageService
from app.services.user_admin_service import UserAdminService
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
    preonboarding: PreOnboardingService
    hr_policy: HrPolicyService
    autofill: AutofillService
    health: HealthService
    automationedge: AutomationEdgeClient
    document_verification: DocumentVerificationService
    poller: ApprovalPoller
    auth: AuthService
    user_admin: UserAdminService
    usage: UsageService
    demo_runs: DemoRunService
    access_requests: AccessRequestService
    hrms: HrmsService
    stores: list = field(default_factory=list)  # record lists kept in the database; prepared (tables, one-time import) at start-up


def build_container(settings: Settings | None = None) -> Container:
    settings = settings or get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    servicenow = ServiceNowClient(settings)
    automationedge = AutomationEdgeClient(settings)
    office365 = Office365Client(settings)
    orangehrm = OrangeHRMClient(settings)
    mailer = Mailer(settings)

    db = Database(settings)
    use_database = settings.storage_backend.strip().lower() == "postgres"
    if use_database:
        repository = PgEmployeeRepository(db, settings.employees_file)
        offboardings = PgOffboardingRepository(db, settings.offboardings_file)
        leave_repository = PgLeaveRepository(db, settings.leave_requests_file)
        claims = PgReimbursementRepository(db, settings.reimbursement_claims_file)
        pre_candidates = PgPreOnboardingRepository(db, settings.preonboarding_file)
        hrms_collection = PgHrmsCollection(db)
        hrms_store = HrmsStore(collection=hrms_collection)
        stores = [repository, offboardings, leave_repository, claims, pre_candidates, hrms_collection]
    else:
        repository = EmployeeRepository(settings.employees_file)
        offboardings = OffboardingRepository(settings.offboardings_file)
        leave_repository = LeaveRepository(settings.leave_requests_file)
        claims = ReimbursementRepository(settings.reimbursement_claims_file)
        pre_candidates = PreOnboardingRepository(settings.preonboarding_file)
        hrms_store = HrmsStore(path=settings.hrms_file)
        stores = []

    users = PostgresUserRepository(db)
    # Token tracking needs the database: with neither login nor database storage there is nothing to record it in.
    usage = UsageService(PostgresUsageRepository(db) if (use_database or settings.auth_enabled) else NoUsageRepository())
    demo_runs = DemoRunService(PostgresDemoRunRepository(db) if (use_database or settings.auth_enabled) else NoDemoRunRepository())
    user_admin = UserAdminService(users, usage)
    access_requests = AccessRequestService(
        settings, PostgresAccessRequestRepository(db) if (use_database or settings.auth_enabled) else None, users, user_admin, mailer
    )
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

    offboarding = OffboardingService(
        offboardings,
        repository,
        OffboardingGateways(
            settings=settings, servicenow=servicenow, automationedge=automationedge, office365=office365, orangehrm=orangehrm, mailer=mailer,
            letters=RelievingLetterService(settings, mailer),
        ),
        task_queue,
    )

    leave = LeaveService(leave_repository, repository, LeaveGateways(settings=settings, orangehrm=orangehrm), offboardings)

    directory = EmployeeDirectory(repository, orangehrm, offboardings)
    payroll = PayrollService(directory, orangehrm)
    document_reader = GeminiDocumentReader(settings, usage)
    reimbursement = ReimbursementService(
        claims, directory,
        ReimbursementGateways(settings=settings, orangehrm=orangehrm, bills=BillReader(document_reader)),
    )

    preonboarding = PreOnboardingService(
        pre_candidates, PreOnboardingGateways(settings=settings, servicenow=servicenow, reader=document_reader, mailer=mailer)
    )

    km = KnowledgeBaseClient(settings)
    hr_policy = HrPolicyService(directory, km, HrDocuments(settings.hr_documents_dir))

    return Container(
        settings=settings,
        repository=repository,
        task_queue=task_queue,
        onboarding=onboarding,
        offboarding=offboarding,
        leave=leave,
        payroll=payroll,
        reimbursement=reimbursement,
        preonboarding=preonboarding,
        hr_policy=hr_policy,
        autofill=AutofillService(repository, orangehrm),
        automationedge=automationedge,
        document_verification=DocumentVerificationService(settings, document_reader),
        health=HealthService(
            {
                "orangehrm": CheckDef(
                    name="HRMS",
                    is_configured=orangehrm.is_configured,
                    check=orangehrm.check_connection,
                    endpoint=orangehrm.base_url,
                    identity=settings.hrms_admin_username,
                ),
                "servicenow": CheckDef(
                    name="ServiceNow",
                    is_configured=servicenow.is_configured,
                    check=servicenow.check_connection,
                    endpoint=servicenow.instance_url,
                    identity=settings.sn_username,
                ),
                "automationedge": CheckDef(
                    name="AutomationEdge Engine",
                    is_configured=automationedge.is_configured,
                    check=automationedge.check_connection,
                    endpoint=settings.ae_server_url,
                    identity=f"{settings.ae_org_code} / {settings.ae_username}" if settings.ae_org_code else settings.ae_username,
                ),
                "office365": CheckDef(
                    name="Microsoft 365 / Entra ID",
                    is_configured=office365.is_configured,
                    check=office365.check_connection,
                    endpoint="https://graph.microsoft.com",
                    identity=settings.o365_default_domain or settings.o365_client_id,
                ),
                "gemini": CheckDef(
                    name="Google Gemini (Vertex AI)",
                    is_configured=document_reader.is_configured,
                    check=document_reader.check_connection,
                    endpoint=f"Vertex AI ({settings.google_location}) · {settings.gemini_model}",
                    identity=settings.google_project_id or "(from service-account.json)",
                ),
                "knowledge_base": CheckDef(
                    name="AE Knowledge Base",
                    is_configured=km.is_configured,
                    check=km.check_connection,
                    endpoint=settings.km_base_url,
                    identity=settings.km_project_id,
                ),
                "database": CheckDef(
                    name="PostgreSQL Database",
                    is_configured=db.is_configured,
                    check=db.check_connection,
                    endpoint=f"{settings.pg_host}:{settings.pg_port}/{settings.pg_database}" if db.is_configured() else "",
                    identity=settings.pg_user,
                ),
                "mailer": CheckDef(
                    name="SMTP Mailer",
                    is_configured=mailer.is_configured,
                    check=mailer.check_connection,
                    endpoint=f"{settings.smtp_server}:{settings.smtp_port}" if mailer.is_configured() else "",
                    identity=settings.smtp_username,
                ),
            }
        ),
        poller=ApprovalPoller(onboarding, settings.approval_poll_interval_seconds),
        auth=AuthService(settings, users),
        user_admin=user_admin,
        usage=usage,
        demo_runs=demo_runs,
        access_requests=access_requests,
        hrms=HrmsService(settings, hrms_store, repository.list_all),
        stores=stores,
    )

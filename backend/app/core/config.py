"""Application settings, loaded once from environment variables / the ``.env`` file."""

from functools import lru_cache
import os
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # HR_ENV_FILE lets a run (e.g. UI testing) point at a different, credential-free env file.
        env_file=os.environ.get("HR_ENV_FILE") or BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Application ----------------------------------------------------
    app_name: str = "HR Demo Portal - Onboarding API"
    app_env: str = "development"
    host: str = "127.0.0.1"
    port: int = 8080
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    verify_ssl: bool = True

    # --- Storage --------------------------------------------------------
    data_dir: Path = BACKEND_DIR / "data"
    offers_dir: Path = BACKEND_DIR / "generated_offers"
    max_upload_bytes: int = 10 * 1024 * 1024

    # --- ServiceNow -----------------------------------------------------
    sn_instance_url: str = ""
    sn_username: str = ""
    sn_password: SecretStr = SecretStr("")
    sn_catalog_item_sys_id: str = ""

    # --- AutomationEdge T4 ----------------------------------------------
    ae_server_url: str = "https://t4.automationedge.com/aeengine"
    ae_org_code: str = ""
    ae_username: str = ""
    ae_password: SecretStr = SecretStr("")
    ae_user_id: str = ""
    ae_source: str = "AutomationEdge HelpDesk"
    ae_workflow_get_emp_details: str = "HR Demo Get Employee Details"
    ae_workflow_management_approval: str = "HR Demo Management Approval"
    ae_workflow_create_ad_account: str = "HR Demo AD user creation and Assign role"
    ae_workflow_o365_user_creation: str = "HR Demo O365 User Creation"
    ae_workflow_add_emp_orangehrm: str = "HR Demo Add emp OrangeHRM"
    ae_workflow_create_laptop_request: str = "HR Demo Create Laptop Request"
    ae_workflow_send_mail: str = "HR Demo Send mail"
    ae_workflow_document_verification: str = "HR Demo Document Verification"
    # Offboarding workflows (each must reach 'Complete' before the next step starts)
    ae_workflow_get_exit_details: str = "HR Demo Get Exit Details"
    ae_workflow_exit_management_approval: str = "HR Demo Exit Management Approval"
    ae_workflow_ad_user_disable: str = "HR Demo AD user disable"
    ae_workflow_o365_user_offboarding: str = "HR Demo O365 User Offboarding"
    ae_workflow_terminate_emp_orangehrm: str = "HR Demo Terminate emp OrangeHRM"
    ae_workflow_asset_return_request: str = "HR Demo Asset Return Request"
    ae_workflow_exit_clearance: str = "HR Demo Exit Clearance"
    ae_workflow_send_mail_offboarding: str = "HR Demo Send mail Offboarding"
    # Leave & attendance workflows (showcase runs: no inputs, nothing returned; the portal's backend does the real work)
    ae_workflow_leave_balance: str = "HR Demo Get Leave Balance"
    ae_workflow_leave_check: str = "HR Demo Check Leave Request"
    ae_workflow_assign_leave: str = "HR Demo Assign Leave OrangeHRM"
    ae_workflow_attendance_records: str = "HR Demo Get Attendance Records"
    ae_workflow_punch_in: str = "HR Demo Add Punch In OrangeHRM"
    ae_workflow_punch_out: str = "HR Demo Punch Out OrangeHRM"
    # How long to wait for ONE workflow to reach 'Complete' before treating it as failed.
    ae_workflow_timeout_seconds: int = 180

    # --- Microsoft 365 --------------------------------------------------
    o365_tenant_id: str = ""
    o365_client_id: str = ""
    o365_client_secret: SecretStr = SecretStr("")
    o365_default_domain: str = ""
    o365_refresh_token: SecretStr = SecretStr("")

    # --- OrangeHRM ------------------------------------------------------
    orangehrm_base_url: str = ""
    orangehrm_username: str = ""
    orangehrm_password: SecretStr = SecretStr("")

    # --- Outbound mail --------------------------------------------------
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_sender_name: str = "HR Onboarding"
    hr_notification_recipient: str = ""

    # --- Offer letter branding ------------------------------------------
    company_name: str = "AutomationEdge HR suite"
    company_address: str = "100 Innovation Way, Suite 500, San Francisco, CA 94105"
    offer_signatory_name: str = "Elena Vance"
    offer_signatory_title: str = "Global Head of Talent Acquisition"

    # --- OpenAI (document verification in the agent demo's manual live mode) -----
    # Leave the key empty to switch the check off; uploaded documents are then only attached, not read.
    openai_api_key: SecretStr = SecretStr("")
    openai_model: str = "gpt-4o"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_timeout_seconds: int = 90
    # How alike two names must be (0-1) to count as the same person; handles case, punctuation and a missing middle name.
    document_name_match_threshold: float = 0.85

    # --- Background jobs ------------------------------------------------
    approval_poller_enabled: bool = True
    approval_poll_interval_seconds: int = 25
    task_queue_workers: int = 3

    # --- Agent demo pacing (read by the front end via GET /api/demo-config) ------
    # STEP_SCALE multiplies how long each step / typing animation takes (1 = default, 2 = twice as slow).
    # MESSAGE_GAP_MS is the pause after each chat message; PHASE_GAP_MS the pause between phases.
    demo_simulated_step_scale: float = 1.5
    demo_simulated_message_gap_ms: int = 800
    demo_simulated_phase_gap_ms: int = 1500
    # How long the simulated HR approval waits before approving itself (the viewer can click Approve earlier).
    demo_simulated_approval_wait_ms: int = 8000
    demo_live_step_scale: float = 1.5
    demo_live_message_gap_ms: int = 800
    demo_live_phase_gap_ms: int = 1500

    # --- Leave & attendance ---------------------------------------------------
    # The time zone sent with punches added in OrangeHRM (it must be one OrangeHRM knows, with its UTC offset in hours).
    orangehrm_timezone_name: str = "Asia/Kolkata"
    orangehrm_timezone_offset: float = 5.5

    # --- Offboarding ----------------------------------------------------------
    offboarding_notice_period_days: int = 30
    # Share of the monthly gross that is "basic"; leave is encashed at the basic daily rate.
    offboarding_basic_share: float = 0.5

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def offboardings_file(self) -> Path:
        return self.data_dir / "offboardings.json"

    @property
    def leave_requests_file(self) -> Path:
        return self.data_dir / "leave_requests.json"

    @property
    def employees_file(self) -> Path:
        return self.data_dir / "employees.json"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()

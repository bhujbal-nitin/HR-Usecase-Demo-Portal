"""HR policy & documents endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse

from app.api.deps import ContainerDep
from app.api.workflow_runs import run_showcase_workflow
from app.schemas.hr_policy import AskRequest, Letter, Policy, PolicyAnswer
from app.schemas.leave import LeaveWorkflowRun
from app.schemas.offboarding import EmployeeSummary
from app.services.hr_policy_service import HrPolicyService

router = APIRouter(prefix="/hr-policy", tags=["hr-policy"])

Ref = Annotated[str, Query(min_length=3, max_length=120, description="Employee ID or e-mail address")]
WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# The URL key of each showcase workflow -> the AutomationEdge client method that runs it.
_WORKFLOWS = {
    "search-policy": "search_policy",
    "get-policy": "get_policy_document",
    "ask-question": "ask_policy_question",
    "address-proof-letter": "generate_address_proof_letter",
    "bank-account-letter": "generate_bank_account_letter",
}


def get_hr_policy_service(container: ContainerDep) -> HrPolicyService:
    return container.hr_policy


HrPolicyDep = Annotated[HrPolicyService, Depends(get_hr_policy_service)]


@router.get("/lookup", response_model=EmployeeSummary)
def lookup(service: HrPolicyDep, ref: Ref):
    """Recognise an onboarded employee by Employee ID or e-mail (404 if unknown)."""
    return service.lookup(ref)


@router.post("/ask", response_model=PolicyAnswer)
def ask(data: AskRequest, service: HrPolicyDep):
    """Answer a policy question from the knowledge base. Without ``KM_PROJECT_ID`` / ``KM_PROJECT_SECRET`` this answers 502."""
    return service.ask(data)


@router.get("/policies", response_model=list[Policy])
def search_policies(service: HrPolicyDep, query: Annotated[str, Query(max_length=200, description="Words to look for in the policy names; empty lists every policy")] = ""):
    """The policy documents whose name matches the query, best match first (all of them for an empty query)."""
    return service.search_policies(query)


@router.get("/policies/{key}/download")
def download_policy(key: str, service: HrPolicyDep):
    """The policy PDF as it is kept in the policies folder."""
    path = service.policy_file(key)
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/letters", response_model=list[Letter])
def letters(service: HrPolicyDep, ref: Annotated[str | None, Query(min_length=3, max_length=120, description="Employee ID or e-mail address")] = None):
    """The letters that can be asked for, and whether their templates have been placed in the HR documents folder yet.

    With ``ref`` the file names are the ones that employee's copies will have.
    """
    return service.letters(ref)


@router.get("/letters/{key}/download")
def download_letter(key: str, service: HrPolicyDep, ref: Ref):
    """The letter made for the employee: the Word template with their name, code, designation and dates filled in (404 if the template is missing)."""
    filename, content = service.letter_file(ref, key)
    return Response(content, media_type=WORD, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/workflows/{key}", response_model=LeaveWorkflowRun)
def run_workflow(key: str, container: ContainerDep):
    """Run one of the AutomationEdge showcase workflows and wait until it finishes (the portal's own calls do the real work)."""
    return run_showcase_workflow(container, _WORKFLOWS, key)

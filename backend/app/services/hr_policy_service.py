"""Use-cases for HR policy & documents: asking a policy question, and getting a letter."""

from datetime import date
from pathlib import Path

from app.core.exceptions import ValidationFailedError
from app.integrations.km import KnowledgeBaseClient
from app.schemas.hr_policy import AskRequest, Letter, Policy, PolicyAnswer
from app.schemas.offboarding import EmployeeSummary
from app.services.employee_directory import EmployeeDirectory
from app.services.hr_documents import HrDocuments
from app.services.hr_letters import fill_letter, values_for


class HrPolicyService:
    def __init__(self, directory: EmployeeDirectory, knowledge: KnowledgeBaseClient, documents: HrDocuments):
        self._dir = directory
        self._km = knowledge
        self._documents = documents

    def lookup(self, ref: str) -> EmployeeSummary:
        return self._dir.summary(self._dir.find(ref, "HR records"))

    def ask(self, data: AskRequest) -> PolicyAnswer:
        """Answer a policy question from the knowledge base; the earlier questions of the chat are sent along so a follow-up is understood."""
        if not data.question.strip():
            raise ValidationFailedError("Type your question.")
        result = self._km.ask(data.question, [(t.question, t.answer) for t in data.history])
        return PolicyAnswer(answer=result["answer"], sources=result["sources"])

    def search_policies(self, query: str) -> list[Policy]:
        """The policies that match the words of the query (all of them when the query says nothing)."""
        return self._documents.search_policies(query)

    def policy_file(self, key: str) -> Path:
        return self._documents.policy_path(key)

    def letters(self, ref: str | None = None) -> list[Letter]:
        """The letters on offer; with ``ref`` the file names are the ones that employee's copies will have."""
        employee = self._dir.find(ref, "HR records") if ref else None
        return self._documents.letters(employee.full_name if employee else None)

    def letter_file(self, ref: str, key: str) -> tuple[str, bytes]:
        """(file name, content) of the letter made for a known employee: the template with the employee's details filled in."""
        employee = self._dir.find(ref, "HR records")
        template = self._documents.template_of(key).read_bytes()
        return self._documents.download_name(key, employee.full_name), fill_letter(template, values_for(employee, date.today()))

"""HR policy & documents schemas: a question and its answer, and the letters an employee can ask for."""

from pydantic import Field, field_validator

from app.schemas.common import CamelModel


class Turn(CamelModel):
    """An earlier question of this chat and the answer it got."""

    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(max_length=4000)


class AskRequest(CamelModel):
    question: str = Field(min_length=2, max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=10)  # the last questions and answers, oldest first

    @field_validator("question")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class PolicyAnswer(CamelModel):
    answer: str
    sources: list[str]  # the policy documents the answer came from


class Policy(CamelModel):
    """One policy document in the policies folder."""

    key: str  # a URL-safe name made from the file name
    title: str  # the file name without its extension
    file_name: str


class Letter(CamelModel):
    key: str  # address-proof | bank-account
    title: str
    available: bool  # false until the file has been placed in the HR documents folder
    file_name: str | None = None

"""Reads one bill (a PDF or a photo) with OpenAI: its category, date, amount and vendor."""

import logging
from datetime import date

from app.core.exceptions import ValidationFailedError
from app.integrations.openai_documents import OpenAIDocumentReader
from app.schemas.reimbursement import ExpenseItem
from app.services.reimbursement import policy

logger = logging.getLogger(__name__)

ACCEPTED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".webp")

_PROMPT = """You are an Expense Management Assistant. The attached file is one expense document (invoice, receipt or bill) to be reimbursed.
Answer ONLY with a JSON object with exactly these keys:
{
  "expenseType": one of "Travel", "Food", "Mobile", "Stay", "Medical", "Others",
  "date": the printed date of the expense as YYYY-MM-DD, or null if none is printed,
  "amount": the final amount due on the bill as a number (no currency symbol, no thousands separator), or null if it cannot be read,
  "vendor": the business or service provider name, or null,
  "readable": true if the bill is clear enough to read reliably, otherwise false,
  "issues": a list of short plain-English problems you noticed (blurry, cropped, not a bill, ...), empty if none
}
Classify the expense type by the primary nature of the expense:
- Travel: Ola, Uber, bus, train or flight tickets and receipts, vehicle rent receipts, petrol, diesel and gas receipts.
- Food: any food bill from a restaurant or food outlet.
- Mobile: monthly or yearly mobile recharge bills from mobile service providers.
- Stay: hotel or room stay bills and receipts.
- Medical: medical bills.
- Others: anything other than the above.
If the bill mixes items, use the category with the highest amount contribution.
Never guess a value that is not printed; use null instead. Dates on Indian documents are usually DD/MM/YYYY: convert them to YYYY-MM-DD."""


def _date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


def _amount(value: object) -> float | None:
    try:
        number = round(float(str(value).replace(",", "")), 2)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


class BillReader:
    def __init__(self, reader: OpenAIDocumentReader):
        self._reader = reader

    @property
    def enabled(self) -> bool:
        return self._reader.is_configured()

    def read(self, filename: str, content: bytes, content_type: str | None) -> ExpenseItem:
        """The bill's details. Raises ValidationFailedError (with a plain message) if the file is not a readable bill."""
        if not filename.lower().endswith(ACCEPTED_EXTENSIONS):
            raise ValidationFailedError("Please upload the bill as a PDF or a photo (PNG, JPG or WEBP).")
        answer = self._reader.read(filename, content, content_type, prompt=_PROMPT)

        amount = _amount(answer.get("amount"))
        issues = "; ".join(str(i) for i in (answer.get("issues") or [])[:3])
        if not answer.get("readable", True) or amount is None:
            detail = f" {issues}" if issues else ""
            raise ValidationFailedError(f"I could not read the amount on this bill, so it can’t be added.{detail} Please upload a clearer copy.")

        expense_type = policy.normalise_type(answer.get("expenseType"))
        logger.info("Bill read: type=%s within_policy=%s", expense_type, policy.within_policy(expense_type))  # never log amounts or vendors
        return ExpenseItem(
            file_name=filename, expense_type=expense_type, date=_date(answer.get("date")), amount=amount,
            vendor=(str(answer.get("vendor") or "").strip() or "Unknown vendor")[:120], within_policy=policy.within_policy(expense_type),
        )

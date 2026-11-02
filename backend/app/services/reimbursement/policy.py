"""The reimbursement rules: the expense categories, which of them are within the company policy, and the totals."""

from app.schemas.reimbursement import ExpenseItem

# What a bill can be classified as. Anything else is "Others".
EXPENSE_TYPES = ("Travel", "Food", "Mobile", "Stay", "Medical", "Others")
POLICY_TYPES = ("Travel", "Food")  # the types the company's policy reimburses; a hint to the manager, who can approve any bill

CURRENCY = "INR"
MAX_BILLS = 20  # per claim


def normalise_type(value: object) -> str:
    """The category as one of EXPENSE_TYPES (case does not matter); anything unknown is "Others"."""
    text = str(value or "").strip().lower()
    return next((t for t in EXPENSE_TYPES if t.lower() == text), "Others")


def within_policy(expense_type: str) -> bool:
    return expense_type in POLICY_TYPES


def total(items: list[ExpenseItem]) -> float:
    return round(sum(i.amount for i in items), 2)

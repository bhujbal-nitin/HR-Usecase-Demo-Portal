"""OrangeHRM 5.x Claim calls (the same web-session /api/v2 API the OrangeHRM screens use).

Mixed into ``OrangeHRMClient`` next to the leave calls; it relies on ``_leave_call`` from ``LeaveAttendanceMixin``.
Paths and field names follow the OrangeHRM 5 source (orangehrmClaimPlugin).
"""

from datetime import date

from app.core.exceptions import IntegrationError

SYSTEM = "OrangeHRM"


def _as_list(data) -> list[dict]:
    return data if isinstance(data, list) else []


class ClaimMixin:
    # ------------------------------------------------------------ set-up (events and expense types)
    def claim_events(self) -> list[dict]:
        """[{id, name}] for every claim event that is set up."""
        data = self._leave_call("GET", "claim/events", params={"limit": 100}).get("data")
        return [{"id": e["id"], "name": e["name"]} for e in _as_list(data) if "id" in e and not e.get("deleted")]

    def create_claim_event(self, name: str) -> int:
        """Create an active claim event and return its id."""
        body = self._leave_call("POST", "claim/events", json={"name": name, "description": "", "status": True})
        return self._new_id(body, f"the claim event '{name}'")

    def claim_expense_types(self) -> list[dict]:
        """[{id, name}] for every expense type that is set up."""
        data = self._leave_call("GET", "claim/expenses/types", params={"limit": 100}).get("data")
        return [{"id": t["id"], "name": t["name"]} for t in _as_list(data) if "id" in t and not t.get("deleted")]

    def create_claim_expense_type(self, name: str) -> int:
        """Create an active expense type and return its id."""
        body = self._leave_call("POST", "claim/expenses/types", json={"name": name, "description": "", "status": True})
        return self._new_id(body, f"the expense type '{name}'")

    # ------------------------------------------------------------------------------------- the claim
    def assign_claim(self, emp_number: int, event_id: int, currency: str, remarks: str) -> int:
        """Create a claim for the employee (OrangeHRM's 'Assign Claim') and return its id."""
        body = self._leave_call("POST", f"claim/employees/{emp_number}/requests", json={
            "claimEventId": event_id, "currencyId": currency, "remarks": remarks[:250],
        })
        return self._new_id(body, "the claim")

    def add_claim_expense(self, claim_id: int, expense_type_id: int, day: date, amount: float, note: str) -> None:
        """Add one expense to the claim."""
        self._leave_call("POST", f"claim/requests/{claim_id}/expenses", json={
            "expenseTypeId": expense_type_id, "date": day.isoformat(), "amount": f"{amount:.2f}", "note": note[:250],
        })

    def submit_claim(self, claim_id: int) -> None:
        """Move the claim from Initiated to Submitted."""
        self._leave_call("PUT", f"claim/requests/{claim_id}/action", json={"action": "SUBMIT"})

    def claim_url(self, claim_id: int) -> str:
        return f"{self.base_url}/web/index.php/claim/assignClaim/id/{claim_id}"

    @staticmethod
    def _new_id(body: dict, what: str) -> int:
        new_id = (body.get("data") or {}).get("id")
        if not new_id:
            raise IntegrationError(SYSTEM, f"OrangeHRM did not return an id for {what}.")
        return new_id

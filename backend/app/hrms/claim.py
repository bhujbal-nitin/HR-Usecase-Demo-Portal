"""Claim: events, expense types, claims with their expenses and the status flow Initiated -> Submitted -> Approved/Rejected -> Paid."""

from datetime import date

from app.hrms import pim
from app.hrms.common import CURRENCIES, HrmsError, invalid, next_id, not_found, paged, text, to_amount, to_date, to_int

# action -> (statuses it may start from, status it leads to)
_ACTIONS = {
    "SUBMIT": ({"Initiated"}, "Submitted"), "APPROVE": ({"Submitted"}, "Approved"), "REJECT": ({"Submitted"}, "Rejected"),
    "PAY": ({"Approved"}, "Paid"), "CANCEL": ({"Initiated", "Submitted"}, "Canceled"),
}


# -------------------------------------------------------------------------- events and expense types
def setup_list(state: dict, key: str, params) -> tuple[list[dict], dict]:
    return paged([i for i in state[key] if not i["deleted"]], params)


def add_setup(state: dict, key: str, body: dict) -> dict:
    name = text(body, "name", required=True, max_len=100)
    if any(i["name"].lower() == name.lower() and not i["deleted"] for i in state[key]):
        raise invalid("name", message="Already exists")
    item = {"id": next_id(state, key), "name": name, "description": text(body, "description", max_len=250), "status": body.get("status", True) is not False, "deleted": False}
    state[key].append(item)
    return item


def delete_setup(state: dict, key: str, ids: list[int]) -> list[int]:
    gone = [i for i in state[key] if i["id"] in ids and not i["deleted"]]
    for item in gone:
        item["deleted"] = True
    return [i["id"] for i in gone]


def _usable(state: dict, key: str, value, field: str) -> dict:
    found = next((i for i in state[key] if i["id"] == to_int(value) and not i["deleted"] and i["status"]), None)
    if found is None:
        raise invalid(field, message="Not found or not active")
    return found


# ------------------------------------------------------------------------------------------ claims
def total(claim: dict) -> float:
    return round(sum(e["amount"] for e in claim["expenses"]), 2)


def row(state: dict, claim: dict) -> dict:
    emp = next((e for e in state["employees"] if e["empNumber"] == claim["empNumber"]), None)
    event = next((e for e in state["claimEvents"] if e["id"] == claim["claimEventId"]), {"id": claim["claimEventId"], "name": ""})
    return {
        "id": claim["id"], "referenceId": claim["referenceId"], "claimEvent": {"id": event["id"], "name": event["name"]},
        "currencyType": {"id": claim["currencyId"], "name": CURRENCIES.get(claim["currencyId"], claim["currencyId"])},
        "employee": pim.short(emp) if emp else {"empNumber": claim["empNumber"]}, "status": claim["status"], "remarks": claim["remarks"],
        "createdDate": claim["createdDate"], "submittedDate": claim["submittedDate"], "amount": f"{total(claim):.2f}", "expensesCount": len(claim["expenses"]),
    }


def find(state: dict, claim_id) -> dict:
    found = next((c for c in state["claims"] if c["id"] == to_int(claim_id)), None)
    if found is None:
        raise not_found(f"Claim request with id '{claim_id}' not found")
    return found


def create(state: dict, emp_number, body: dict, today: date) -> dict:
    emp = pim.active(state, emp_number)
    event = _usable(state, "claimEvents", body.get("claimEventId"), "claimEventId")
    currency = text(body, "currencyId", required=True, max_len=3).upper()
    if currency not in CURRENCIES:
        raise invalid("currencyId")
    number = next_id(state, "claim")
    claim = {"id": number, "referenceId": f"{today:%Y%m%d}{number:07d}", "empNumber": emp["empNumber"], "claimEventId": event["id"], "currencyId": currency,
             "remarks": text(body, "remarks", max_len=1000), "status": "Initiated", "createdDate": today.isoformat(), "submittedDate": None, "expenses": []}
    state["claims"].append(claim)
    return row(state, claim)


def list_claims(state: dict, params) -> tuple[list[dict], dict]:
    emp, event = to_int(params.get("empNumber")), to_int(params.get("eventId") or params.get("claimEventId"))
    reference, status = str(params.get("referenceId", "")).strip().lower(), str(params.get("status", "")).strip().lower()
    rows = [c for c in sorted(state["claims"], key=lambda c: c["id"], reverse=True)
            if (emp is None or c["empNumber"] == emp) and (event is None or c["claimEventId"] == event)
            and (not reference or reference in c["referenceId"].lower()) and (not status or c["status"].lower() == status)]
    page, meta = paged(rows, params)
    return [row(state, c) for c in page], meta


def expense_row(state: dict, expense: dict) -> dict:
    kind = next((t for t in state["expenseTypes"] if t["id"] == expense["expenseTypeId"]), {"id": expense["expenseTypeId"], "name": ""})
    return {"id": expense["id"], "expenseType": {"id": kind["id"], "name": kind["name"]}, "date": expense["date"], "amount": f"{expense['amount']:.2f}", "note": expense["note"]}


def _editable(claim: dict) -> None:
    if claim["status"] != "Initiated":
        raise HrmsError(422, f"The claim is {claim['status']}; expenses can only be changed while it is Initiated")


def add_expense(state: dict, claim_id, body: dict) -> dict:
    claim = find(state, claim_id)
    _editable(claim)
    kind = _usable(state, "expenseTypes", body.get("expenseTypeId"), "expenseTypeId")
    expense = {"id": next_id(state, "expense"), "expenseTypeId": kind["id"], "date": to_date(body.get("date"), "date").isoformat(),
               "amount": to_amount(body.get("amount"), "amount"), "note": text(body, "note", max_len=1000)}
    claim["expenses"].append(expense)
    return expense_row(state, expense)


def delete_expenses(state: dict, claim_id, ids: list[int]) -> list[int]:
    claim = find(state, claim_id)
    _editable(claim)
    gone = [e["id"] for e in claim["expenses"] if e["id"] in ids]
    claim["expenses"] = [e for e in claim["expenses"] if e["id"] not in gone]
    return gone


def act(state: dict, claim_id, body: dict, today: date) -> dict:
    claim = find(state, claim_id)
    action = str(body.get("action", "")).upper()
    if action not in _ACTIONS:
        raise invalid("action", message="Supported actions: " + ", ".join(_ACTIONS))
    allowed, result = _ACTIONS[action]
    if claim["status"] not in allowed:
        raise HrmsError(422, f"Cannot {action.lower()} a claim that is {claim['status']}")
    claim["status"] = result
    if action == "SUBMIT":
        claim["submittedDate"] = today.isoformat()
    return row(state, claim)

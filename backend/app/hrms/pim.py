"""PIM: employees, personal / job / contact details, emergency contacts, salary, attachments, terminations."""

import base64
import binascii
import re
from datetime import date

from app.hrms.common import CURRENCIES, HrmsError, invalid, next_id, not_found, paged, text, to_amount, to_date, to_int

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CONTACT_KEYS = ("street1", "street2", "city", "province", "zipCode", "countryCode", "homeTelephone", "mobile", "workTelephone", "workEmail", "otherEmail")
_LOOKUPS = {  # job-details field -> (state list, display key in answers)
    "jobTitle": ("jobTitles", "title"), "subunit": ("subunits", "name"), "empStatus": ("empStatuses", "name"), "location": ("locations", "name"),
}
_GENDERS = {"1": "Male", "2": "Female", "3": "Other"}
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024


# ------------------------------------------------------------------ lookups (job titles, units, ...)
def lookup_list(state: dict, kind: str) -> list[dict]:
    return state.setdefault("lookups", {}).setdefault(kind, [])


def lookup_ref(state: dict, kind: str, value) -> int | None:
    """The id of a job title / unit / status / location given as an id, a name or an {id, name} object; unknown names are created."""
    if isinstance(value, dict):
        value = value.get("id") if value.get("id") not in (None, "") else value.get("title") or value.get("name")
    if value in (None, ""):
        return None
    items = lookup_list(state, kind)
    number = to_int(value)
    for item in items:
        if (number is not None and item["id"] == number) or item["name"].lower() == str(value).strip().lower():
            return item["id"]
    if number is not None:
        raise invalid(kind)
    created = {"id": next_id(state, kind), "name": str(value).strip()[:100]}
    items.append(created)
    return created["id"]


def _ref(state: dict, field: str, ref_id: int | None) -> dict | None:
    kind, label = _LOOKUPS[field]
    name = next((i["name"] for i in lookup_list(state, kind) if i["id"] == ref_id), None)
    shown = {"id": ref_id if name else None, label: name}
    return {**shown, "isDeleted": False} if field == "jobTitle" else shown


# ------------------------------------------------------------------------------------ employees
def find(state: dict, emp_number) -> dict:
    number = to_int(emp_number)
    for emp in state["employees"]:
        if emp["empNumber"] == number:
            return emp
    raise not_found(f"Employee with empNumber '{emp_number}' not found")


def active(state: dict, emp_number) -> dict:
    """The employee, who must exist and still be employed (422 on ``empNumber`` otherwise)."""
    try:
        emp = find(state, emp_number)
    except HrmsError:
        raise invalid("empNumber", message="Employee not found") from None
    if emp["terminationId"]:
        raise invalid("empNumber", message="Employee has been terminated")
    return emp


def full_name(emp: dict) -> str:
    return " ".join(p for p in (emp["firstName"], emp["middleName"], emp["lastName"]) if p)


def short(emp: dict) -> dict:
    return {"empNumber": emp["empNumber"], "firstName": emp["firstName"], "middleName": emp["middleName"], "lastName": emp["lastName"], "employeeId": emp["employeeId"]}


def row(state: dict, emp: dict) -> dict:
    bosses = [find(state, n) for n in emp["supervisorIds"] if any(e["empNumber"] == n for e in state["employees"])]
    return {
        **short(emp), "terminationId": emp["terminationId"],
        "jobTitle": _ref(state, "jobTitle", emp["jobTitleId"]), "subunit": _ref(state, "subunit", emp["subunitId"]),
        "empStatus": _ref(state, "empStatus", emp["empStatusId"]),
        "supervisors": [{k: b[k] for k in ("empNumber", "firstName", "lastName")} for b in bosses],
    }


def list_employees(state: dict, params) -> tuple[list[dict], dict]:
    scope = params.get("includeEmployees", "currentOnly")
    needle = " ".join(str(params.get("nameOrId", "")).lower().split())
    found = []
    for emp in state["employees"]:
        if (scope == "currentOnly" and emp["terminationId"]) or (scope == "onlyPast" and not emp["terminationId"]):
            continue
        if needle and needle not in " ".join(full_name(emp).lower().split()) and needle not in emp["employeeId"].lower():
            continue
        found.append(emp)
    rows, meta = paged(found, params)
    return [row(state, e) for e in rows], meta


def free_employee_id(state: dict, wanted: str) -> str:
    taken = {e["employeeId"].lower() for e in state["employees"]}
    if wanted:
        if wanted.lower() in taken:
            raise invalid("employeeId", message="Employee Id already exists")
        return wanted
    number = max([int(e["employeeId"]) for e in state["employees"] if e["employeeId"].isdigit()] + [0]) + 1
    while f"{number:04d}" in taken:
        number += 1
    return f"{number:04d}"


def blank_employee(state: dict, first: str, middle: str, last: str, employee_id: str, emp_number: int | None = None) -> dict:
    return {
        "empNumber": emp_number or next_id(state, "empNumber"), "employeeId": employee_id,
        "firstName": first, "middleName": middle, "lastName": last, "otherId": "", "birthday": None,
        "gender": None, "maritalStatus": None, "nationality": None, "joinedDate": None,
        "jobTitleId": None, "subunitId": None, "empStatusId": None, "locationId": None, "terminationId": None,
        "contact": {k: "" for k in _CONTACT_KEYS}, "emergency": [], "salary": [], "attachments": [], "supervisorIds": [],
    }


def create(state: dict, body: dict) -> dict:
    first, middle, last = text(body, "firstName", required=True, max_len=100), text(body, "middleName", max_len=100), text(body, "lastName", required=True, max_len=100)
    employee_id = text(body, "employeeId", max_len=10)
    emp = blank_employee(state, first, middle, last, free_employee_id(state, employee_id))
    state["employees"].append(emp)
    return {**short(emp), "terminationId": None}


def delete(state: dict, ids: list[int]) -> list[int]:
    gone = {e["empNumber"] for e in state["employees"] if e["empNumber"] in ids}
    state["employees"] = [e for e in state["employees"] if e["empNumber"] not in gone]
    for key in ("leaveRequests", "entitlements", "attendance", "claims"):
        state[key] = [r for r in state.get(key, []) if r["empNumber"] not in gone]
    for emp in state["employees"]:
        emp["supervisorIds"] = [n for n in emp["supervisorIds"] if n not in gone]
    return sorted(gone)


# ----------------------------------------------------------------------------------------- details
def personal(emp: dict) -> dict:
    return {
        **short(emp), "otherId": emp["otherId"], "birthday": emp["birthday"], "gender": emp["gender"],
        "maritalStatus": emp["maritalStatus"], "nationality": emp["nationality"],
    }


def save_personal(state: dict, emp: dict, body: dict) -> dict:
    first = text(body, "firstName", required=True, max_len=100) if "firstName" in body else emp["firstName"]
    last = text(body, "lastName", required=True, max_len=100) if "lastName" in body else emp["lastName"]
    if "employeeId" in body and text(body, "employeeId", max_len=10).lower() != emp["employeeId"].lower():
        new_id = text(body, "employeeId", required=True, max_len=10)
        if any(e["employeeId"].lower() == new_id.lower() for e in state["employees"]):
            raise invalid("employeeId", message="Employee Id already exists")
        emp["employeeId"] = new_id
    emp.update(firstName=first, lastName=last)
    if "middleName" in body:
        emp["middleName"] = text(body, "middleName", max_len=100)
    if "otherId" in body:
        emp["otherId"] = text(body, "otherId", max_len=30)
    if "birthday" in body:
        day = to_date(body["birthday"], "birthday", required=False)
        if day and day >= date.today():
            raise invalid("birthday")
        emp["birthday"] = day.isoformat() if day else None
    for key in ("gender", "maritalStatus", "nationality"):
        if key in body:
            value = body[key]
            value = value.get("name") if isinstance(value, dict) else value
            emp[key] = (_GENDERS.get(str(value), str(value)) if key == "gender" else str(value)) if value not in (None, "") else None
    return personal(emp)


def job(state: dict, emp: dict) -> dict:
    return {
        "joinedDate": emp["joinedDate"], "terminationId": emp["terminationId"],
        **{field: _ref(state, field, emp[f"{field}Id"]) for field in _LOOKUPS},
    }


def save_job(state: dict, emp: dict, body: dict) -> dict:
    if "joinedDate" in body:
        day = to_date(body["joinedDate"], "joinedDate", required=False)
        emp["joinedDate"] = day.isoformat() if day else None
    for field in _LOOKUPS:
        for key in (field, f"{field}Id"):
            if key in body:
                emp[f"{field}Id"] = lookup_ref(state, _LOOKUPS[field][0], body[key])
    return job(state, emp)


def save_contact(state: dict, emp: dict, body: dict) -> dict:
    new = {**emp["contact"], **{k: text(body, k, max_len=100) for k in _CONTACT_KEYS if k in body}}
    taken = {m.lower() for o in state["employees"] if o is not emp for m in (o["contact"]["workEmail"], o["contact"]["otherEmail"]) if m}
    bad = []
    for key in ("workEmail", "otherEmail"):
        mail = new[key].lower()
        if mail and (not _EMAIL.match(mail) or mail in taken or (key == "otherEmail" and mail == new["workEmail"].lower())):
            bad.append(key)
    if bad:  # every rejected field is named, as HRMS does
        raise invalid(*bad, message="Already exists or not a valid e-mail address")
    emp["contact"] = new
    return new


def save_emergency(emp: dict, state: dict, body: dict) -> dict:
    contact = {
        "id": next_id(state, "emergency"), "name": text(body, "name", required=True, max_len=100),
        "relationship": text(body, "relationship", required=True, max_len=100),
        "homePhone": text(body, "homePhone", max_len=30), "mobilePhone": text(body, "mobilePhone", max_len=30), "officePhone": text(body, "officePhone", max_len=30),
    }
    emp["emergency"].append(contact)
    return contact


def add_salary(emp: dict, state: dict, body: dict) -> dict:
    currency = text(body, "currencyId", max_len=3).upper() or "INR"
    if currency not in CURRENCIES:
        raise invalid("currencyId")
    item = {
        "id": next_id(state, "salary"), "salaryName": text(body, "salaryComponent", required=True, max_len=100),
        "amount": f"{to_amount(body.get('salaryAmount'), 'salaryAmount'):.2f}",
        "currencyType": {"id": currency, "name": CURRENCIES[currency]},
        "payPeriod": text(body, "payPeriod", max_len=50) or None, "comment": text(body, "comment", max_len=250),
    }
    emp["salary"].append(item)
    return item


def add_attachment(emp: dict, state: dict, body: dict) -> dict:
    file = body.get("attachment")
    if not isinstance(file, dict):
        raise invalid("attachment")
    try:
        data = base64.b64decode(str(file.get("base64") or ""), validate=True)
    except (binascii.Error, ValueError):
        raise invalid("attachment", message="The file content is not valid base64") from None
    if not data or len(data) > MAX_ATTACHMENT_BYTES:
        raise invalid("attachment", message="The file is empty or larger than 5 MB")
    item = {
        "id": next_id(state, "attachment"), "filename": text(file, "name", required=True, max_len=200), "fileType": text(file, "type", max_len=100) or "application/octet-stream",
        "size": len(data), "description": text(body, "description", max_len=200), "dateAdded": date.today().isoformat(), "base64": base64.b64encode(data).decode("ascii"),
    }
    emp["attachments"].append(item)
    return {k: v for k, v in item.items() if k != "base64"}


def attachment_list(emp: dict) -> list[dict]:
    return [{k: v for k, v in a.items() if k != "base64"} for a in emp["attachments"]]


def attachment_file(emp: dict, attachment_id: int) -> dict:
    for item in emp["attachments"]:
        if item["id"] == attachment_id:
            return item
    raise not_found("Attachment not found")


# ------------------------------------------------------------------------------------ terminations
def reasons(state: dict) -> list[dict]:
    return state["terminationReasons"]


def add_reason(state: dict, body: dict) -> dict:
    name = text(body, "name", required=True, max_len=100)
    if any(r["name"].lower() == name.lower() for r in reasons(state)):
        raise invalid("name", message="Already exists")
    item = {"id": next_id(state, "terminationReason"), "name": name}
    reasons(state).append(item)
    return item


def terminate(state: dict, emp: dict, body: dict) -> dict:
    if emp["terminationId"]:
        raise invalid("date", message="The employee has already been terminated")
    day = to_date(body.get("date"), "date")
    reason = next((r for r in reasons(state) if r["id"] == to_int(body.get("terminationReasonId"))), None)
    if reason is None:
        raise invalid("terminationReasonId")
    if emp["joinedDate"] and day.isoformat() < emp["joinedDate"]:
        raise invalid("date", message="The termination date cannot be before the joined date")
    record = {"id": next_id(state, "termination"), "empNumber": emp["empNumber"], "date": day.isoformat(), "reason": reason, "note": text(body, "note", max_len=250)}
    state["terminations"].append(record)
    emp["terminationId"] = record["id"]
    return {k: v for k, v in record.items() if k != "empNumber"}


def reinstate(state: dict, emp: dict) -> None:
    state["terminations"] = [t for t in state["terminations"] if t["id"] != emp["terminationId"]]
    emp["terminationId"] = None


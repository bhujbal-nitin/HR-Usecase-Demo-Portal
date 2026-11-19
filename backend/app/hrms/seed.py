"""First-start data: the portal's own employees become HRMS employees, plus the usual set-up (leave types, holidays, claim events ...)."""

import re
from datetime import date

from app.hrms import claim, leave, pim
from app.hrms.leave import DEFAULT_WORK_WEEK
from app.integrations.orangehrm import OrangeHRMClient
from app.schemas.employee import Employee, EmployeeStatus
from app.services.leave.policy import STANDARD_LEAVE_TYPES
from app.services.reimbursement.policy import EXPENSE_TYPES
from app.services.reimbursement_service import CLAIM_EVENT
from app.utils.formatting import split_name

TERMINATION_REASONS = ("Resigned", "Terminated", "Contract Not Renewed", "Retired", "Deceased", "Other")
CLAIM_EVENTS = (CLAIM_EVENT, "Travel Allowance", "Medical Reimbursement", "Accommodation")
EXPENSE_TYPE_NAMES = tuple(dict.fromkeys((*EXPENSE_TYPES, "Accommodation", "Fuel", "Transport")))
EMPLOYMENT_STATUSES = ("Full-Time Permanent", "Full-Time Contract", "Part-Time Internship")
_FIXED_HOLIDAYS = (("01-26", "Republic Day"), ("05-01", "Maharashtra Day"), ("08-15", "Independence Day"), ("10-02", "Gandhi Jayanti"), ("12-25", "Christmas"))
_MOVING_HOLIDAYS = {  # festivals whose date changes every year (approximate)
    2026: (("03-04", "Holi"), ("09-14", "Ganesh Chaturthi"), ("10-20", "Dussehra"), ("11-08", "Diwali (Lakshmi Puja)")),
    2027: (("03-22", "Holi"), ("09-04", "Ganesh Chaturthi"), ("10-09", "Dussehra"), ("10-29", "Diwali (Lakshmi Puja)")),
}


def is_seeded(state: dict) -> bool:
    return bool(state.get("seeded"))


def _empty_state() -> dict:
    return {
        "seq": {}, "employees": [], "terminations": [], "terminationReasons": [], "lookups": {}, "leaveTypes": [], "entitlements": [], "leaveRequests": [],
        "holidays": [], "workWeek": dict(DEFAULT_WORK_WEEK), "leavePeriod": {"startMonth": 1, "startDay": 1}, "attendance": [],
        "claimEvents": [], "expenseTypes": [], "claims": [],
    }


def _setup(state: dict, today: date) -> None:
    for name in TERMINATION_REASONS:
        pim.add_reason(state, {"name": name})
    for name in STANDARD_LEAVE_TYPES:
        leave.add_leave_type(state, {"name": name})
    for name in EMPLOYMENT_STATUSES:
        pim.lookup_ref(state, "empStatuses", name)
    for year in (today.year, today.year + 1):
        for day, name in (*_FIXED_HOLIDAYS, *_MOVING_HOLIDAYS.get(year, ())):
            leave.add_holiday(state, {"name": name, "date": f"{year}-{day}", "length": 0, "recurring": (day, name) in _FIXED_HOLIDAYS})
    for name in CLAIM_EVENTS:
        claim.add_setup(state, "claimEvents", {"name": name, "status": True})
    for name in EXPENSE_TYPE_NAMES:
        claim.add_setup(state, "expenseTypes", {"name": name, "status": True})


def _add_person(state: dict, e: Employee, today: date) -> dict:
    stored = e.orange_hrm.emp_number if e.orange_hrm else None
    number = stored if stored and not any(x["empNumber"] == stored for x in state["employees"]) else None
    if number:
        state["seq"]["empNumber"] = max(state["seq"].get("empNumber", 0), number)
    first, middle, last = split_name(e.full_name)
    employee_id = re.sub(r"[^0-9A-Za-z]", "", re.sub(r"^(AE|EMP)", "", e.id))[:10]
    if any(x["employeeId"].lower() == employee_id.lower() for x in state["employees"]):
        employee_id = pim.free_employee_id(state, "")
    emp = pim.blank_employee(state, first, middle, last or first, employee_id, number)
    emp.update(otherId=e.aadhaar, birthday=e.dob.isoformat(), joinedDate=e.start_date.isoformat())
    city, province = _city(e.address)
    pin = re.search(r"\b(\d{6})\b", e.address)
    work_email = (e.orange_hrm.work_email if e.orange_hrm else None) or ""
    emp["contact"].update(street1=e.address, city=city, province=province, zipCode=pin.group(1) if pin else "", countryCode="IN", mobile=e.phone,
                          workEmail=work_email, otherEmail=e.email if e.email.lower() != work_email.lower() else "")
    emp["jobTitleId"] = pim.lookup_ref(state, "jobTitles", e.job_title)
    emp["subunitId"] = pim.lookup_ref(state, "subunits", e.department)
    emp["empStatusId"] = pim.lookup_ref(state, "empStatuses", EMPLOYMENT_STATUSES[0])
    emp["locationId"] = pim.lookup_ref(state, "locations", e.work_location)
    state["employees"].append(emp)
    pim.save_emergency(emp, state, {"name": e.emergency_name, "relationship": "Family", "mobilePhone": e.emergency_phone})
    pim.add_salary(emp, state, {"salaryComponent": "CTC", "salaryAmount": str(e.annual_ctc), "currencyId": "INR"})
    return emp


def _city(address: str) -> tuple[str, str]:
    return OrangeHRMClient._city_state(address)


def seed(state: dict, employees: list[Employee], today: date) -> None:
    """Fill an empty data set. People who have a profile in the portal (or are approved) become employees; each gets the standard leave quota."""
    state.clear()
    state.update(_empty_state())
    _setup(state, today)
    chosen = [e for e in employees if e.status == EmployeeStatus.APPROVED or (e.orange_hrm and e.orange_hrm.emp_number)]
    people = [_add_person(state, e, today) for e in chosen]
    by_name = {pim.full_name(p).lower(): p for p in people}
    for person, source in zip(people, chosen):
        boss = by_name.get(re.sub(r"\s*\(.*\)\s*$", "", source.manager).strip().lower())
        if boss and boss is not person:
            person["supervisorIds"].append(boss["empNumber"])
        for type_name, days in STANDARD_LEAVE_TYPES.items():
            kind = next(t for t in state["leaveTypes"] if t["name"] == type_name)
            leave.add_entitlement(state, {"empNumber": person["empNumber"], "leaveTypeId": kind["id"], "fromDate": f"{today.year}-01-01", "toDate": f"{today.year}-12-31", "entitlement": days})
    state["seeded"] = True

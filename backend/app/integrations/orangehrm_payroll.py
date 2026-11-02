"""OrangeHRM 5.x salary read (PIM -> employee -> Salary), the same web-session /api/v2 API the OrangeHRM screens use.

Mixed into ``OrangeHRMClient`` next to the leave calls; it relies on ``_leave_call`` from ``LeaveAttendanceMixin``.
"""


class PayrollMixin:
    def salary_components(self, emp_number: int) -> list[dict]:
        """[{name, amount, currency}] for every salary component recorded for the employee (amount in whole currency units)."""
        data = self._leave_call("GET", f"pim/employees/{emp_number}/salary-components").get("data")
        rows = []
        for item in data if isinstance(data, list) else []:
            try:
                amount = float(item.get("amount"))
            except (TypeError, ValueError):
                continue
            rows.append({"name": str(item.get("salaryName") or "").strip(), "amount": amount, "currency": (item.get("currencyType") or {}).get("id") or "INR"})
        return rows

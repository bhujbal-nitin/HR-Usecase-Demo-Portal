// Pure helpers for the HRMS replica: formatting, error wording and mapping API rows to table rows.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03-05" -> "05 Mar 2026" (no time zone maths, so the day never shifts). */
export function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) return value ? String(value) : '-';
  return `${m[3]} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function fmtNumber(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '0.00';
}

export function fullName(person) {
  if (!person) return '';
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ');
}

/** "Mon 5 Mar" style range: one date when both ends are the same. */
export function fmtRange(from, to) {
  if (!to || from === to) return fmtDate(from);
  return `${fmtDate(from)} to ${fmtDate(to)}`;
}

/** Hours between two punches ("YYYY-MM-DD", "HH:MM"). Returns 0 when something is missing or the order is wrong. */
export function diffHours(inDate, inTime, outDate, outTime) {
  if (!inDate || !inTime || !outDate || !outTime) return 0;
  const a = Date.parse(`${inDate}T${inTime}:00Z`);
  const b = Date.parse(`${outDate}T${outTime}:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return (b - a) / 3600000;
}

/** 7.5 -> "7h 30m" */
export function fmtDuration(hours) {
  const total = Math.round(Number(hours || 0) * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** "invalidParamKeys" such as "employeeId" -> "Employee Id". */
export function humanizeKey(key) {
  const spaced = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Turn the API's `{error:{message,data:{invalidParamKeys}}}` (or a status) into a plain sentence. */
export function errorText(payload, status = 0) {
  const err = payload?.error ?? {};
  const keys = err.data?.invalidParamKeys ?? [];
  const message = err.message && err.message !== 'Invalid Parameter' ? err.message : '';
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 404) return message || 'We could not find that record.';
  if (keys.length) {
    const fields = keys.map(humanizeKey).join(', ');
    return message ? `${message} (please check: ${fields}).` : `Please check these fields: ${fields}.`;
  }
  if (message) return message;
  if (status >= 500) return 'The HRMS service had a problem. Please try again in a moment.';
  if (status === 0) return 'Could not reach the HRMS service. Please check that it is running.';
  return 'Something went wrong. Please try again.';
}

/** Query string where lists use the `key[]=a&key[]=b` form HRMS expects; empty values are skipped. */
export function buildQuery(params = {}) {
  const out = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => out.append(`${key}[]`, v));
    else if (value !== undefined && value !== null && value !== '') out.append(key, value);
  });
  const text = out.toString();
  return text ? `?${text}` : '';
}

export function statusTone(status) {
  const s = String(status ?? '').toLowerCase();
  if (/(approved|paid|taken|scheduled|active|punched out|submitted)/.test(s)) return 'green';
  if (/(pending|initiated|punched in|past)/.test(s)) return 'orange';
  if (/(reject|cancel|terminated|disabled|inactive)/.test(s)) return 'red';
  return 'grey';
}

function statusName(status) {
  if (!status) return '';
  return typeof status === 'string' ? status : status.name ?? status.id ?? '';
}

/** One row of the leave list table from a `leave/leave-requests` item. */
export function leaveRequestRow(r) {
  const breakdown = String(r.leaveBreakdown ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const parts = breakdown.map((b) => {
    const m = /^([\d.]+)\s+(.+)$/.exec(b);
    return m ? { days: m[1], status: m[2] } : { days: '', status: b };
  });
  return {
    id: r.id,
    date: fmtRange(r.dates?.fromDate, r.dates?.toDate),
    employee: fullName(r),
    type: r.leaveType?.name ?? '-',
    days: fmtNumber(r.noOfDays),
    status: parts.map((p) => p.status).join(', ') || '-',
    statusLabel: parts.map((p) => (p.days ? `${p.status} (${p.days})` : p.status)).join(', ') || '-',
    comment: r.comment ?? '',
  };
}

/** One row of the balance report from `leave/employees/leave-balances`. */
export function balanceRow(b) {
  const u = b.usageBreakdown;
  return {
    type: b.leaveType?.name ?? '-',
    entitled: fmtNumber(u?.entitled),
    used: fmtNumber(Number(u?.used ?? 0) + Number(u?.scheduled ?? 0)),
    pending: fmtNumber(u?.pending),
    balance: fmtNumber(u?.balance),
    hasEntitlement: Boolean(u),
  };
}

/** One row of the attendance table from `attendance/employees/{n}/records`. */
export function attendanceRow(rec) {
  const pin = rec.punchIn ?? {};
  const pout = rec.punchOut ?? null;
  const hours = pout ? diffHours(pin.userDate, pin.userTime, pout.userDate, pout.userTime) : 0;
  return {
    id: rec.id,
    punchIn: pin.userDate ? `${fmtDate(pin.userDate)} ${pin.userTime ?? ''}`.trim() : '-',
    punchOut: pout?.userDate ? `${fmtDate(pout.userDate)} ${pout.userTime ?? ''}`.trim() : '-',
    note: pin.note ?? '',
    hours,
    duration: pout ? fmtDuration(hours) : '-',
    open: !pout,
  };
}

/** One row of a claim list; tolerant of the several shapes HRMS uses for the nested pieces. */
export function claimRow(c) {
  const emp = c.employee ?? c;
  return {
    id: c.id,
    reference: c.referenceId ?? String(c.id ?? ''),
    employee: fullName(emp),
    event: c.claimEvent?.name ?? c.event?.name ?? c.eventName ?? '-',
    currency: c.currency?.name ?? c.currency?.id ?? c.currencyId ?? '',
    status: statusName(c.status) || '-',
    amount: c.amount ?? c.total ?? null,
    submitted: c.submittedDate ?? c.createdDate ?? '',
  };
}

export function employeeRow(e) {
  return {
    empNumber: e.empNumber,
    id: e.employeeId ?? '',
    firstMiddle: [e.firstName, e.middleName].filter(Boolean).join(' '),
    lastName: e.lastName ?? '',
    jobTitle: e.jobTitle?.title ?? '-',
    status: e.empStatus?.name ?? '-',
    unit: e.subunit?.name ?? '-',
    supervisor: (e.supervisors ?? []).map(fullName).join(', ') || '-',
    past: Boolean(e.terminationId),
  };
}

/** Picks the leave period that contains today (falls back to the first). */
export function currentPeriod(periods, today = todayISO()) {
  const list = periods ?? [];
  return list.find((p) => p.startDate <= today && today <= p.endDate) ?? list[0] ?? null;
}

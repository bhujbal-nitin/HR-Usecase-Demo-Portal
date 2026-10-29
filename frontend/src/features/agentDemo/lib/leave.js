// The leave & attendance chat: what the employee can ask for, the two forms (fields and rules) and the sample company
// data the simulated run uses. The live run gets its balances, holidays and punches from OrangeHRM instead.

import { todayIso } from './resignation';

/** What the assistant offers (and the suggestion chips in Manual mode). Auto-play runs them in this order. */
export const SCENARIOS = [
  { id: 'balance', label: 'Check my leave balance and holidays', prompt: 'How many leaves do I have left? And which holidays are coming up?', intent: 'leave.check_balance' },
  { id: 'apply', label: 'Apply for leave', prompt: 'I’d like to apply for 2 days of casual leave.', intent: 'leave.apply' },
  { id: 'regularize', label: 'Regularize a missed punch', prompt: 'I forgot to punch out recently. Can you fix my attendance?', intent: 'attendance.regularize' },
];

// Order matters: a sentence about "leave balance" is a balance question, not an application.
const INTENTS = [
  ['done', /\b(bye|goodbye|thanks?|thank you|that'?s all|nothing else|no more)\b/i],
  ['regularize', /punch|attendance|regulari[sz]|biometric|clock|check-?out|forgot to/i],
  ['balance', /balance|holiday|how many|remaining|left|entitle/i],
  ['apply', /leave|apply|vacation|time off|day off|\boff\b|pto|sick/i],
];

/** 'balance' | 'apply' | 'regularize' | 'done' | null, from what the employee typed. */
export function detectIntent(text) {
  return INTENTS.find(([, pattern]) => pattern.test(text ?? ''))?.[0] ?? null;
}

// ---- The two in-chat forms --------------------------------------------------------------------------------------------

export const LEAVE_FIELDS = [
  { id: 'leaveType', label: 'Leave type', type: 'select' },
  { id: 'startDate', label: 'From', type: 'date' },
  { id: 'endDate', label: 'To', type: 'date' },
  { id: 'reason', label: 'Reason', type: 'text' },
];

export const REGULARIZE_FIELDS = [
  { id: 'attendanceDate', label: 'Day with the missing punch', type: 'select' },
  { id: 'outPunch', label: 'Time you left', type: 'time' },
  { id: 'reason', label: 'Reason', type: 'text' },
];

const reasonError = (reason) => {
  const text = (reason ?? '').trim();
  if (text.length < 2) return 'Tell us the reason.';
  return text.length > 300 ? 'Keep the reason under 300 characters.' : '';
};

/** Returns { field: message } (empty when valid). The backend repeats these checks. */
export function validateLeave(values) {
  const errors = {};
  if (!values.leaveType) errors.leaveType = 'Choose a leave type.';
  if (!values.startDate) errors.startDate = 'Choose the first day of leave.';
  else if (values.startDate < todayIso()) errors.startDate = 'The leave cannot start in the past.';
  if (!values.endDate) errors.endDate = 'Choose the last day of leave.';
  else if (values.startDate && values.endDate < values.startDate) errors.endDate = 'The end date cannot be before the start date.';
  const reason = reasonError(values.reason);
  if (reason) errors.reason = reason;
  return errors;
}

export function validateRegularize(values) {
  const errors = {};
  if (!values.attendanceDate) errors.attendanceDate = 'Choose the day.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.outPunch ?? '')) errors.outPunch = 'Enter the time you left, for example 18:30.';
  else if (!isAfter(values.outPunch, IN_PUNCH)) errors.outPunch = `The time you left must be after your in-punch (${IN_PUNCH}).`;
  const reason = reasonError(values.reason);
  if (reason) errors.reason = reason;
  return errors;
}

export const VALIDATORS = { leave: validateLeave, regularize: validateRegularize };

// ---- The sample company calendar and leave balances (simulated run only) -------------------------------------------------

export const FIXED_HOLIDAYS = [
  [1, 1, "New Year's Day"], [1, 26, 'Republic Day'], [5, 1, 'Labour Day'], [8, 15, 'Independence Day'], [10, 2, 'Gandhi Jayanti'], [12, 25, 'Christmas Day'],
];

export const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const fromIso = (iso) => new Date(`${iso}T00:00:00`);
export const addDays = (iso, days) => { const d = fromIso(iso); d.setDate(d.getDate() + days); return toIso(d); };

export const holidayOn = (date) => FIXED_HOLIDAYS.find(([month, day]) => month === date.getMonth() + 1 && day === date.getDate())?.[2] ?? null;
const isWeekday = (date) => date.getDay() >= 1 && date.getDay() <= 5;

/** Monday to Friday, without the company holidays. */
export function workingDays(startIso, endIso) {
  let count = 0;
  for (let day = fromIso(startIso); day <= fromIso(endIso); day.setDate(day.getDate() + 1)) {
    if (isWeekday(day) && !holidayOn(day)) count += 1;
  }
  return count;
}

/** The next `count` company holidays from today, as [{ date, name }]. */
export function upcomingHolidays(count = 4, from = new Date()) {
  const found = [];
  for (const day = new Date(from.getFullYear(), from.getMonth(), from.getDate()); found.length < count; day.setDate(day.getDate() + 1)) {
    const name = holidayOn(day);
    if (name) found.push({ date: toIso(day), name });
  }
  return found;
}

/** The first two consecutive working days at least `ahead` days from today: a safe sample leave request. */
export function sampleLeaveDates(ahead = 7, from = new Date()) {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + ahead);
  for (;;) {
    const start = toIso(day);
    if (isWeekday(day) && day.getDay() <= 4 && workingDays(start, addDays(start, 1)) === 2) return { startDate: start, endDate: addDays(start, 1) };
    day.setDate(day.getDate() + 1);
  }
}

// ---- Sample leave balances and punches (simulated run only) --------------------------------------------------------------

/** Leave type -> [days a year, days already taken]. */
export const LEAVE_POLICY = { 'Casual Leave': [12, 3], 'Sick Leave': [12, 1], 'Privilege Leave': [15, 5] };
export const IN_PUNCH = '09:12';
export const SHIFT_END = '18:30';

/** The `count` working days before today, most recent first (ISO dates). */
export function previousWorkingDays(count, from = new Date()) {
  const days = [];
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (days.length < count) {
    day.setDate(day.getDate() - 1);
    if (isWeekday(day) && !holidayOn(day)) days.push(toIso(day));
  }
  return days;
}

const toMinutes = (clock) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };

/** "9h 18m" */
export function hoursWorked(inPunch, outPunch) {
  const total = toMinutes(outPunch) - toMinutes(inPunch);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}
export const isAfter = (later, earlier) => toMinutes(later) > toMinutes(earlier);

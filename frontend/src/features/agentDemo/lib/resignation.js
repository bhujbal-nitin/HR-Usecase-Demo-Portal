// The resignation form's fields and rules (shared by the in-chat form and the journey's validation step).

export const RESIGNATION_FIELDS = [
  { id: 'lastWorkingDay', label: 'Last working day', type: 'date' },
  { id: 'reason', label: 'Reason for leaving', type: 'select' },
  { id: 'leaveBalanceDays', label: 'Unused leave days', type: 'number' },
  { id: 'comments', label: 'Comments (optional)', type: 'text' },
];

export const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Returns { field: message } (empty when the form is valid). The backend repeats these checks. */
export function validateResignation(values) {
  const errors = {};
  if (!values.lastWorkingDay) errors.lastWorkingDay = 'Choose your last working day.';
  else if (values.lastWorkingDay < todayIso()) errors.lastWorkingDay = 'The last working day cannot be in the past.';
  if (!values.reason) errors.reason = 'Choose a reason.';
  const leave = Number(values.leaveBalanceDays);
  if (values.leaveBalanceDays === '' || !Number.isInteger(leave) || leave < 0 || leave > 365) errors.leaveBalanceDays = 'Enter a whole number of days from 0 to 365.';
  if ((values.comments ?? '').length > 500) errors.comments = 'Keep the comments under 500 characters.';
  return errors;
}

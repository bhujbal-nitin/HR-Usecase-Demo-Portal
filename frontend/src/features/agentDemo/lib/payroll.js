// The payroll & salary chat: what the employee can ask for (three downloads), and the months a payslip can be for.
// The documents are made by the backend (backend/app/services/payroll); nothing is calculated here.

/** What the assistant offers (the suggestion chips, in every mode). Auto-play taps them in this order. */
export const SCENARIOS = [
  { id: 'payslip', label: 'Payslip', intent: 'payroll.payslip' },
  { id: 'ctc', label: 'CTC', intent: 'payroll.ctc' },
  { id: 'form16', label: 'Form 16', intent: 'payroll.form16' },
];

const INTENTS = [
  ['done', /\b(bye|goodbye|thanks?|thank you|that'?s all|nothing else|no more)\b/i],
  ['form16', /form\s*-?16|tds certificate|tax certificate/i],
  ['payslip', /payslip|pay slip|salary slip|take-?home|net pay|net salary|salary of/i],
  ['ctc', /\bctc\b|cost to company|salary structure|annual salary|compensation|breakup|break-up/i],
];

/** 'payslip' | 'ctc' | 'form16' | 'done' | null, from what the employee typed. */
export function detectIntent(text) {
  return INTENTS.find(([, pattern]) => pattern.test(text ?? ''))?.[0] ?? null;
}

/** The last six completed months, newest first ('YYYY-MM'): last month and the five before it (this month's pay is not out yet). */
export function recentMonths(from = new Date(), count = 6) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth() - 1 - i, 1); // completed months only: last month first
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** "October 2026" */
export const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

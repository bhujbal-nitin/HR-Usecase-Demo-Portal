// The fictional pay figures of the demo employee that the simulated Payroll & Salary run's sample payslip, CTC statement and Form 16 (PDFs, see sampleSlips.js and
// sampleForm16.js) share, with the small helpers they use. The live run works the real figures out in the backend instead.

// Fictional pay for an annual CTC of 24,00,000: basic 40%, HRA 50% of basic, conveyance 1,600 a month, special allowance the rest, PF 12% of basic,
// professional tax 200 a month, new-regime tax of 2,92,500 (spread over the 12 months).
export const PAY = {
  annualCtc: 2400000, basic: 80000, hra: 40000, conveyance: 1600, special: 78400, gross: 200000, pf: 9600, professionalTax: 200, monthlyTax: 24375,
  taxableIncome: 2325000, taxBeforeCess: 281250, cess: 11250, annualTax: 292500, standardDeduction: 75000,
};

/** 21,00,000 (Indian digit grouping, no currency sign). */
export const inr = (amount) => {
  const digits = String(Math.abs(Math.round(amount)));
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
};

export const dmy = (date) => `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
export const employeeCode = (employee) => `AE${employee.employeeId.replace(/\D/g, '')}`;

/** (financial year, assessment year) of the last completed financial year, e.g. ['2025-26', '2026-27']. */
export function financialYear(today = new Date()) {
  const start = today.getMonth() >= 3 ? today.getFullYear() - 1 : today.getFullYear() - 2;
  const short = (year) => String(year % 100).padStart(2, '0');
  return [`${start}-${short(start + 1)}`, `${start + 1}-${short(start + 2)}`];
}

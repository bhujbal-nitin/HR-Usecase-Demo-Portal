// The sample Form 16 (PDF) of the simulated Payroll & Salary run: the demo employee's fictional full-year figures (see PAY in sampleDocuments.js) arranged
// like the backend's model (app/services/payroll/form16.py) and drawn by form16Pdf.js. Nothing is contacted. The PANs, TAN, receipt numbers and the
// employee's address are made up here; the live run shows a dash for what the portal does not know.

import { form16Pdf } from './form16Pdf';
import { PAY, dmy, employeeCode, financialYear, inr } from './sampleDocuments';

const COMPANY = 'AutomationEdge Technologies Private Limited';
const DEDUCTOR_ADDRESS = '402 and 403, Global Port, Mumbai-Bangalore Highway, Baner, Pune 411045';
const EMPLOYEE_ADDRESS = 'Flat 10, Residency Park, Baner, Pune, Maharashtra - 411045';
const CERTIFICATE = `This is to certify that ${COMPANY} has deducted tax at source from the salary paid to the employee named above and deposited it to the credit of the `
  + 'Central Government, as shown in this certificate. The information given is true, complete and correct and is based on the books of account, documents, '
  + 'TDS statements and other records of the deductor.';

/** 6,00,000.00 */
export const money = (amount) => `${inr(amount)}.00`;

export function form16Model(employee, today = new Date()) {
  const [year, assessment] = financialYear(today);
  const start = Number(year.slice(0, 4));
  const quarter = PAY.monthlyTax * 3;
  const deducted = PAY.monthlyTax * 12;
  const shownDate = dmy(today).split('-');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(shownDate[1]) - 1];
  return {
    company: COMPANY, year, assessment,
    parties: [
      ['Name', COMPANY, employee.fullName],
      ['Address', DEDUCTOR_ADDRESS, EMPLOYEE_ADDRESS],
      ['PAN', 'ABCDE1234F', 'PQRSX6789L'],
      ['TAN', 'PNEA12345B', '-'],
      ['Employee reference / ID', '-', employeeCode(employee)],
      ['Period of employment', '-', `01-Apr-${start} to 31-Mar-${start + 1}`],
    ],
    quarters: [
      ...['Apr-Jun', 'Jul-Sep', 'Oct-Dec', 'Jan-Mar'].map((months, i) => [`Q${i + 1} (${months} ${start + (i === 3 ? 1 : 0)})`, `ACK-Q${i + 1}-58421${i + 3}`, money(quarter), money(quarter)]),
      ['Total', '-', money(deducted), money(deducted)],
    ],
    computation: [
      ['Gross salary', money(PAY.annualCtc), false],
      ['Less: Exempt allowances', money(0), false],
      ['Salary after exempt allowances', money(PAY.annualCtc), false],
      ['Less: Standard deduction', money(PAY.standardDeduction), false],
      ["Income chargeable under the head 'Salaries'", money(PAY.taxableIncome), true],
      ['Income from other sources reported to employer', money(0), false],
      ['Gross total income', money(PAY.taxableIncome), false],
      ['Deductions under Chapter VI-A', money(0), false],
      ['Total taxable income', money(PAY.taxableIncome), true],
      ['Income-tax', money(PAY.taxBeforeCess), false],
      ['Health and Education Cess', money(PAY.cess), false],
      ['Total tax liability', money(PAY.annualTax), true],
      ['TDS deducted during the year', money(deducted), true],
    ],
    certificate: CERTIFICATE, place: 'Pune', date: `${shownDate[0]}-${month}-${shownDate[2]}`, signatoryFor: `For ${COMPANY}`,
  };
}

/** The sample Form 16 for the last completed financial year, as a PDF Blob; `logo` is a png read with readPng (optional). */
export const sampleForm16 = (employee, logo = null, today = new Date()) => form16Pdf(form16Model(employee, today), logo);

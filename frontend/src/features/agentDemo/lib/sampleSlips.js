// The sample payslip and CTC statement (PDF) of the simulated Payroll & Salary run: the demo employee's fictional pay (see PAY in sampleDocuments.js)
// arranged like the backend's models (app/services/payroll/slips.py) and drawn by slipPdf.js. Nothing is contacted.

import { PAY, dmy, employeeCode, inr } from './sampleDocuments';
import { ctcPdf, payslipPdf } from './slipPdf';

const COMPANY = 'AutomationEdge Technologies Private Limited';
const ADDRESS = 'Office Address: 402 and 403, Global Port, Mumbai-Bangalore Highway, Baner, Pune 411045';
const UNKNOWN = '-';
const JOIN_DATE = '11-Mar-2024'; // fictional, like the rest of the sample

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const belowHundred = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim());
const belowThousand = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', belowHundred(n % 100)].filter(Boolean).join(' ');

/** 2400000 -> "Twenty Four Lakh Rupees" (thousand, lakh and crore, as on the backend's payslips). */
export function rupeesInWords(amount) {
  let n = Math.abs(Math.round(amount));
  if (n === 0) return 'Zero Rupees';
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts = [crore ? `${crore < 100 ? belowHundred(crore) : belowThousand(crore)} Crore` : '', lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '', n ? belowThousand(n) : ''];
  return `${parts.filter(Boolean).join(' ')} Rupees`;
}

/** The lines of the employee block, left and right column. */
function info(employee, left, right) {
  return {
    left: [`Employee Code: ${employeeCode(employee)}`, `Employee Name: ${employee.fullName}`, `Group Join Date: ${UNKNOWN}`, `Join Date: ${JOIN_DATE}`, `PAN: ${UNKNOWN}`,
      `Provident Fund: ${UNKNOWN}`, `UAN No.: ${UNKNOWN}`, '', ...left],
    right: [`Designation: ${employee.jobTitle}`, `Department: ${employee.department}`, `NPS: ${UNKNOWN}`, `ESIC: ${UNKNOWN}`, '', '', '', '', ...right],
  };
}

/** "October 2026" -> "Oct 2026" */
const shortMonth = (label) => { const [month, year] = label.split(' '); return `${month.slice(0, 3)} ${year}`; };

export function payslipModel(employee, monthLabel, days) {
  const deductions = PAY.pf + PAY.professionalTax + PAY.monthlyTax;
  const net = PAY.gross - deductions;
  return {
    company: COMPANY, address: ADDRESS, title: `Salary Slip for ${shortMonth(monthLabel)}`,
    ...info(employee, [`Days in Month: ${days}`, `Working Days: ${days}`], ['LOP Days: 0', 'Arrear Days: 0']),
    earnings: [['Basic', inr(PAY.basic)], ['Conveyance Allowance', inr(PAY.conveyance)], ['HRA', inr(PAY.hra)], ['Special Allowance', inr(PAY.special)]],
    deductions: [['PROV.FUND', inr(PAY.pf)], ['P.Tax', inr(PAY.professionalTax)], ['Income Tax (TDS)', inr(PAY.monthlyTax)]],
    totalEarnings: inr(PAY.gross), totalDeductions: inr(deductions), net: inr(net), words: `Net Pay: ${rupeesInWords(net)}`,
  };
}

export function ctcModel(employee, today = new Date()) {
  const pt = PAY.professionalTax;
  const takeHome = PAY.gross - PAY.pf - pt - PAY.monthlyTax;
  const row = (label, monthly, yearly) => [label, inr(monthly), inr(yearly)];
  return {
    company: COMPANY, address: ADDRESS, title: 'CTC Statement',
    ...info(employee, [`Annual CTC: Rs. ${inr(PAY.annualCtc)}`], [`Date: ${dmy(today)}`]),
    head: ['Component', 'Monthly (Rs.)', 'Yearly (Rs.)'],
    sections: [
      ['Earnings', [row('Basic', PAY.basic, PAY.basic * 12), row('Conveyance Allowance', PAY.conveyance, PAY.conveyance * 12), row('HRA', PAY.hra, PAY.hra * 12),
        row('Special Allowance', PAY.special, PAY.annualCtc - (PAY.basic + PAY.conveyance + PAY.hra) * 12)]],
      ['Deductions', [row('PROV.FUND', PAY.pf, PAY.pf * 12), row('P.Tax', pt, pt * 12), row('Income Tax (TDS)', PAY.monthlyTax, PAY.monthlyTax * 12)]],
    ],
    totals: [row('Gross pay (CTC)', PAY.gross, PAY.annualCtc), row('Take-home pay', takeHome, PAY.annualCtc - (PAY.pf + pt + PAY.monthlyTax) * 12)],
    words: `Annual CTC: ${rupeesInWords(PAY.annualCtc)}`,
  };
}

/** The sample payslip of a month ("October 2026", `days` long) as a PDF Blob; `logo` is a png read with readPng (optional). */
export const samplePayslip = (employee, monthLabel, days, logo = null) => payslipPdf(payslipModel(employee, monthLabel, days), logo);
/** The sample CTC statement as a PDF Blob. */
export const sampleCtc = (employee, logo = null, today = new Date()) => ctcPdf(ctcModel(employee, today), logo);

// The reimbursement chat: what the employee can ask for, the policy hint and the sample bills Auto-play uploads.
// The live run scans each bill; the backend has the same policy hint (backend/app/services/reimbursement/policy.py).

import { makeSamplePdf } from './samplePdf';
import { toIso } from './leave';

/** What the assistant offers (the suggestion chips, in every mode). */
export const SCENARIOS = [
  { id: 'claim', label: 'Submit an expense claim', intent: 'reimbursement.submit_claim' },
];

const INTENTS = [
  ['done', /\b(bye|goodbye|thanks?|thank you|that'?s all|nothing else|no more)\b/i],
  ['claim', /claim|expense|reimburs|bill|receipt|invoice|refund/i],
];

/** 'claim' | 'done' | null, from what the employee typed. */
export function detectIntent(text) {
  return INTENTS.find(([, pattern]) => pattern.test(text ?? ''))?.[0] ?? null;
}

// ---- The bills ----------------------------------------------------------------------------------------------------------

export const POLICY_TYPES = ['Travel', 'Food']; // the types the company policy reimburses: a hint, the manager approves or rejects every bill
export const MAX_BILLS = 20;
export const BILL_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
export const BILL_ACCEPT = BILL_EXTENSIONS.join(',');
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** '' when the file can be uploaded as a bill, else why not. */
export function validateBill(file) {
  const name = file.name.toLowerCase();
  if (!BILL_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'Please upload the bill as a PDF or a photo (PNG, JPG or WEBP).';
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > MAX_FILE_BYTES) return 'The file is larger than 10 MB.';
  return '';
}

export const withinPolicy = (expenseType) => POLICY_TYPES.includes(expenseType);

/** [within policy, outside policy], in the order the bills came. */
export const splitByPolicy = (bills) => [bills.filter((b) => withinPolicy(b.expenseType)), bills.filter((b) => !withinPolicy(b.expenseType))];

export const totalOf = (bills) => Math.round(bills.reduce((sum, b) => sum + b.amount, 0) * 100) / 100;

// ---- The sample bills (Auto-play) ------------------------------------------------------------------------------------------------

const SAMPLE_BILLS = [
  { fileName: 'spice_route_restaurant_bill.pdf', expenseType: 'Food', vendor: 'Spice Route Restaurant', daysAgo: 3, amount: 1860, lines: ['Restaurant bill', 'Table 12 - 4 guests', 'Food and beverages: 1,860.00'] },
  { fileName: 'ola_ride_receipt.pdf', expenseType: 'Travel', vendor: 'Ola Cabs', daysAgo: 2, amount: 642, lines: ['Ride receipt', 'Cab fare, airport to office', 'Total fare: 642.00'] },
  { fileName: 'hotel_sunrise_invoice.pdf', expenseType: 'Stay', vendor: 'Hotel Sunrise Residency', daysAgo: 6, amount: 7400, lines: ['Hotel invoice', 'Deluxe room, 2 nights', 'Total due: 7,400.00'] },
];

/**
 * The bills Auto-play uploads: a real PDF to send, and what reading it gives (the simulated run uses the readings; the live run reads the PDF).
 * @returns {{ file: File, reading: object }[]}
 */
export function buildSampleBills(from = new Date()) {
  return SAMPLE_BILLS.map(({ fileName, expenseType, vendor, daysAgo, amount, lines }) => {
    const day = toIso(new Date(from.getFullYear(), from.getMonth(), from.getDate() - daysAgo));
    const pdf = makeSamplePdf(vendor, [`Vendor: ${vendor}`, `Date: ${day.split('-').reverse().join('/')}`, ...lines, 'Currency: INR']);
    return { file: new File([pdf], fileName, { type: 'application/pdf' }), reading: { fileName, expenseType, date: day, amount, vendor, withinPolicy: withinPolicy(expenseType), approved: null } };
  });
}

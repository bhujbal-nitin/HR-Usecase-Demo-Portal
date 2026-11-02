import { api } from './client';

const ref = (employeeRef) => `ref=${encodeURIComponent(employeeRef)}`;

/** { months: ['2026-10', ...] newest first } */
export const getPayrollOptions = () => api.get('/payroll/options');
/** Recognise an onboarded employee by Employee ID or e-mail. Rejects with a readable message if unknown. */
export const lookupEmployee = (employeeRef) => api.get(`/payroll/lookup?${ref(employeeRef)}`);

/** Run one AutomationEdge showcase workflow and wait for it: fetch-salary | generate-payslip | generate-ctc | generate-form16. Resolves with { ok, status, ... }. */
export const runPayrollWorkflow = (key) => api.post(`/payroll/workflows/${key}`);

// The three documents, made from the employee's figures (the annual CTC is read from OrangeHRM when one is asked for). Each comes back as { href, filename }.
/** The payslip of one month (YYYY-MM), a PDF. */
export const fetchPayslip = (employeeRef, month) => api.download(`/payroll/payslip/download?${ref(employeeRef)}&month=${month}`, 'Payslip.pdf');
/** The CTC statement, a PDF. */
export const fetchCtc = (employeeRef) => api.download(`/payroll/ctc/download?${ref(employeeRef)}`, 'CTC_Statement.pdf');
/** Form 16 for the last completed financial year, a PDF. */
export const fetchForm16 = (employeeRef) => api.download(`/payroll/form16/download?${ref(employeeRef)}`, 'Form16.pdf');

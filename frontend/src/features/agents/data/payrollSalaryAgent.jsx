// The Payroll & Salary agent runs from features/agentDemo (payrollJourney.jsx): the salary is read from OrangeHRM and the documents are made by the
// backend draws the PDFs. This file only describes the agent on its card.

export const config = {
  id: 'payroll_salary',
  name: 'Payroll & Salary Agent',
  catalogName: 'Payroll & Salary',
  category: 'core',
  description: 'Gives the employee their payslip, CTC statement and Form 16 to download as PDFs, made from the salary recorded in OrangeHRM.',
  tags: ['Payslip PDF', 'CTC Statement PDF', 'Form 16 PDF'],
  badge: 'Secure Bank-Grade',
  greeting: (
    <>
      👋 Hello! I am your <strong>Payroll & Salary AI Specialist</strong>. I can give you your payslip, your CTC statement or your Form 16 to
      download.
    </>
  ),
  quickPrompts: [
    { text: '💵 Payslip', action: 'payslip' },
    { text: '💰 CTC', action: 'ctc' },
    { text: '📑 Form 16', action: 'form16' },
  ],
};

/** No scripted answers: the live and simulated runs play the real journey. */
export function respond() {
  return null;
}

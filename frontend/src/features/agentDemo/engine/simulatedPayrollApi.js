// A stand-in for the payroll service calls, used by Auto-play · Simulated. The journey code is exactly the same as in the live flow
// (see payrollJourney.jsx); only the calls behind it are replaced by this timed, in-memory play-through, so the flows cannot
// drift apart. Nothing here contacts any system (the live flow reads the salary from OrangeHRM and the backend makes the documents).

import { monthLabel, recentMonths } from '../lib/payroll';
import { PAYROLL_WORKFLOWS } from './phases/payrollWorkflow';
import logoUrl from '../../../assets/automationedge-logo.png';
import { readPng } from '../lib/pdf';
import { sampleForm16 } from '../lib/sampleForm16';
import { sampleCtc, samplePayslip } from '../lib/sampleSlips';
import { SIM_EMPLOYEE } from './simulatedOffboardingApi';

/** A file the browser saves (the simulated run has no backend, so the sample is built here with the demo employee's name and fictional figures). */
const sample = (blob, filename) => ({ href: URL.createObjectURL(blob), filename });

/** The company logo for the PDFs (the page's own copy of the image file); the documents are made without it if it cannot be read. */
async function loadLogo() {
  try {
    return readPng(new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()));
  } catch {
    return null;
  }
}

/** Days in a "YYYY-MM" month. */
const daysIn = (month) => { const [year, number] = month.split('-').map(Number); return new Date(year, number, 0).getDate(); };

/** @param scale  how much slower than the nominal timings to play (the demo's step scale) */
export function createSimulatedPayrollApi(scale = 1) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms * scale));
  const { employeeId, fullName, department, jobTitle, manager, workEmail } = SIM_EMPLOYEE;
  const who = fullName.replace(/\s+/g, '_');

  let workflowRun = 7240;

  return {
    simulated: true,
    /** A showcase AutomationEdge workflow run that simply completes after a short wait. */
    runPayrollWorkflow: async (key) => {
      await pause(1400);
      return { workflowName: PAYROLL_WORKFLOWS[key].name, status: 'Complete', ok: true, automationRequestId: workflowRun++, agent: 'Simulated agent', message: 'Workflow completed' };
    },
    getPayrollOptions: async () => { await pause(500); return { months: recentMonths() }; },
    lookupEmployee: async () => { await pause(500); return { employeeId, fullName, department, jobTitle, manager, workEmail }; },
    fetchPayslip: async (_ref, month) => {
      await pause(1200);
      return sample(samplePayslip(SIM_EMPLOYEE, monthLabel(month), daysIn(month), await loadLogo()), `Payslip_${monthLabel(month).replace(' ', '_')}_${who}.pdf`);
    },
    fetchCtc: async () => { await pause(1200); return sample(sampleCtc(SIM_EMPLOYEE, await loadLogo()), `CTC_Statement_${who}.pdf`); },
    fetchForm16: async () => { await pause(1200); return sample(sampleForm16(SIM_EMPLOYEE, await loadLogo()), `Form16_${who}.pdf`); },
  };
}

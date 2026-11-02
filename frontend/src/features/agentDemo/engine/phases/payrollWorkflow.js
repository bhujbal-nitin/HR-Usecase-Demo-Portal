// The AutomationEdge workflows of the payroll & salary demo. Each runs right BEFORE the step it stands for and the chat only goes on once it
// reached Complete. They are showcase runs (no inputs, nothing returned): the portal's backend does the real work.

import { workflowPayload } from './leaveWorkflow';

/** URL key -> AutomationEdge name, and the step card's title and note. */
export const PAYROLL_WORKFLOWS = {
  'fetch-salary': { name: 'HR Demo Fetch Salary Details', title: 'Run the fetch salary workflow', note: 'AutomationEdge runs “HR Demo Fetch Salary Details” before the salary is read; the next step starts when it is Complete.' },
  'generate-payslip': { name: 'HR Demo Generate Payslip', title: 'Run the payslip workflow', note: 'AutomationEdge runs “HR Demo Generate Payslip” before the payslip is made; the next step starts when it is Complete.' },
  'generate-ctc': { name: 'HR Demo Generate CTC Statement', title: 'Run the CTC statement workflow', note: 'AutomationEdge runs “HR Demo Generate CTC Statement” before the CTC statement is made; the next step starts when it is Complete.' },
  'generate-form16': { name: 'HR Demo Generate Form 16', title: 'Run the Form 16 workflow', note: 'AutomationEdge runs “HR Demo Generate Form 16” before Form 16 is made; the next step starts when it is Complete.' },
};

/** A step that runs one showcase workflow and turns green only when it is Complete (otherwise the runner offers Rerun / Skip). */
export function payrollWorkflowStep(S, key) {
  const wf = PAYROLL_WORKFLOWS[key];
  return {
    kind: 'api', agent: 'pay', title: wf.title, name: wf.name, live: !S.api.simulated, note: wf.note,
    run: async () => {
      const result = await S.api.runPayrollWorkflow(key);
      if (!result.ok) throw new Error(`“${wf.name}” ended with status ${result.status}. ${result.message ?? ''}`.trim());
      return { payload: workflowPayload(result) };
    },
  };
}

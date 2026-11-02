// The AutomationEdge workflows of the reimbursement demo. Each runs right AFTER the step it stands for and the chat only goes on once it
// reached Complete. They are showcase runs (no inputs, nothing returned): the portal's backend does the real work.

import { workflowPayload } from './leaveWorkflow';

/** URL key -> AutomationEdge name, and the step card's title and note. */
export const REIMBURSEMENT_WORKFLOWS = {
  'read-bill': { name: 'HR Demo Read Bill', title: 'Run the read bill workflow', note: 'AutomationEdge runs “HR Demo Read Bill” after all the bills are read; the next step starts when it is Complete.' },
  'check-policy': { name: 'HR Demo Check Reimbursement Policy', title: 'Run the policy check workflow', note: 'AutomationEdge runs “HR Demo Check Reimbursement Policy” after the bills are checked against the policy; the next step starts when it is Complete.' },
  'submit-claim': { name: 'HR Demo Submit Expense Claim', title: 'Run the submit claim workflow', note: 'AutomationEdge runs “HR Demo Submit Expense Claim” after the claim is saved for the manager; the next step starts when it is Complete.' },
  'create-claim': { name: 'HR Demo Create Claim OrangeHRM', title: 'Run the create claim workflow', note: 'AutomationEdge runs “HR Demo Create Claim OrangeHRM” after the approved bills are recorded in OrangeHRM; the next step starts when it is Complete.' },
};

/** A step that runs one showcase workflow and turns green only when it is Complete (otherwise the runner offers Rerun / Skip). */
export function reimbursementWorkflowStep(S, key) {
  const wf = REIMBURSEMENT_WORKFLOWS[key];
  return {
    kind: 'api', agent: 'reimb', title: wf.title, name: wf.name, live: !S.api.simulated, note: wf.note,
    run: async () => {
      const result = await S.api.runReimbursementWorkflow(key);
      if (!result.ok) throw new Error(`“${wf.name}” ended with status ${result.status}. ${result.message ?? ''}`.trim());
      return { payload: workflowPayload(result) };
    },
  };
}

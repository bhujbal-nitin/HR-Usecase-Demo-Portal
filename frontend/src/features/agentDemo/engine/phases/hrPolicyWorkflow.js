// The AutomationEdge workflows of the HR policy & documents demo. Each runs right AFTER the step it stands for and the chat only goes on once
// it reached Complete. They are showcase runs (no inputs, nothing returned): the portal's backend does the real work.

import { workflowPayload } from './leaveWorkflow';

/** URL key -> AutomationEdge name, and the step card's title and note. */
export const HR_POLICY_WORKFLOWS = {
  'search-policy': { name: 'HR Demo Search Policy', title: 'Run the search policy workflow', note: 'AutomationEdge runs “HR Demo Search Policy” after the policies are searched; the next step starts when it is Complete.' },
  'get-policy': { name: 'HR Demo Get Policy Document', title: 'Run the get policy workflow', note: 'AutomationEdge runs “HR Demo Get Policy Document” after the policy is taken from the folder; the next step starts when it is Complete.' },
  'ask-question': { name: 'HR Demo Ask Policy Question', title: 'Run the ask question workflow', note: 'AutomationEdge runs “HR Demo Ask Policy Question” after the knowledge base answered; the next step starts when it is Complete.' },
  'address-proof-letter': { name: 'HR Demo Generate Address Proof Letter', title: 'Run the address proof letter workflow', note: 'AutomationEdge runs “HR Demo Generate Address Proof Letter” after the letter is made; the next step starts when it is Complete.' },
  'bank-account-letter': { name: 'HR Demo Generate Bank Account Opening Letter', title: 'Run the bank account letter workflow', note: 'AutomationEdge runs “HR Demo Generate Bank Account Opening Letter” after the letter is made; the next step starts when it is Complete.' },
};

/** The workflow that follows each letter (by the letter's key). */
export const LETTER_WORKFLOWS = { 'address-proof': 'address-proof-letter', 'bank-account': 'bank-account-letter' };

/** A step that runs one showcase workflow and turns green only when it is Complete (otherwise the runner offers Rerun / Skip). */
export function hrPolicyWorkflowStep(S, key) {
  const wf = HR_POLICY_WORKFLOWS[key];
  return {
    kind: 'api', agent: 'policy', title: wf.title, name: wf.name, live: !S.api.simulated, note: wf.note,
    run: async () => {
      const result = await S.api.runHrPolicyWorkflow(key);
      if (!result.ok) throw new Error(`“${wf.name}” ended with status ${result.status}. ${result.message ?? ''}`.trim());
      return { payload: workflowPayload(result) };
    },
  };
}

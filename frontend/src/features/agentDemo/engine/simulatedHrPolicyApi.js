// A stand-in for the HR policy service calls, used by Auto-play · Simulated. The journey code is exactly the same as in the live flow
// (see hrPolicyJourney.jsx); only the calls behind it are replaced by this timed, in-memory play-through, so the flows cannot drift apart.
// Nothing here contacts any system (the live flow asks the knowledge base and reads the letters from the HR documents folder).

import { AUTO_QUESTIONS, SIMULATED_POLICIES, simulatedLetters } from '../lib/hrPolicy';
import { HR_POLICY_WORKFLOWS } from './phases/hrPolicyWorkflow';
import { SIM_EMPLOYEE } from './simulatedOffboardingApi';

// What the simulated knowledge base answers: scripted, and clearly not real policy.
const ANSWERS = {
  [AUTO_QUESTIONS[0]]: { answer: 'Here are the key points of the leave policy:\n\n- Every employee gets **paid casual, sick and privilege leave** each year.\n- You **apply for leave in advance**.\n- Your **manager approves** it.', sources: ['AE Leave Policy.pdf'] },
  [AUTO_QUESTIONS[1]]: { answer: 'To take leave, three things must be true:\n\n- You **apply before** you take it.\n- Your **manager approves** it.\n- Your **balance** of that leave type covers the days you ask for.', sources: ['AE Leave Policy.pdf'] },
};
const FALLBACK = { answer: 'The simulated run only answers its own sample questions.', sources: [] };

/** @param scale  how much slower than the nominal timings to play (the demo's step scale) */
export function createSimulatedHrPolicyApi(scale = 1) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms * scale));
  let workflowRun = 7120;
  return {
    simulated: true,
    /** A showcase AutomationEdge workflow run that simply completes after a short wait. */
    runHrPolicyWorkflow: async (key) => {
      await pause(1400);
      return { workflowName: HR_POLICY_WORKFLOWS[key].name, status: 'Complete', ok: true, automationRequestId: workflowRun++, agent: 'Simulated agent', message: 'Workflow completed' };
    },
    lookupEmployee: async () => { await pause(500); return { ...SIM_EMPLOYEE }; },
    askPolicy: async (question) => { await pause(1500); return { ...(ANSWERS[question] ?? FALLBACK) }; },
    listPolicies: async () => { await pause(700); return SIMULATED_POLICIES.map((p) => ({ ...p })); },
    /** A plain-text file the browser saves (the simulated run has no backend to serve the PDF). */
    policyDownload: (policy) => ({
      href: URL.createObjectURL(new Blob([`${policy.title} (simulated)\n\nThis is a sample. The real run gives the policy PDF from the policies folder.`], { type: 'text/plain' })),
      filename: policy.fileName.replace(/\.[^.]+$/, '_simulated.txt'),
    }),
    getLetters: async () => { await pause(600); return simulatedLetters(SIM_EMPLOYEE.fullName); },
    /** A plain-text letter the browser saves (the simulated run has no backend to serve the file). */
    letterDownload: (_ref, letter) => ({
      href: URL.createObjectURL(new Blob([`${letter.title} (simulated)\n\nThis is a sample. The real run gives a Word letter made from the template in the HR documents folder, with the employee's details filled in.`], { type: 'text/plain' })),
      filename: letter.fileName.replace(/\.[^.]+$/, '_simulated.txt'),
    }),
  };
}

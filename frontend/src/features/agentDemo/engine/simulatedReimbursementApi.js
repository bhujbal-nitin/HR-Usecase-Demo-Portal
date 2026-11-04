// A stand-in for the reimbursement service calls, used by Auto-play · Simulated. The journey code is exactly the same as in the live
// flow (see reimbursementJourney.jsx); only the calls behind it are replaced by this timed, in-memory play-through, so the flows cannot
// drift apart. Nothing here contacts any system (the live flow scans bills and records the claim in OrangeHRM).

import { totalOf, withinPolicy } from '../lib/reimbursement';
import { REIMBURSEMENT_WORKFLOWS } from './phases/reimbursementWorkflow';
import { SIM_EMPLOYEE } from './simulatedOffboardingApi';

/**
 * @param scale    how much slower than the nominal timings to play (the demo's step scale)
 * @param samples  the sample bills ({ file, reading }) the run will upload: reading one gives its prepared result
 */
export function createSimulatedReimbursementApi(scale = 1, samples = []) {
  const claims = [];
  let counter = 318204;
  let workflowRun = 6120;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms * scale));

  return {
    simulated: true,
    /** A showcase AutomationEdge workflow run that simply completes after a short wait. */
    runReimbursementWorkflow: async (key) => {
      await pause(1400);
      return { workflowName: REIMBURSEMENT_WORKFLOWS[key].name, status: 'Complete', ok: true, automationRequestId: workflowRun++, agent: 'Simulated agent', message: 'Workflow completed' };
    },
    lookupEmployee: async () => { await pause(500); return { ...SIM_EMPLOYEE }; },
    readBill: async (_ref, file) => {
      await pause(1300);
      const sample = samples.find((s) => s.file.name === file.name);
      if (!sample) throw new Error('The simulated run only reads its own sample bills.');
      return { ...sample.reading };
    },
    submitClaim: async ({ items }) => {
      await pause(900);
      const bills = items.map((b) => ({ ...b, withinPolicy: withinPolicy(b.expenseType), approved: null }));
      const claim = {
        id: `RC-${counter++}`, employeeId: SIM_EMPLOYEE.employeeId, fullName: SIM_EMPLOYEE.fullName, workEmail: SIM_EMPLOYEE.workEmail,
        department: SIM_EMPLOYEE.department, jobTitle: SIM_EMPLOYEE.jobTitle, manager: SIM_EMPLOYEE.manager, items: bills,
        totalAmount: totalOf(bills), approvedTotal: null, status: 'Pending Approval',
        submittedAt: new Date().toISOString(), decidedAt: null, applied: false, appliedAt: null, orangeHrmId: null, orangeHrmUrl: null,
      };
      claims.unshift(claim);
      return { ...claim, items: claim.items.map((b) => ({ ...b })) };
    },
    getClaim: async (id) => ({ ...claims.find((c) => c.id === id) }),
    /** The simulated manager approves the bills that are within the policy and rejects the others, to show the per-bill decision. */
    approveClaim: async (id) => {
      const claim = claims.find((c) => c.id === id);
      claim.items.forEach((b) => { b.approved = b.withinPolicy; });
      claim.approvedTotal = totalOf(claim.items.filter((b) => b.approved));
      claim.status = claim.approvedTotal > 0 ? 'Approved' : 'Rejected';
      claim.decidedAt = new Date().toISOString();
      return { ...claim, items: claim.items.map((b) => ({ ...b })) };
    },
    /** "Record it in OrangeHRM": the simulated system just remembers it. */
    applyClaim: async (id) => {
      await pause(1100);
      const claim = claims.find((c) => c.id === id);
      Object.assign(claim, { applied: true, appliedAt: new Date().toISOString(), orangeHrmId: 17 });
      return { ...claim, items: claim.items.map((b) => ({ ...b })) };
    },
  };
}

import { getEmployee, retryProvisioning, skipProvisioningStep } from '../../../../api/employees';
import { formatDate } from '../../../../utils/format';
import { maskPhone } from './common';
import { mirrorWithRerun } from './mirror';

const PROVISION_TIMEOUT_MS = 15 * 60 * 1000;
const APPROVAL_POLL_MS = 2000;

/** Live runs: HR decides on the Approvals page; this waits (as long as it takes) until that decision is made. */
async function waitForHrDecision(r, employeeId) {
  for (;;) {
    const employee = await getEmployee(employeeId);
    if (employee.status === 'Rejected') return 'rejected';
    if (employee.status !== 'Pending Review') return 'approved'; // provisioning has started (or already finished)
    await r.wait(APPROVAL_POLL_MS);
  }
}

/** Scripted provisioning for simulated mode. */
const simulatedProvisioning = (D) => [
  {
    kind: 'tool', agent: 'orch', title: 'Record the document checks', note: 'Simulated: updates the HR record so payroll and IT can proceed.', name: 'hrms.update_status()', lat: 380,
    payload: { request: 'PATCH /api/v2/pim/employees/AE-DEMO', body: { documentChecks: 'PASSED', status: 'READY_TO_JOIN' }, response: { status: 200 } },
  },
  {
    kind: 'tool', agent: 'prov', title: 'Create the work account', note: 'Simulated: account created now, enabled on the joining date.', name: 'directory.create_user()', lat: 720,
    payload: { upn: `${D.first}.${D.last}@acme.example`.toLowerCase(), groups: [D.department, 'All-Staff'], enabled_from: D.startDate, mfa: 'enrol on first sign-in' },
  },
  {
    kind: 'tool', agent: 'prov', title: 'Asset allocation request', note: 'Simulated: raises a request with the right model for the role.', name: 'itsm.create_request()', lat: 610,
    payload: { catalog_item: D.hardware, ship_to: 'Office reception', deliver_by: D.startDate, ticket: 'REQ-30918' },
  },
];

/** Phase 7: decision, human approval gate, provisioning (real or scripted), buddy, welcome. */
export async function setup({ r, D, S, set, live }) {
  const phase = r.phase(
    'Approval and Day-1 set-up',
    live ? 'Live: after HR approves, AutomationEdge workflows create the real accounts and tickets.' : 'Simulated: with the documents checked, the agent decides and sets everything up.',
  );

  await r.runSteps(phase, [
    {
      kind: 'agent', agent: 'orch', title: live ? 'Decide: route to HR approval' : 'Decide: approve or escalate', note: 'The agent weighs every check from the previous phases against the written KYC policy. The inputs are the real results computed above.', name: 'policy.evaluate()', lat: 560, live: true,
      payload: () => {
        const checks = D.checks;
        const failed = Object.entries({ aadhaar_checksum: checks.verhoeff, pan_format: checks.pan, payslips: checks.payslips }).filter(([, ok]) => ok === false).map(([k]) => k);
        const risk = Number((0.04 + failed.length * 0.2).toFixed(2));
        return {
          policy: 'kyc-onboarding-v3',
          documents_received: Object.keys(D.files ?? {}), signals: { aadhaar_checksum: checks.verhoeff, aadhaar_name_similarity: checks.aadhaarName, pan_format: checks.pan, pan_name_similarity: checks.panName, payslips: checks.payslips },
          failed_checks: failed, risk_score: risk, auto_approve_below: 0.15,
          decision: live ? 'ROUTE_TO_HR_APPROVAL' : risk < 0.15 ? 'AUTO_APPROVE' : 'ESCALATE',
        };
      },
    },
    live ? {
      kind: 'human', agent: 'orch', title: 'HR approval', note: 'Creating accounts is not reversible from this screen, so the agent waits for HR. HR approves the request on the Approvals page; the run continues as soon as it is approved.', name: 'hr.approve()', live: true,
      run: async ({ patch }) => {
        set({ stage: 'review' });
        patch({ awaitHr: true, payload: { waiting_for: 'HR, on the Approvals page', candidate: S.employeeId, on_approve: 'ServiceNow → AutomationEdge → Active Directory → Microsoft 365 → OrangeHRM → laptop' } });
        const decision = await waitForHrDecision(r, S.employeeId);
        patch({ awaitHr: false });
        if (decision === 'rejected') {
          S.stopped = true;
          return { payload: { decision: 'REJECTED_BY_HR', note: 'HR rejected the request. No accounts were created.' }, warn: true, lat: 0 };
        }
        return { payload: { decision: 'APPROVED', approver: 'HR (Approvals page)', candidate: S.employeeId }, lat: 0 };
      },
    } : {
      kind: 'human', agent: 'orch', title: 'HR approval', name: 'hr.approve()',
      note: 'Simulated: the file waits for HR for a moment, then approves itself. Click Approve to go sooner.',
      run: async ({ patch, waitForGate }) => {
        const waitMs = r.timing.approvalWaitMs;
        set({ stage: 'review' });
        patch({
          gate: true,
          payload: {
            waiting_for: 'HR operator', candidate: D.fullName, autoApproveAt: Date.now() + waitMs,
            warning: 'Simulated: nothing is created in any system. This approves itself shortly, or click now.', approveLabel: 'Approve now',
          },
        });
        const choice = await Promise.race([waitForGate(), r.wait(waitMs).then(() => 'auto')]);
        patch({ gate: false });
        if (choice === 'stop') {
          S.stopped = true;
          return { payload: { decision: 'STOPPED_BY_OPERATOR', note: 'The demo was stopped before approval.' }, warn: true, lat: 0 };
        }
        return { payload: { decision: choice === 'auto' ? 'AUTO_APPROVED' : 'APPROVED', approver: choice === 'auto' ? 'automatic after the wait (demo)' : 'HR operator (this browser)', candidate: D.fullName }, lat: 0 };
      },
    },
  ]);

  if (S.stopped) {
    await r.bot('Your file is with HR. You’ll hear from us once it’s approved.', { wait: 500 });
    set({ stage: 'done', stopped: true });
    return;
  }

  let employee = null;
  if (live) {
    // The backend runs the chain one step at a time and stops at the first failure; these cards follow it.
    const outcome = await mirrorWithRerun({
      r, set, label: 'Provisioning', phaseId: phase, employeeId: S.employeeId, agent: 'prov', pick: (e) => e.pipeline,
      isDone: (e) => e.status === 'Approved' || e.status === 'Provisioning Failed', failed: (e) => e.pipeline.find((step) => step.status === 'failed'),
      retry: retryProvisioning, skip: skipProvisioningStep, timeoutMs: PROVISION_TIMEOUT_MS, timeoutMessage: 'Provisioning did not finish in time. Check Approvals.',
    });
    employee = outcome.employee;
    if (outcome.stopped) {
      await r.bot('Something went wrong while setting up your accounts. We’ll get back to you shortly.', { wait: 500 });
      S.stopped = true;
      set({ stage: 'done', stopped: true });
      return;
    }
  } else {
    await r.runSteps(phase, simulatedProvisioning(D));
  }

  const upn = employee ? employee.office365?.userPrincipalName : `${D.first}.${D.last}@acme.example`.toLowerCase();
  const laptop = employee ? employee.laptop?.ticketNumber : 'REQ-30918';

  await r.runSteps(phase, [
    {
      kind: 'agent', agent: 'prov', title: 'Match a buddy', note: 'Simulated: picks a colleague by team, location and tenure.', name: 'buddy.match()', lat: 640,
      payload: { considered: 14, picked: 'Rohan Mehta', reasons: [`same team (${D.department})`, 'same office', 'joined 14 months ago', 'no other buddy this month'] },
    },
    {
      kind: 'notify', agent: 'prov', title: 'Send the Day-1 welcome', note: 'One message with everything the candidate needs. Values come from what was actually provisioned.', name: 'whatsapp.send_template()', lat: 190, live,
      payload: { to: maskPhone(D.mobile), template: 'day1_welcome', variables: { email: upn ?? 'pending IT set-up', laptop_ticket: laptop ?? 'pending', buddy: 'Rohan Mehta', arrival: formatDate(D.startDate) } },
      after: async () => {
        await r.bot(
          <>
            You’re all set, {D.first}! Here’s what I arranged:
            <ul className="cl">
              <li><span>Work email</span><b>{upn ?? 'Pending IT set-up'}</b></li>
              <li><span>Asset allocation</span><b>{laptop ? `${D.hardware} (${laptop})` : `${D.hardware} (request pending)`}</b></li>
              <li><span>Buddy</span><b>Rohan Mehta</b></li>
              <li><span>Day 1</span><b>{formatDate(D.startDate)}</b></li>
            </ul>
          </>,
        );
        set({ stage: 'done', outcome: true });
      },
    },
  ]);
}

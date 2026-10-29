// A stand-in for the offboarding service calls, used by Auto-play · Simulated. The journey code is exactly the same as in the
// live flow (see offboardingJourney.jsx); only the calls behind it are replaced by this timed, in-memory play-through, so
// the two flows cannot drift apart. Nothing here contacts any system. Every step is tagged `simulated`.

export const SIM_EMPLOYEE = {
  employeeId: 'EMP-482915', fullName: 'Aditi Rao', jobTitle: 'Senior Product Designer', department: 'Design', manager: 'Karan Mehta (Head of Design)',
  workEmail: 'aditi.rao@acme.example', hardware: 'Apple MacBook Pro M3 Max', annualCtc: 2400000,
};

const WF = (name, n) => ({ workflowName: name, requestId: 3380000 + n, status: 'Complete', agent: 'agent1', message: 'Completed' });
const STEP = (key, label, system, ms, message, details = {}) => ({ key, label, system, ms, message, details: { simulated: true, ...details } });

const INTAKE = [
  STEP('servicenow_ticket', 'ServiceNow offboarding ticket', 'ServiceNow', 1100, 'Ticket INC0044121 created', { ticket: 'INC0044121' }),
  STEP('exit_details', 'Exit details workflow', 'AutomationEdge', 1800, 'Exit details workflow completed', { workflows: [WF('HR Demo Get Exit Details', 1)] }),
];

const CHAIN = [
  STEP('exit_approval', 'Exit management approval', 'AutomationEdge', 1600, 'Exit management approval workflow completed', { workflows: [WF('HR Demo Exit Management Approval', 2)] }),
  STEP('ad_disable', 'Disable the Active Directory account', 'AutomationEdge', 1900, 'Active Directory account disabled', { workflows: [WF('HR Demo AD user disable', 3)] }),
  STEP('o365_block', 'Block the Microsoft 365 account', 'Microsoft 365', 2000, 'Sign-in blocked, sessions revoked, 2 licence(s) removed',
    { workflows: [WF('HR Demo O365 User Offboarding', 4)], displayName: SIM_EMPLOYEE.fullName, signInBlocked: true, sessionsRevoked: true, licencesRemoved: 2 }),
  STEP('hrm_terminate', 'End the employment in OrangeHRM', 'OrangeHRM', 1800, 'Employment ended', { workflows: [WF('HR Demo Terminate emp OrangeHRM', 5)] }),
  STEP('asset_return', 'Raise the asset-return ticket', 'ServiceNow', 1700, 'Asset-return ticket INC0044122 created',
    { workflows: [WF('HR Demo Asset Return Request', 6)], ticket: 'INC0044122', asset: SIM_EMPLOYEE.hardware }),
  STEP('clearances', 'Raise the department clearances', 'ServiceNow', 1700, 'Clearance ticket INC0044123 created for IT, Finance, Admin',
    { workflows: [WF('HR Demo Exit Clearance', 7)], ticket: 'INC0044123', departments: ['IT', 'Finance', 'Admin'] }),
  STEP('settlement', 'Calculate the final settlement', 'Backend', 900, 'Final settlement calculated', { netPayable: 142860 }),
  STEP('relieving_letter', 'Send the relieving letter', 'E-mail', 1900, 'Relieving letter generated and e-mailed',
    { workflows: [WF('HR Demo Send mail Offboarding', 8)], filename: 'Relieving_Letter_Aditi_Rao.pdf', emailed: true, recipient: 'aditi.rao@example.com' }),
  STEP('servicenow_close', 'Close the ServiceNow ticket', 'ServiceNow', 900, 'Ticket INC0044121 resolved'),
];

const iso = (ms) => new Date(ms).toISOString();

/** Plays `defs` one after another from `startedAt`; returns the steps as they would look right now. */
function playback(defs, startedAt, scale) {
  const now = Date.now();
  let cursor = startedAt;
  return defs.map((def) => {
    const begin = cursor;
    const end = begin + def.ms * scale;
    cursor = end;
    const base = { key: def.key, label: def.label, system: def.system, details: {}, message: null, startedAt: null, finishedAt: null };
    if (now < begin) return { ...base, status: 'pending' };
    if (now < end) return { ...base, status: 'running', startedAt: iso(begin) };
    return { ...base, status: 'success', message: def.message, details: def.details, startedAt: iso(begin), finishedAt: iso(end) };
  });
}

/** @param scale  how much slower than the nominal timings to play (the demo's step scale) */
export function createSimulatedOffboardingApi(scale = 1) {
  let record = null;
  let intakeStartedAt = 0;
  let chainStartedAt = null;

  const view = () => {
    const intake = playback(INTAKE, intakeStartedAt, scale);
    const intakeDone = intake.every((s) => s.status === 'success');
    const pipeline = chainStartedAt ? playback(CHAIN, chainStartedAt, scale) : [];
    const chainDone = pipeline.length > 0 && pipeline.every((s) => s.status === 'success');
    return {
      ...record,
      intake, intakeStatus: intakeDone ? 'completed' : 'running',
      pipeline,
      status: chainDone ? 'Completed' : chainStartedAt ? 'Processing' : 'Pending Review',
      relievingLetter: chainDone ? { filename: 'Relieving_Letter_Aditi_Rao.pdf', emailed: true } : null,
    };
  };

  return {
    simulated: true,
    getOffboardingOptions: async () => ({ reasons: ['Better opportunity', 'Higher studies', 'Relocation', 'Health or personal reasons', 'Career change', 'Other'], noticePeriodDays: 30 }),
    lookupEmployee: async () => ({ ...SIM_EMPLOYEE }),
    submitResignation: async ({ lastWorkingDay, reason, comments, leaveBalanceDays }) => {
      record = {
        id: 'OFF-204817', employeeId: SIM_EMPLOYEE.employeeId, fullName: SIM_EMPLOYEE.fullName, lastWorkingDay, reason, comments, leaveBalanceDays,
        noticePeriodDays: 30, resignationDate: lastWorkingDay,
      };
      intakeStartedAt = Date.now();
      return view();
    },
    getOffboarding: async () => view(),
    approveOffboarding: async () => { chainStartedAt = Date.now(); return view(); },
    // Nothing fails in the simulation, so there is nothing to retry or skip.
    retryOffboardingIntake: async () => view(),
    retryOffboarding: async () => view(),
    skipOffboardingIntakeStep: async () => view(),
    skipOffboardingStep: async () => view(),
  };
}

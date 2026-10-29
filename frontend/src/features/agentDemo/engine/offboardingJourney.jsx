import * as realApi from '../../../api/offboardings';
import { createSimulatedOffboardingApi } from './simulatedOffboardingApi';
import { formatDate, formatInr } from '../../../utils/format';
import { RESIGNATION_FIELDS, validateResignation } from '../lib/resignation';
import { trigger } from './phases/common';
import { mirrorWithRerun } from './phases/mirror';

const { relievingLetterUrl } = realApi;

// Offboarding. Live: the calls are real. Simulated (Auto-play · Simulated): the very same journey runs against
// simulatedOffboardingApi, so both flows stay identical and the simulated steps are tagged Simulated. Manual: YOU are the employee leaving and the chat waits for you at every step. Auto-play: the same
// journey with the chosen employee's answers filled in for you. Either way the backend does the real work: AutomationEdge
// workflows, then its own calls to ServiceNow, Microsoft 365, OrangeHRM and e-mail, one step after another.

/** Manual: wait for the person. Auto-play: wait a moment, then answer with the scripted value. */
const makeAsk = (r, auto) => (awaiting, scripted) => (auto ? r.sleep(900).then(() => scripted) : r.ask(awaiting));

const plusDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const INTAKE_TIMEOUT_MS = 5 * 60 * 1000;
const CHAIN_TIMEOUT_MS = 15 * 60 * 1000;
const FALLBACK_OPTIONS = { reasons: ['Better opportunity', 'Higher studies', 'Relocation', 'Health or personal reasons', 'Career change', 'Other'], noticePeriodDays: 30 };

const KEEP = ['ticket', 'asset', 'departments', 'displayName', 'signInBlocked', 'sessionsRevoked', 'licencesRemoved', 'terminationDate', 'netPayable', 'filename', 'emailed', 'recipient'];

/** What a mirrored step's card shows: its outcome and the readable facts it produced (no internal ids or URLs). */
function describe(step) {
  const facts = Object.fromEntries(Object.entries(step.details ?? {}).filter(([key, value]) => KEEP.includes(key) && value !== null && typeof value !== 'object'));
  if (step.details?.departments) facts.departments = step.details.departments.join(', ');
  return { status: step.status, message: step.message, ...(step.details?.workflows ? { automationEdge: step.details.workflows } : {}), ...facts };
}

/** Phase: the employee's first message, then the question "who are you?". */
async function greeting({ r, text }) {
  const phase = r.phase('Greeting and intent', 'A new thread opens. The agent works out that this is a resignation.');
  await r.runSteps(phase, [
    trigger('Inbound message received', 'WhatsApp would deliver your message.', {
      object: 'whatsapp_business_account', type: 'text', text: { body: text }, timestamp: Math.floor(Date.now() / 1000),
    }),
    {
      kind: 'agent', agent: 'orch', title: 'Understand intent', note: 'The LLM reads the message and picks the offboarding workflow.', name: 'llm.classify_intent()', lat: 540,
      payload: { thread_state: 'NEW_THREAD', intent: 'resign', confidence: 0.96, workflow: 'offboarding.v1' },
    },
  ]);
  await r.bot('Hi, I’m your offboarding assistant. I’m sorry to hear you’re leaving; I’ll take care of the formalities.');
  await r.bot(<>First, who are you? Please type your <b>employee ID</b> (like EMP-123456) or your <b>work e-mail</b>.</>, { wait: 500 });
}

/** Ask until the backend recognises an onboarded employee. Returns the employee summary. */
async function identify({ r, set, ask, auto, api }) {
  set({ stage: 'identify' });
  for (;;) {
    const { text } = await ask({ kind: 'text', suggestions: [] }, { text: auto?.employeeId });
    r.msg('out', text);
    const phase = r.phase('Identify the employee', 'The HR records are searched for the employees onboarded through this portal.');
    let found = null;
    let reason = '';
    await r.runSteps(phase, [{
      kind: 'tool', agent: 'orch', title: 'Look up the employee', name: 'employees.lookup()', live: !api.simulated,
      note: 'Checks the HR records for an onboarded employee with this ID or e-mail address, and that no offboarding exists for them yet.',
      run: async () => {
        try {
          found = await api.lookupEmployee(text);
          return { payload: { employee: found.fullName, role: found.jobTitle, department: found.department, manager: found.manager, workEmail: found.workEmail } };
        } catch (error) {
          reason = error.message ?? 'The employee could not be found.';
          return { warn: true, payload: { result: 'Not recognised', reason } };
        }
      },
    }]);
    if (found) return found;
    if (auto) throw new Error(`The chosen employee could not be offboarded: ${reason}`);
    await r.bot(<>{reason} Please try your employee ID or work e-mail again.</>, { wait: 500 });
  }
}

/** The resignation form, then the real record and its ServiceNow ticket. Returns the stored offboarding. */
async function submit({ r, S, set, employee, options, ask, auto }) {
  await r.bot(<>Thanks, <b>{employee.fullName.split(/\s+/)[0]}</b>. I found you: <b>{employee.jobTitle}</b>, {employee.department}, reporting to {employee.manager}.</>);
  await r.bot('Please fill in your resignation details below and tap Submit.', { wait: 500 });
  const formId = r.msg('in', null, { kind: 'resignationForm', wide: true, form: { submitted: false, values: auto ? {} : null, auto: Boolean(auto), reasons: options.reasons, noticePeriodDays: options.noticePeriodDays } });
  set({ stage: 'form' });

  const sample = { lastWorkingDay: plusDays(21), reason: options.reasons[0], leaveBalanceDays: '5', comments: '' };
  let values;
  if (auto) {
    // Auto-play: fill the form one field at a time, pause, then submit (like a person would).
    values = {};
    for (const { id } of RESIGNATION_FIELDS) {
      await r.sleep(450);
      values[id] = sample[id];
      r.patchMsg(formId, { form: { submitted: false, auto: true, values: { ...values }, reasons: options.reasons, noticePeriodDays: options.noticePeriodDays } });
    }
    await r.sleep(700);
  } else {
    ({ values } = await ask({ kind: 'form' }, { values: sample }));
  }
  r.patchMsg(formId, { form: { submitted: true, auto: false, values, reasons: options.reasons, noticePeriodDays: options.noticePeriodDays } });
  r.msg('out', <><b>Last working day:</b> {formatDate(values.lastWorkingDay)}<br />{values.reason}</>);
  await r.phaseGap();

  const phase = r.phase('Resignation intake', 'The resignation is validated and saved, and its ServiceNow ticket is raised.');
  await r.runSteps(phase, [
    trigger('Form submission received', 'The form arrives as a structured reply, not free text.', { type: 'interactive', nfm_reply: { name: 'resignation_v1', response_json: { employee: employee.employeeId, ...values } } }),
    {
      kind: 'tool', agent: 'orch', title: 'Validate the resignation', name: 'validators.run()', lat: 60, live: !S.api.simulated,
      note: 'Checks the dates and the form before anything is saved.',
      payload: () => Object.fromEntries(RESIGNATION_FIELDS.map(({ id, label }) => [label, validateResignation(values)[id] || 'ok'])),
    },
    {
      kind: 'api', agent: 'orch', title: 'Submit the resignation', name: 'POST /api/offboardings', live: !S.api.simulated, noSkip: true,
      note: 'Saves the resignation. The notice period and the employee’s accounts come from their onboarding record.',
      run: async () => {
        const record = await S.api.submitResignation({
          employeeRef: employee.employeeId, lastWorkingDay: values.lastWorkingDay, reason: values.reason,
          comments: values.comments, leaveBalanceDays: Number(values.leaveBalanceDays),
        });
        S.record = record;
        if (!S.api.simulated) set({ runRecord: { kind: 'offboarding', id: record.id } });
        return { payload: { reference: record.id, status: record.status, lastWorkingDay: record.lastWorkingDay, noticePeriodDays: record.noticePeriodDays } };
      },
    },
  ]);

  // The backend raises the ServiceNow ticket; the chat continues only once it is done (or a person stops the run).
  const { employee: record, stopped } = await mirrorWithRerun({
    r, set, label: 'Resignation intake', phaseId: phase, employeeId: S.record.id, agent: 'orch', pick: (o) => o.intake,
    isDone: (o) => o.intakeStatus !== 'running', failed: (o) => o.intake.find((step) => step.status === 'failed'),
    retry: S.api.retryOffboardingIntake, skip: S.api.skipOffboardingIntakeStep, timeoutMs: INTAKE_TIMEOUT_MS, timeoutMessage: 'The resignation ticket was not created in time.',
    load: S.api.getOffboarding, describe,
  });
  S.record = record;
  if (stopped) {
    await r.bot('Sorry, something went wrong while saving your resignation. Please try again shortly.', { wait: 500 });
    S.stopped = true;
    set({ stage: 'done', stopped: true });
  }
}

/** Wait for HR's decision on the HR Approvals page, then follow the chain (mirrored step by step, with Rerun/Stop on failure). */
const DECISION_POLL_MS = 2000;

/** HR decides on the HR Approvals page; wait (as long as it takes) until that decision is made. */
async function waitForHrDecision(r, offboardingId, api) {
  for (;;) {
    const record = await api.getOffboarding(offboardingId);
    if (record.status === 'Rejected') return 'rejected';
    if (record.status !== 'Pending Review') return 'approved'; // the offboarding has started (or already finished)
    await r.wait(DECISION_POLL_MS);
  }
}

async function approveAndRun({ r, S, set }) {
  const ticket = S.record.intake.find((step) => step.key === 'servicenow_ticket')?.details?.ticket;
  const phase = r.phase('HR approval and offboarding', 'After HR approves, AutomationEdge workflows and the connected systems remove access, ends the employment, raises the asset return and clearances, settles and sends the relieving letter.');
  await r.bot(<>Your resignation is submitted (ref <b>{S.record.id}</b>{ticket ? <>, ticket <b>{ticket}</b></> : null}). Your last working day is <b>{formatDate(S.record.lastWorkingDay)}</b>. It is now with HR for approval.</>);
  set({ stage: 'review' });

  await r.runSteps(phase, [{
    kind: 'human', agent: 'orch', title: 'HR approval', name: 'hr.approve()', live: !S.api.simulated,
    note: S.api.simulated
      ? 'Simulated: the resignation waits for HR for a moment, then approves itself. Click Approve now to go sooner.'
      : 'Offboarding changes real accounts, so the agent waits for HR. HR approves the resignation on the HR Approvals page (Offboarding tab); the run continues as soon as it is approved.',
    run: async ({ patch, waitForGate }) => {
      if (S.api.simulated) {
        const waitMs = r.timing.approvalWaitMs;
        patch({
          gate: true,
          payload: {
            waiting_for: 'HR operator', employee: S.record.fullName, autoApproveAt: Date.now() + waitMs,
            warning: 'Simulated: nothing is changed in any system. This approves itself shortly, or click now.', approveLabel: 'Approve now',
          },
        });
        const choice = await Promise.race([waitForGate(), r.wait(waitMs).then(() => 'auto')]);
        patch({ gate: false });
        if (choice === 'stop') {
          S.stopped = true;
          return { payload: { decision: 'STOPPED_BY_OPERATOR', note: 'The demo was stopped before approval.' }, warn: true, lat: 0 };
        }
        return { payload: { decision: choice === 'auto' ? 'AUTO_APPROVED' : 'APPROVED', approver: choice === 'auto' ? 'automatic after the wait (demo)' : 'HR operator (this browser)', employee: S.record.fullName }, lat: 0 };
      }
      patch({
        awaitHr: true,
        payload: { waiting_for: 'HR, on the HR Approvals page', employee: S.record.fullName, openTo: '/approvals?tab=offboarding' },
      });
      const decision = await waitForHrDecision(r, S.record.id, S.api);
      patch({ awaitHr: false });
      if (decision === 'rejected') {
        S.stopped = true;
        return { payload: { decision: 'REJECTED_BY_HR', note: 'HR did not accept the resignation. Nothing was changed.' }, warn: true, lat: 0 };
      }
      return { payload: { decision: 'APPROVED', approver: 'HR (HR Approvals page)', employee: S.record.fullName }, lat: 0 };
    },
  }]);

  if (S.stopped) {
    await r.bot('Your resignation is with HR. You’ll hear from us once it is approved.', { wait: 500 });
    set({ stage: 'done', stopped: true });
    return;
  }

  if (S.api.simulated) await S.api.approveOffboarding(S.record.id); // live: HR already approved on the HR Approvals page
  const outcome = await mirrorWithRerun({
    r, set, label: 'Offboarding', phaseId: phase, employeeId: S.record.id, agent: 'prov', pick: (o) => o.pipeline,
    isDone: (o) => o.status === 'Completed' || o.status === 'Offboarding Failed', failed: (o) => o.pipeline.find((step) => step.status === 'failed'),
    retry: S.api.retryOffboarding, skip: S.api.skipOffboardingStep, timeoutMs: CHAIN_TIMEOUT_MS, timeoutMessage: 'Offboarding did not finish in time.',
    load: S.api.getOffboarding, describe,
  });
  S.record = outcome.employee;
  if (outcome.stopped) {
    await r.bot('Something went wrong while closing your accounts. HR has been notified and will get back to you.', { wait: 500 });
    S.stopped = true;
    set({ stage: 'done', stopped: true });
  }
}

/** The closing message, built from what the backend really produced. */
async function farewell({ r, S, set }) {
  const record = S.record;
  const settlement = record.pipeline.find((step) => step.key === 'settlement')?.details;
  const letter = record.relievingLetter;
  const outcomeOf = (key, done) => (record.pipeline.find((step) => step.key === key)?.status === 'success' ? done : 'Not done (system not configured)');
  await r.runSteps(r.phase('Tell the employee', 'A short summary of what was done and what comes next.'), [{
    kind: 'notify', agent: 'prov', title: 'Send the exit summary', name: 'whatsapp.send_text()', lat: 180,
    note: 'One message with the last day, the settlement estimate and the relieving letter.',
    payload: () => ({ reference: record.id, lastWorkingDay: record.lastWorkingDay, netPayable: settlement?.netPayable ?? null, relievingLetter: letter?.filename ?? null }),
    after: async () => {
      await r.bot(
        <>
          All done, {record.fullName.split(/\s+/)[0]}. Here’s where things stand:
          <ul className="cl">
            <li><span>Last working day</span><b>{formatDate(record.lastWorkingDay)}</b></li>
            <li><span>Microsoft 365</span><b>{outcomeOf('o365_block', 'Sign-in blocked')}</b></li>
            <li><span>OrangeHRM</span><b>{outcomeOf('hrm_terminate', 'Employment ended')}</b></li>
            <li><span>Laptop</span><b>{outcomeOf('asset_return', 'Return ticket raised')}</b></li>
            {settlement && <li><span>Settlement (estimate)</span><b>{formatInr(settlement.netPayable)}</b></li>}
            {letter?.filename && <li><span>Relieving letter</span><b>{letter.emailed ? 'E-mailed' : 'Generated'}</b></li>}
          </ul>
          {letter?.filename && !S.api.simulated && <a href={relievingLetterUrl(record.id)} target="_blank" rel="noreferrer">Download the relieving letter</a>}
        </>,
      );
      set({ stage: 'done', outcome: true });
    },
  }]);
}

/** @param auto  null for Manual; { employeeId } for Auto-play · Live (the chosen employee's resignation plays by itself) */
export async function runLiveOffboarding({ r, set, auto = null, simulated = false }) {
  const S = { api: simulated ? createSimulatedOffboardingApi(r.timing.stepScale) : realApi };
  const ask = makeAsk(r, auto);
  r.msg('sys', simulated
    ? 'Auto-play · Simulated: this plays a resignation for a sample employee. Nothing is contacted or changed anywhere.'
    : auto
    ? 'Auto-play · Live: this plays a resignation for the employee you chose. Everything is real: it creates a real offboarding record and ticket, and changes real accounts after HR approves.'
    : 'Manual mode: you are the employee leaving. Type a message to begin. Everything is real: it creates a real offboarding record and ticket, and changes real accounts after HR approves.');
  set({ stage: 'idle' });
  const options = await S.api.getOffboardingOptions().catch(() => FALLBACK_OPTIONS);

  const first = await ask({ kind: 'text', suggestions: ['I want to resign'] }, { text: 'I want to resign' });
  r.msg('out', first.text);
  await greeting({ r, text: first.text });

  const employee = await identify({ r, set, ask, auto, api: S.api });
  await submit({ r, S, set, employee, options, ask, auto });
  if (S.stopped) return;
  await r.phaseGap();
  await approveAndRun({ r, S, set });
  if (S.stopped) return;
  await r.phaseGap();
  await farewell({ r, S, set });
}

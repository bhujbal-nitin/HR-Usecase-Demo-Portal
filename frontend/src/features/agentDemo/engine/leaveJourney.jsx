import * as realApi from '../../../api/leave';
import { createSimulatedLeaveApi } from './simulatedLeaveApi';
import { formatDate } from '../../../utils/format';
import {
  ATTENDANCE_FIELDS, IN_PUNCH, LEAVE_FIELDS, LEAVE_POLICY, SCENARIOS, SHIFT_END, addDays, attendanceDateRange, detectIntent, hoursWorked, previousWorkingDays,
  sampleLeaveDates,
} from '../lib/leave';
import { trigger } from './phases/common';
import { leaveWorkflowStep } from './phases/leaveWorkflow';

// Leave & attendance. Manual: YOU are the employee and the chat waits for you at every step. Auto-play: the same journey with the
// chosen employee's answers filled in for you. Live: leave types, balances, holidays and punches are worked out in OrangeHRM (each step is
// preceded by its AutomationEdge workflow), the manager decides on the Approvals page (Leave tab), and the approved leave or attendance request is then
// recorded in OrangeHRM. Auto-play · Simulated: the very same journey runs against simulatedLeaveApi, so the three flows cannot
// drift apart; its steps are tagged Simulated. A failed or unconfigured system makes its step fail, with Rerun / Skip.

/**
 * Manual: wait for the person. Auto-play: wait a moment, then answer with the scripted value. When the question has suggestion chips,
 * Auto-play shows them like Manual does and taps the one named by `awaiting.pick` before it answers.
 */
export const makeAsk = (r, auto) => async (awaiting, scripted) => {
  if (!auto) return r.ask(awaiting);
  const list = awaiting.suggestions;
  if (!list?.length || !awaiting.pick) return r.sleep(900).then(() => scripted);
  r.dispatch({ type: 'set', patch: { chips: { list, picked: null } } });
  await r.sleep(900);
  r.dispatch({ type: 'set', patch: { chips: { list, picked: awaiting.pick } } });
  await r.sleep(600);
  r.dispatch({ type: 'set', patch: { chips: null } });
  return scripted;
};

const DECISION_POLL_MS = 2000;
const FALLBACK_LEAVE_TYPES = Object.keys(LEAVE_POLICY); // only used if the step that reads them from OrangeHRM is skipped
export const firstName = (employee) => employee.fullName.split(/\s+/)[0];
export const days = (count) => `${count} day${count === 1 ? '' : 's'}`;

/** A simple answer card for the chat. */
export const card = (title, icon, badge, rows) => ({ title, icon, badge, rows });
export const showCard = (r, widget) => r.msg('in', null, { kind: 'widget', widget, wide: true });

/** Phase: the agent reads the message and picks what to do. */
export async function understand({ r, text, intent, workflow }) {
  const phase = r.phase('Understand the request', 'The agent reads the message and works out what is being asked.');
  await r.runSteps(phase, [
    trigger('Inbound message received', 'WhatsApp would deliver your message.', {
      object: 'whatsapp_business_account', type: 'text', text: { body: text }, timestamp: Math.floor(Date.now() / 1000),
    }),
    {
      kind: 'agent', agent: 'orch', title: 'Understand intent', note: 'The LLM reads the message and picks the workflow.', name: 'llm.classify_intent()', lat: 540,
      payload: { thread_state: 'OPEN_THREAD', intent, confidence: 0.96, workflow },
    },
  ]);
}

/** Ask until the portal recognises an onboarded employee. Returns the employee summary. */
export async function identify({ r, set, ask, auto, api }) {
  set({ stage: 'identify' });
  for (;;) {
    const { text } = await ask({ kind: 'text', suggestions: [] }, { text: auto?.employeeId });
    r.msg('out', text);
    const phase = r.phase('Identify the employee', 'The HR records are searched for the employees onboarded through this portal.');
    let found = null;
    let reason = '';
    await r.runSteps(phase, [{
      kind: 'tool', agent: 'orch', title: 'Look up the employee', name: 'employees.lookup()', live: !api.simulated,
      note: 'Checks the HR records for an onboarded employee with this ID or e-mail address.',
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
    if (auto) throw new Error(`The chosen employee could not be found: ${reason}`);
    await r.bot(<>{reason} Please try your employee ID or work e-mail again.</>, { wait: 500 });
  }
}

/** An in-chat form. Auto-play fills it in one field at a time, then submits; Manual waits for the person. Returns the values. */
export async function fillForm({ r, set, ask, auto, form, sample }) {
  const formId = r.msg('in', null, { kind: 'chatForm', wide: true, form: { ...form, values: auto ? {} : null, auto: Boolean(auto), submitted: false } });
  set({ stage: 'form' });
  let values;
  if (auto) {
    values = {};
    for (const { id } of form.fields) {
      await r.sleep(450);
      values[id] = sample[id];
      r.patchMsg(formId, { form: { ...form, submitted: false, auto: true, values: { ...values } } });
    }
    await r.sleep(700);
  } else {
    ({ values } = await ask({ kind: 'form' }, { values: sample }));
  }
  r.patchMsg(formId, { form: { ...form, submitted: true, auto: false, values } });
  return values;
}

/** Where a request waits for the manager: the agent's map node, the Approvals tab, and how to read and (simulated) approve the record. */
const LEAVE_DECISION = {
  agent: 'leave', tab: 'leave', tabName: 'Leave tab', noun: 'request',
  get: (api, id) => api.getLeaveRequest(id), approve: (api, id) => api.approveLeaveRequest(id),
};

/**
 * The manager's decision. Simulated: waits a moment, then approves itself (or click Approve now). Live: waits, as long as it takes,
 * for the manager to decide on the Approvals page. Returns 'approved', 'rejected' or 'stopped'.
 * @param channel  where the record waits (default: leave & attendance requests)
 */
export async function awaitDecision({ r, S, set, record, channel = LEAVE_DECISION }) {
  const phase = r.phase('Manager approval', `The ${channel.noun} goes to the employee’s manager. Nothing is changed until it is decided.`);
  let outcome = 'approved';
  await r.runSteps(phase, [{
    kind: 'human', agent: channel.agent, title: 'Manager approval', name: 'hr.approve()', live: !S.api.simulated,
    note: S.api.simulated
      ? `Simulated: the ${channel.noun} waits for the manager for a moment, then approves itself. Click Approve now to go sooner.`
      : `The manager decides on the Approvals page (${channel.tabName}); the run continues as soon as the ${channel.noun} is approved or rejected.`,
    run: async ({ patch, waitForGate }) => {
      if (S.api.simulated) {
        const waitMs = r.timing.approvalWaitMs;
        patch({
          gate: true,
          payload: { waiting_for: 'the manager', request: record.id, autoApproveAt: Date.now() + waitMs, warning: 'Simulated: nothing is saved anywhere. This approves itself shortly, or click now.', approveLabel: 'Approve now' },
        });
        const choice = await Promise.race([waitForGate(), r.wait(waitMs).then(() => 'auto')]);
        patch({ gate: false });
        if (choice === 'stop') {
          outcome = 'stopped';
          return { payload: { decision: 'STOPPED_BY_OPERATOR', note: 'The demo was stopped before approval.' }, warn: true, lat: 0 };
        }
        return { payload: { decision: choice === 'auto' ? 'AUTO_APPROVED' : 'APPROVED', approver: choice === 'auto' ? 'automatic after the wait (demo)' : 'the manager (this browser)', request: record.id }, lat: 0 };
      }
      patch({ awaitHr: true, payload: { waiting_for: 'the manager, on the Approvals page', request: record.id, openTo: `/approvals?tab=${channel.tab}` } });
      for (;;) {
        const current = await channel.get(S.api, record.id);
        if (current.status !== 'Pending Approval') {
          patch({ awaitHr: false });
          outcome = current.status === 'Rejected' ? 'rejected' : 'approved';
          break;
        }
        await r.wait(DECISION_POLL_MS);
      }
      return { payload: { decision: outcome === 'rejected' ? 'REJECTED' : 'APPROVED', approver: 'the manager (Approvals page)', request: record.id }, warn: outcome === 'rejected', lat: 0 };
    },
  }]);
  if (outcome === 'stopped') {
    S.stopped = true;
    return outcome;
  }
  set({ stage: 'apply' });
  if (S.api.simulated && outcome === 'approved') await channel.approve(S.api, record.id); // live: already decided on the Approvals page
  return outcome;
}

// ------------------------------------------------------------------------------------------------ the three requests
/** 1. Balances and holidays. */
async function balances({ r, S, employee }) {
  let list = [];
  let holidays = [];
  const phase = r.phase('Leave balance and holidays', 'The leave balances and the company holiday calendar are read from OrangeHRM.');
  await r.runSteps(phase, [
    leaveWorkflowStep(S, 'balance'),
    {
      kind: 'tool', agent: 'leave', title: 'Read the leave balances in OrangeHRM', name: 'orangehrm.leave_balances()', live: !S.api.simulated,
      note: 'Reads the employee’s balance for every leave type they have an entitlement for.',
      run: async () => {
        list = await S.api.getBalances(employee.employeeId);
        return { payload: Object.fromEntries(list.map((b) => [b.leaveType, `${b.left} left of ${b.total}`])) };
      },
    },
    {
      kind: 'tool', agent: 'leave', title: 'Read the holiday calendar in OrangeHRM', name: 'orangehrm.holidays()', live: !S.api.simulated,
      note: 'Looks up the next company holidays.',
      run: async () => {
        holidays = await S.api.getHolidays();
        return { payload: { upcoming: holidays.map((h) => `${formatDate(h.date)} ${h.name}`) } };
      },
    },
  ]);

  await r.bot(<>Here are your leave balances, {firstName(employee)}.</>, { wait: 500 });
  showCard(r, card('Leave balances', 'fa-umbrella-beach', { label: 'Updated today', tone: 'verified' }, list.map((b) => [
    `${b.leaveType}:`, <span key="left"><strong>{days(b.left)} left</strong> (used {b.used} of {b.total}{b.pending ? `, ${b.pending} waiting for approval` : ''})</span>,
  ])));
  await r.sleep(500);
  if (holidays.length) {
    await r.bot('And the next company holidays:', { wait: 500 });
    showCard(r, card('Company holidays', 'fa-champagne-glasses', { label: 'Calendar', tone: 'approved' }, holidays.map((h) => [`${formatDate(h.date)}:`, h.name])));
  } else {
    await r.bot('There are no upcoming company holidays set up in OrangeHRM yet.', { wait: 500 });
  }
}

/** The check phase of a leave request; returns { check } (null if its step was skipped). */
async function checkLeave({ r, S, employee, values }) {
  let check = null;
  const request = { employeeRef: employee.employeeId, leaveType: values.leaveType, startDate: values.startDate, endDate: values.endDate };
  const phase = r.phase('Check the leave request', 'The dates are checked against OrangeHRM (work week, holidays, your balance and existing leave) before anything is saved.');
  await r.runSteps(phase, [
    trigger('Form submission received', 'The form arrives as a structured reply, not free text.', { type: 'interactive', nfm_reply: { name: 'leave_application_v1', response_json: { employee: employee.employeeId, ...values } } }),
    leaveWorkflowStep(S, 'check'),
    {
      kind: 'tool', agent: 'leave', title: 'Check the balance in OrangeHRM', name: 'orangehrm.check_leave()', live: !S.api.simulated,
      note: 'Counts the working days (OrangeHRM’s work week and holidays) and compares them with the employee’s balance there.',
      run: async () => {
        check = await S.api.checkLeave(request);
        return { payload: { leaveType: check.leaveType, workingDays: check.days, balanceBefore: check.balanceBefore, balanceAfter: check.balanceAfter, holidaysInThePeriod: check.holidaysSkipped.map((h) => h.name).join(', ') || 'none' } };
      },
    },
    {
      kind: 'tool', agent: 'leave', title: 'Apply the leave rules', name: 'policy.check_leave()', live: !S.api.simulated,
      note: 'Checks the dates and the balance against the rules: not in the past, not already booked, enough days left.',
      run: async () => {
        await r.sleep(500);
        return { warn: Boolean(check) && !check.ok, payload: check ? { result: check.ok ? 'Within the rules' : 'Not allowed', problems: check.problems } : { result: 'Not checked' } };
      },
    },
  ]);
  return { check };
}

/** Auto-play: two working days for the sample request that fit the employee's real balance and calendar (quiet checks, nothing is saved). */
async function pickSampleLeave({ S, employee, leaveTypes: available }) {
  const balance = (await S.api.getBalances(employee.employeeId).catch(() => [])).find((b) => b.left >= 2);
  const leaveType = balance?.leaveType ?? available[0];
  let { startDate, endDate } = sampleLeaveDates();
  for (let week = 0; week < 12; week += 1) {
    const check = await S.api.checkLeave({ employeeRef: employee.employeeId, leaveType, startDate, endDate }).catch(() => null);
    if (!check || check.ok || !check.problems.some((problem) => /already have leave/.test(problem))) break;
    ({ startDate, endDate } = { startDate: addDays(startDate, 7), endDate: addDays(endDate, 7) }); // that week is taken: try the next one
  }
  return { leaveType, startDate, endDate, reason: 'Family function' };
}

/** 2. Applying for leave. */
async function applyForLeave({ r, S, set, ask, auto, employee }) {
  let leaveTypes = FALLBACK_LEAVE_TYPES;
  const prepare = r.phase('Prepare the leave form', 'The leave types you can choose from are read from OrangeHRM.');
  await r.runSteps(prepare, [{
    kind: 'tool', agent: 'leave', title: 'Read the leave types in OrangeHRM', name: 'orangehrm.leave_types()', live: !S.api.simulated,
    note: 'Reads the leave types that are set up in OrangeHRM, for the form.',
    run: async () => {
      leaveTypes = (await S.api.getLeaveOptions()).leaveTypes;
      return { payload: { leaveTypes } };
    },
  }]);
  await r.bot('Sure. Please fill in your leave details below and tap Submit.', { wait: 500 });
  const form = {
    title: 'Leave application', hint: 'Only working days count: weekends and company holidays are not deducted.', validator: 'leave',
    fields: LEAVE_FIELDS.map((field) => (field.id === 'leaveType'
      ? { ...field, options: leaveTypes.map((value) => ({ value, label: value })) }
      : field.type === 'date' ? { ...field, minToday: true } : field)),
  };
  const sample = auto ? await pickSampleLeave({ S, employee, leaveTypes }) : null;

  let values;
  let outcome = { check: null };
  for (;;) {
    values = await fillForm({ r, set, ask, auto, form, sample });
    r.msg('out', <><b>{values.leaveType}</b>: {formatDate(values.startDate)} to {formatDate(values.endDate)}<br />{values.reason}</>);
    await r.phaseGap();
    outcome = await checkLeave({ r, S, employee, values });
    if (outcome.check?.ok) break;
    if (!outcome.check) {
      await r.bot('Sorry, I could not check that request right now. Please try again shortly.', { wait: 500 });
      return;
    }
    if (auto) throw new Error(`The sample leave request did not pass the checks: ${outcome.check.problems.join(' ')}`);
    await r.bot(<>I can’t submit that yet:<ul className="cl">{outcome.check.problems.map((problem) => <li key={problem}><span>{problem}</span></li>)}</ul>Please change the form and submit it again.</>, { wait: 500 });
  }
  const { check } = outcome;

  await r.bot(
    <>
      That works: <b>{days(check.days)}</b> of {check.leaveType}, leaving you <b>{days(check.balanceAfter)}</b>.
      {check.holidaysSkipped.length > 0 && <> {check.holidaysSkipped.map((h) => h.name).join(', ')} falls in this period and is not counted.</>}
    </>,
  );
  await r.phaseGap();

  let record = null;
  const submit = r.phase('Send for approval', 'The request is saved and goes to the manager.');
  await r.runSteps(submit, [{
    kind: 'api', agent: 'leave', title: 'Submit the leave request', name: 'POST /api/leave/requests', live: !S.api.simulated, noSkip: true,
    note: 'Saves the request. The days are held in your balance while it waits.',
    run: async () => {
      record = await S.api.submitLeave({ employeeRef: employee.employeeId, ...values });
      if (!S.api.simulated) set({ runRecord: { kind: 'leave', id: record.id } }); // lets the header open what this run created
      return { payload: { reference: record.id, status: record.status, leaveType: record.leaveType, workingDays: record.days, balanceAfter: record.balanceAfter } };
    },
  }]);
  set({ stage: 'review' });
  await r.bot(<>Your request <b>{record.id}</b> is with <b>{record.manager}</b> for approval. I’ll tell you as soon as it is decided.</>);
  await r.phaseGap();

  const decision = await awaitDecision({ r, S, set, record });
  if (decision === 'stopped') return;
  if (decision === 'rejected') {
    await r.bot(<>Your manager did not approve <b>{record.id}</b>. Nothing was changed, and the {days(record.days)} are back in your balance.</>, { wait: 500 });
    return;
  }
  await r.phaseGap();

  let approved = record;
  let balance = null;
  const apply = r.phase('Apply the decision', 'The approved leave is booked in OrangeHRM and the balance is read again.');
  await r.runSteps(apply, [
    leaveWorkflowStep(S, 'assign-leave'),
    {
      kind: 'api', agent: 'leave', title: 'Record the leave in OrangeHRM', name: 'orangehrm.assign_leave()', live: !S.api.simulated,
      note: 'Books the approved leave on the employee’s OrangeHRM record.',
      run: async () => {
        approved = await S.api.applyLeaveRequest(record.id);
        return { payload: { reference: approved.id, status: 'Recorded in OrangeHRM', leaveType: approved.leaveType, from: approved.startDate, to: approved.endDate, workingDays: approved.days } };
      },
    },
    {
      kind: 'tool', agent: 'leave', title: 'Read the new balance', name: 'orangehrm.leave_balances()', live: !S.api.simulated,
      note: 'Reads the balance again from OrangeHRM, now that the leave is booked.',
      run: async () => {
        balance = (await S.api.getBalances(employee.employeeId)).find((b) => b.leaveType === record.leaveType);
        return { payload: { leaveType: record.leaveType, used: balance?.used ?? null, left: balance?.left ?? null } };
      },
    },
    {
      kind: 'notify', agent: 'leave', title: 'Confirm to the employee', name: 'whatsapp.send_text()', lat: 180,
      note: 'One message with the decision and the new balance.',
      payload: () => ({ reference: approved.id, status: approved.status, balanceLeft: balance?.left ?? null }),
      after: async () => {
        await r.bot(<>Good news, {firstName(employee)}: your leave is <b>approved</b>.</>, { wait: 500 });
        showCard(r, card('Leave approved', 'fa-calendar-check', { label: 'Approved', tone: 'approved' }, [
          ['Reference:', approved.id],
          ['Leave type:', approved.leaveType],
          ['Dates:', `${formatDate(approved.startDate)} to ${formatDate(approved.endDate)} (${days(approved.days)})`],
          ['Left in your balance:', balance ? `${days(balance.left)} of ${approved.leaveType}` : '—'],
          ['Approved by:', approved.manager],
        ]));
      },
    },
  ]);
}

/** Auto-play: the latest recent working day OrangeHRM holds no punch record for (an approved request replaces a day, so a free one is kinder). */
async function pickSampleDay({ S, employee }) {
  const days = previousWorkingDays(8);
  for (const day of days) {
    const found = await S.api.getAttendance(employee.employeeId, day).catch(() => null);
    if (found && found.records.length === 0) return day;
  }
  return days[0];
}

/** 3. An attendance request: the day and both times come from the employee; the day is written to OrangeHRM once the manager approves. */
async function attendanceRequest({ r, S, set, ask, auto, employee }) {
  await r.bot('Sure. Tell me the day, when you came in and when you left, and why, and I’ll send the request to your manager.', { wait: 500 });
  const { min, max } = attendanceDateRange();
  const form = {
    title: 'Attendance request', hint: 'Choose a day within the last 30 days, the time you came in and the time you left.', validator: 'attendance',
    defaults: { inPunch: IN_PUNCH, outPunch: SHIFT_END },
    fields: ATTENDANCE_FIELDS.map((field) => (field.id === 'attendanceDate' ? { ...field, min, max } : field)),
  };
  const sample = auto ? { attendanceDate: await pickSampleDay({ S, employee }), inPunch: IN_PUNCH, outPunch: SHIFT_END, reason: 'I forgot to punch in and out that day' } : null;
  const values = await fillForm({ r, set, ask, auto, form, sample });
  r.msg('out', <><b>{formatDate(values.attendanceDate)}</b>: in {values.inPunch}, out {values.outPunch}<br />{values.reason}</>);
  await r.phaseGap();

  let day = null;
  const read = r.phase('Attendance check', 'The day is looked up in OrangeHRM before the request is sent.');
  await r.runSteps(read, [
    trigger('Form submission received', 'The form arrives as a structured reply, not free text.', { type: 'interactive', nfm_reply: { name: 'attendance_request_v1', response_json: { employee: employee.employeeId, ...values } } }),
    leaveWorkflowStep(S, 'attendance'),
    {
      kind: 'tool', agent: 'leave', title: 'Read the punch records in OrangeHRM', name: 'orangehrm.punch_log()', live: !S.api.simulated,
      note: 'Reads what OrangeHRM already holds for that day. An approved request replaces it.',
      run: async () => {
        day = await S.api.getAttendance(employee.employeeId, values.attendanceDate);
        return { payload: { day: formatDate(day.date), records: day.records.length ? day.records.map((p) => `In ${p.inPunch}, out ${p.outPunch ?? 'missing'}`) : 'none' } };
      },
    },
    {
      kind: 'tool', agent: 'orch', title: 'Validate the request', name: 'validators.run()', lat: 60, live: !S.api.simulated,
      note: 'Checks the day and the two times before anything is saved.',
      payload: () => ({ day: formatDate(values.attendanceDate), inTime: values.inPunch, outTime: values.outPunch, hoursWorked: hoursWorked(values.inPunch, values.outPunch) }),
    },
  ]);
  if (day?.records.length) {
    const held = day.records.map((p) => `in ${p.inPunch}, out ${p.outPunch ?? 'missing'}`).join('; ');
    await r.bot(<>OrangeHRM already has a punch record for <b>{formatDate(values.attendanceDate)}</b> ({held}). If your manager approves, it is replaced with the times you gave.</>, { wait: 500 });
  }
  await r.phaseGap();

  let record = null;
  const submit = r.phase('Send for approval', 'The request is saved and goes to the manager.');
  await r.runSteps(submit, [{
    kind: 'api', agent: 'leave', title: 'Submit the attendance request', name: 'POST /api/leave/requests', live: !S.api.simulated, noSkip: true,
    note: 'Saves the request. It is written to OrangeHRM only once the manager approves it.',
    run: async () => {
      record = await S.api.submitRegularization({ employeeRef: employee.employeeId, attendanceDate: values.attendanceDate, inPunch: values.inPunch, outPunch: values.outPunch, reason: values.reason });
      if (!S.api.simulated) set({ runRecord: { kind: 'leave', id: record.id } });
      return { payload: { reference: record.id, status: record.status, day: formatDate(record.attendanceDate), inTime: record.inPunch, outTime: record.outPunch, hoursWorked: record.hoursWorked } };
    },
  }]);
  set({ stage: 'review' });
  await r.bot(<>Your attendance request <b>{record.id}</b> is with <b>{record.manager}</b> for approval.</>);
  await r.phaseGap();

  const decision = await awaitDecision({ r, S, set, record });
  if (decision === 'stopped') return;
  if (decision === 'rejected') {
    await r.bot(<>Your manager did not approve <b>{record.id}</b>, so your attendance for {formatDate(record.attendanceDate)} is unchanged.</>, { wait: 500 });
    return;
  }
  await r.phaseGap();

  let saved = null;
  const apply = r.phase('Apply the decision', 'The approved day is written to OrangeHRM (punch in, then punch out) and read back.');
  await r.runSteps(apply, [
    leaveWorkflowStep(S, 'punch-in'),
    leaveWorkflowStep(S, 'punch-out'),
    {
      kind: 'api', agent: 'leave', title: 'Record the attendance in OrangeHRM', name: 'orangehrm.record_attendance()', live: !S.api.simulated,
      note: 'Punches the employee in and out in OrangeHRM at the approved times, replacing any record the day already had, then reads the day back.',
      run: async () => {
        await S.api.applyLeaveRequest(record.id);
        saved = (await S.api.getAttendance(employee.employeeId, record.attendanceDate)).records.at(-1);
        return { payload: { day: formatDate(record.attendanceDate), inTime: saved?.inPunch ?? record.inPunch, outTime: saved?.outPunch ?? record.outPunch, hoursWorked: record.hoursWorked } };
      },
    },
    {
      kind: 'notify', agent: 'leave', title: 'Confirm to the employee', name: 'whatsapp.send_text()', lat: 180,
      note: 'One message with the decision and the recorded times.',
      payload: () => ({ reference: record.id, day: formatDate(record.attendanceDate), hoursWorked: record.hoursWorked }),
      after: async () => {
        await r.bot(<>Done, {firstName(employee)}: your attendance request is <b>approved</b>.</>, { wait: 500 });
        showCard(r, card('Attendance updated', 'fa-circle-check', { label: 'Approved', tone: 'approved' }, [
          ['Day:', formatDate(record.attendanceDate)],
          ['In:', saved?.inPunch ?? record.inPunch],
          ['Out:', saved?.outPunch ?? record.outPunch],
          ['Hours worked:', record.hoursWorked],
          ['Approved by:', record.manager],
        ]));
      },
    },
  ]);
}

const SCENARIO_RUNNERS = { balance: balances, apply: applyForLeave, attendance: attendanceRequest };

/** @param auto  null for Manual; { employeeId } for Auto-play (the employee's three requests play by themselves) */
export async function runLeaveAttendance({ r, set, auto = null, simulated = false }) {
  const S = { api: simulated ? createSimulatedLeaveApi(r.timing.stepScale) : realApi, stopped: false };
  const ask = makeAsk(r, auto);
  r.msg('sys', simulated
    ? 'Auto-play · Simulated: this plays the three requests for a sample employee. Nothing is contacted or saved anywhere.'
    : auto
    ? 'Auto-play · Live: this plays the three requests for the employee you chose. It is real: everything is read from and recorded in OrangeHRM, after the manager decides on the Approvals page.'
    : 'Manual mode: you are the employee. Type a message to begin. It is real: everything is read from and recorded in OrangeHRM, after the manager decides on the Approvals page.');
  set({ stage: 'idle' });

  const first = await ask({ kind: 'text', suggestions: ['Hi'] }, { text: 'Hi' });
  r.msg('out', first.text);
  await understand({ r, text: first.text, intent: 'greeting', workflow: 'leave_attendance.v1' });
  await r.bot('Hi, I’m your leave and attendance assistant.');
  await r.bot(<>First, who are you? Please type your <b>employee ID</b> (like AE-123456) or your <b>work e-mail</b>.</>, { wait: 500 });

  const employee = await identify({ r, set, ask, auto, api: S.api });
  await r.bot(<>Thanks, <b>{firstName(employee)}</b>. I found you: <b>{employee.jobTitle}</b>, {employee.department}, reporting to {employee.manager}.</>);
  await r.bot('I can check your leave balance and the holidays, apply for leave, or raise an attendance request. What would you like to do?', { wait: 600 });

  const context = { r, S, set, ask, auto, employee };
  if (auto) {
    for (const scenario of SCENARIOS) {
      const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label), pick: scenario.label }, { text: scenario.label });
      r.msg('out', text);
      await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
      await SCENARIO_RUNNERS[scenario.id](context);
      if (S.stopped) break;
      await r.phaseGap();
    }
  } else {
    for (;;) {
      const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label) });
      r.msg('out', text);
      const intent = detectIntent(text);
      if (intent === 'done') break;
      const scenario = SCENARIOS.find((s) => s.id === intent);
      if (!scenario) {
        await r.bot('I can help with your leave balance and holidays, applying for leave, or an attendance request. Try one of the suggestions below.', { wait: 600 });
        continue;
      }
      await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
      await SCENARIO_RUNNERS[scenario.id](context);
      if (S.stopped) break;
      await r.bot('Is there anything else I can help you with?', { wait: 600 });
    }
  }

  if (S.stopped) {
    await r.bot('The request is with your manager. You’ll hear from us once it is decided.', { wait: 500 });
    set({ stage: 'done', stopped: true });
    return;
  }
  await r.phaseGap();
  const bye = r.phase('Close the conversation', 'A short goodbye; the conversation is closed.');
  await r.runSteps(bye, [{
    kind: 'notify', agent: 'leave', title: 'Close the conversation', name: 'whatsapp.send_text()', lat: 160,
    note: 'The assistant says goodbye. Everything above is already saved.',
    payload: () => ({ message: 'Happy to help. Have a great day!' }),
    after: async () => {
      await r.bot(<>Happy to help, {firstName(employee)}. Have a great day!</>, { wait: 500 });
      set({ stage: 'done', outcome: true });
    },
  }]);
}

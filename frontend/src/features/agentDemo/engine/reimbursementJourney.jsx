import * as realApi from '../../../api/reimbursement';
import { formatDate, formatInr } from '../../../utils/format';
import { BILL_ACCEPT, MAX_BILLS, SCENARIOS, buildSampleBills, detectIntent, splitByPolicy, totalOf, validateBill, withinPolicy } from '../lib/reimbursement';
import { trigger } from './phases/common';
import { awaitDecision, card, firstName, identify, loadSamples, askWho, makeAsk, showCard, understand } from './leaveJourney.jsx';
import { reimbursementWorkflowStep } from './phases/reimbursementWorkflow';
import { createSimulatedReimbursementApi } from './simulatedReimbursementApi';
import { fileInfo } from '../lib/fileInfo';

// Reimbursement & benefits. Manual: YOU are the employee and the chat waits for you at every step (you upload your own bills).
// Auto-play: the same journey with three sample bills uploaded for you. Live: each bill is scanned (category, date, amount,
// vendor), bills of every kind go into the claim (Travel and Food are within the company policy, a hint), the manager approves or rejects
// each bill on the Approvals page (Reimbursement tab), and the approved bills are then recorded in OrangeHRM (Claim). Auto-play · Simulated: the very same journey runs against
// simulatedReimbursementApi, so the flows cannot drift apart; its steps are tagged Simulated.
// Four AutomationEdge showcase workflows run, each right AFTER the step it stands for, and the chat goes on once it is Complete: Read Bill and
// Check Reimbursement Policy once after all the bills, Submit Expense Claim after the claim is saved, Create Claim OrangeHRM after the recording.

const money = (amount) => formatInr(amount);
const MORE_LABEL = 'Add another bill';
const DONE_LABEL = 'That’s all, show my claim';
const SUBMIT_LABEL = 'Submit claim for approval';
const CANCEL_LABEL = 'Cancel';
const wantsMore = (text) => text === MORE_LABEL || /another|more|next|add/i.test(text);

/** Where a claim waits for the manager (see awaitDecision). */
const CLAIM_DECISION = {
  agent: 'reimb', tab: 'reimbursement', tabName: 'Reimbursement tab', noun: 'claim',
  get: (api, id) => api.getClaim(id), approve: (api, id) => api.approveClaim(id),
};

/** One row of the bills table in the chat. */
const billRow = (bill) => [`${bill.expenseType}:`, `${bill.date ? formatDate(bill.date) : 'no date'} · ${money(bill.amount)} · ${bill.vendor}`];

/**
 * Ask for one bill and read it. Returns the bill, or null if the file could not be read (the employee is told why).
 * Manual: waits for the employee's file. Auto-play: sends the next sample bill.
 */
async function collectBill({ r, S, set, employee, auto, number, sample }) {
  const upload = { docKey: `bill-${number}`, label: `bill ${number}`, hint: 'PDF or photo (PNG, JPG, WEBP), up to 10 MB.', accept: BILL_ACCEPT };
  const cardId = r.msg('in', null, { kind: 'upload', wide: true, upload });
  set({ stage: 'docs' });
  let file;
  if (auto) {
    await r.sleep(900);
    file = sample.file;
  } else {
    ({ file } = await r.ask({ kind: 'attach', docKey: upload.docKey, label: upload.label, accept: BILL_ACCEPT }));
  }
  r.msg('out', null, { kind: 'file', file: fileInfo(file) });
  const problem = validateBill(file);
  if (problem) {
    r.patchMsg(cardId, { upload: { ...upload, error: problem } });
    await r.bot(<>That file can’t be used: {problem}</>, { wait: 500 });
    return null;
  }
  r.patchMsg(cardId, { upload: { ...upload, file: fileInfo(file) } });

  let bill = null;
  let failure = '';
  const phase = r.phase(`Read bill ${number}`, 'The bill is read: what kind of expense it is, its date, amount and vendor.');
  await r.runSteps(phase, [
    trigger('Document received', 'A file arrives on the thread.', { type: 'document', document: { mime_type: file.type || 'application/pdf', filename: file.name }, size_kb: Math.max(1, Math.round(file.size / 1024)) }),
    {
      kind: 'api', agent: 'reimb', title: 'Read the bill', name: 'scanner.read_bill()', live: !S.api.simulated,
      note: 'The bill is scanned: the kind of expense (Travel, Food, Mobile, Stay, Medical or Others), its date, the final amount and the vendor.',
      run: async () => {
        try {
          bill = await S.api.readBill(employee.employeeId, file);
        } catch (error) {
          failure = error.message ?? 'The bill could not be read.';
          return { warn: true, payload: { result: 'The bill could not be read', reason: failure } };
        }
        return { payload: { expenseType: bill.expenseType, date: bill.date ? formatDate(bill.date) : 'not printed', amount: money(bill.amount), vendor: bill.vendor } };
      },
    },
    {
      kind: 'tool', agent: 'reimb', title: 'Check the bill against the policy', name: 'policy.check_eligibility()', lat: 40, live: !S.api.simulated,
      note: 'Travel and Food are within the company policy; Mobile, Stay, Medical and Others are outside it. This is a hint: the manager decides every bill.',
      payload: () => (bill ? { expenseType: bill.expenseType, policy: withinPolicy(bill.expenseType) ? 'Within policy' : 'Outside policy', rule: 'Travel and Food are within policy; the manager decides every bill' } : { result: 'No bill to check' }),
    },
  ]);
  if (!bill) {
    r.patchMsg(cardId, { upload: { ...upload, error: failure } });
    if (auto) throw new Error(`The sample bill could not be read: ${failure}`);
    await r.bot(<>{failure}</>, { wait: 500 });
    return null;
  }
  await r.bot(
    <>Got it: a <b>{bill.expenseType}</b> bill from {bill.vendor} for <b>{money(bill.amount)}</b>{bill.date ? ` on ${formatDate(bill.date)}` : ''}. {withinPolicy(bill.expenseType) ? 'This is within the policy.' : 'This is outside the policy; your manager decides.'}</>,
    { wait: 500 },
  );
  return bill;
}

/** The two tables: the bills within the policy (with their total) and the ones outside it (with theirs). The manager decides every bill. */
async function showClaim(r, bills) {
  const [inside, outside] = splitByPolicy(bills);
  if (inside.length) {
    showCard(r, card('Within the policy', 'fa-circle-check', { label: 'Travel and Food', tone: 'approved' }, [
      ...inside.map(billRow),
      { cells: ['Total:', <strong key="t">{money(totalOf(inside))}</strong>], emphasis: 'total' },
    ]));
  }
  if (outside.length) {
    await r.sleep(400);
    showCard(r, card('Outside the policy', 'fa-circle-info', { label: 'Manager decides', tone: 'pending' }, [
      ...outside.map(billRow),
      { cells: ['Total:', <strong key="t">{money(totalOf(outside))}</strong>], emphasis: 'total' },
    ]));
  }
}

/** The expense claim: upload bills one after another, see the two tables, submit for approval, get it recorded in OrangeHRM. */
async function expenseClaim({ r, S, set, ask, auto, employee, samples }) {
  await r.bot('Sure. Please upload your bills one at a time, as a PDF or a photo. I’ll read each one.', { wait: 500 });
  const bills = [];
  while (bills.length < MAX_BILLS) {
    const bill = await collectBill({ r, S, set, employee, auto, number: bills.length + 1, sample: samples[bills.length] });
    if (bill) bills.push(bill);
    else if (auto) break;
    await r.phaseGap();
    if (bills.length === 0) {
      await r.bot('Please upload a bill I can read.', { wait: 400 });
      continue;
    }
    if (bills.length >= MAX_BILLS) break;
    const more = auto ? bills.length < samples.length : null; // Auto-play adds the next sample bill, then shows the claim
    const { text } = await ask({ kind: 'text', suggestions: [MORE_LABEL, DONE_LABEL], pick: more ? MORE_LABEL : DONE_LABEL }, { text: more ? MORE_LABEL : DONE_LABEL });
    r.msg('out', text);
    if (!wantsMore(text)) break;
    await r.bot('Please upload the next bill.', { wait: 400 });
  }

  if (bills.length > 0) {
    const read = r.phase('Bills read and checked', 'Once all the bills are in, AutomationEdge runs the read bill and policy check workflows.');
    await r.runSteps(read, [reimbursementWorkflowStep(S, 'read-bill'), reimbursementWorkflowStep(S, 'check-policy')]);
    await r.phaseGap();
  }

  await r.bot(<>Here is your claim, {firstName(employee)}: {bills.length} bill{bills.length === 1 ? '' : 's'}.</>, { wait: 500 });
  await showClaim(r, bills);
  const [, outside] = splitByPolicy(bills);
  await r.bot(
    <>Shall I send all {bills.length} bill{bills.length === 1 ? '' : 's'} (<b>{money(totalOf(bills))}</b>) to your manager for approval?{outside.length > 0 && ' Bills outside the policy can still be approved by your manager.'}</>,
    { wait: 500 },
  );
  const { text: answer } = await ask(
    { kind: 'text', suggestions: [SUBMIT_LABEL, CANCEL_LABEL], pick: SUBMIT_LABEL },
    { text: SUBMIT_LABEL },
  );
  r.msg('out', answer);
  if (answer !== SUBMIT_LABEL && !/submit|send|yes|ok|approve/i.test(answer)) {
    await r.bot('No problem, I have not sent anything. Upload your bills again whenever you like.', { wait: 500 });
    return;
  }
  await r.phaseGap();

  let claim = null;
  const submit = r.phase('Send for approval', 'The claim is saved and goes to the manager.');
  await r.runSteps(submit, [{
    kind: 'api', agent: 'reimb', title: 'Submit the claim', name: 'POST /api/reimbursement/claims', live: !S.api.simulated, noSkip: true,
    note: 'Saves the claim with every bill. The manager approves or rejects each bill; the approved ones are recorded in OrangeHRM.',
    run: async () => {
      claim = await S.api.submitClaim({ employeeRef: employee.employeeId, items: bills });
      if (!S.api.simulated) set({ runRecord: { kind: 'reimbursement', id: claim.id } }); // lets the header open what this run created
      return { payload: { reference: claim.id, status: claim.status, bills: claim.items.length, total: money(claim.totalAmount) } };
    },
  }, reimbursementWorkflowStep(S, 'submit-claim')]);
  set({ stage: 'review' });
  await r.bot(<>Your claim <b>{claim.id}</b> for <b>{money(claim.totalAmount)}</b> is with <b>{claim.manager}</b> for approval. I’ll tell you as soon as it is decided.</>);
  await r.phaseGap();

  const decision = await awaitDecision({ r, S, set, record: claim, channel: CLAIM_DECISION });
  if (decision === 'stopped') return;
  if (decision === 'rejected') {
    await r.bot(<>Your manager did not approve any bill in <b>{claim.id}</b>. Nothing was recorded.</>, { wait: 500 });
    return;
  }
  await r.phaseGap();

  let approved = claim;
  const apply = r.phase('Apply the decision', 'The approved claim is recorded in OrangeHRM (Claim).');
  await r.runSteps(apply, [
    {
      kind: 'api', agent: 'reimb', title: 'Record the claim in OrangeHRM', name: 'orangehrm.record_claim()', live: !S.api.simulated,
      note: 'Creates the claim for the employee in OrangeHRM with the approved bills as expenses (in INR) and submits it. The claim event and the expense types are created there if they are missing.',
      run: async () => {
        approved = await S.api.applyClaim(claim.id);
        return { payload: { reference: approved.id, status: 'Recorded in OrangeHRM', orangeHrmClaim: approved.orangeHrmId, expenses: approved.items.filter((b) => b.approved).length, amount: money(approved.approvedTotal) } };
      },
    },
    reimbursementWorkflowStep(S, 'create-claim'),
    {
      kind: 'notify', agent: 'reimb', title: 'Confirm to the employee', name: 'whatsapp.send_text()', lat: 180,
      note: 'One message with the decision and the amount.',
      payload: () => ({ reference: approved.id, status: approved.status, approvedBills: approved.items.filter((b) => b.approved).length, amount: money(approved.approvedTotal) }),
      after: async () => {
        const yes = approved.items.filter((b) => b.approved);
        const no = approved.items.filter((b) => !b.approved);
        await r.bot(
          no.length === 0
            ? <>Good news, {firstName(employee)}: your manager <b>approved all {yes.length} bill{yes.length === 1 ? '' : 's'}</b>.</>
            : <>Your manager <b>approved {yes.length} of {approved.items.length} bills</b>, {firstName(employee)}.</>,
          { wait: 500 },
        );
        showCard(r, card('Claim decided', 'fa-file-invoice-dollar', { label: no.length ? 'Partly approved' : 'Approved', tone: 'approved' }, [
          ['Reference:', approved.id],
          ...yes.map((b) => [`Approved · ${b.expenseType}:`, `${money(b.amount)} · ${b.vendor}`]),
          ...no.map((b) => [`Not approved · ${b.expenseType}:`, `${money(b.amount)} · ${b.vendor}`]),
          { cells: ['Approved amount:', <strong key="a">{money(approved.approvedTotal)}</strong>], emphasis: 'total' },
          ['Recorded in OrangeHRM:', approved.orangeHrmId ? `Claim #${approved.orangeHrmId}` : '—'],
          ['Decided by:', approved.manager],
        ]));
      },
    },
  ]);
}

/** @param auto  null for Manual; { employeeId } for Auto-play (three sample bills are uploaded for the employee) */
export async function runReimbursement({ r, set, auto = null, simulated = false }) {
  const samples = buildSampleBills();
  const S = { api: simulated ? createSimulatedReimbursementApi(r.timing.stepScale, samples) : realApi, stopped: false };
  const ask = makeAsk(r, auto);
  r.msg('sys', simulated
    ? 'Auto-play · Simulated: this uploads three sample bills for a sample employee. Nothing is contacted or saved anywhere.'
    : auto
    ? 'Auto-play · Live: this uploads three sample bills for the employee you chose. It is real: the bills are scanned and, after the manager decides on the Approvals page, the approved bills are recorded in OrangeHRM.'
    : 'Manual mode: you are the employee. Type a message to begin. It is real: your bills are scanned and, after the manager decides on the Approvals page, the approved bills are recorded in OrangeHRM.');
  set({ stage: 'idle' });

  const first = await ask({ kind: 'text', suggestions: ['Hi'] }, { text: 'Hi' });
  r.msg('out', first.text);
  await understand({ r, text: first.text, intent: 'greeting', workflow: 'reimbursement_benefits.v1' });
  await r.bot('Hi, I’m your reimbursement assistant.');
  const employeeSamples = await loadSamples('reimbursement', auto, S.api);
  await askWho(r, employeeSamples);

  const employee = await identify({ r, set, ask, auto, api: S.api, samples: employeeSamples });
  await r.bot(<>Thanks, <b>{firstName(employee)}</b>. I found you: <b>{employee.jobTitle}</b>, {employee.department}, reporting to {employee.manager}.</>);
  await r.bot('I can read your bills of any kind and send an expense claim to your manager, who approves or rejects each bill. What would you like to do?', { wait: 600 });

  const context = { r, S, set, ask, auto, employee, samples };
  if (auto) {
    const scenario = SCENARIOS[0];
    const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label), pick: scenario.label }, { text: scenario.label });
    r.msg('out', text);
    await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
    await expenseClaim(context);
  } else {
    for (;;) {
      const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label) });
      r.msg('out', text);
      const intent = detectIntent(text);
      if (intent === 'done') break;
      const scenario = SCENARIOS.find((s) => s.id === intent);
      if (!scenario) {
        await r.bot('I can read your bills and send an expense claim to your manager. Try the suggestion below.', { wait: 600 });
        continue;
      }
      await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
      await expenseClaim(context);
      if (S.stopped) break;
      await r.bot('Is there anything else I can help you with?', { wait: 600 });
    }
  }

  await r.phaseGap();
  const bye = r.phase('Close the conversation', 'A short goodbye; the conversation is closed.');
  await r.runSteps(bye, [{
    kind: 'notify', agent: 'reimb', title: 'Close the conversation', name: 'whatsapp.send_text()', lat: 160,
    note: 'The assistant says goodbye. Everything above is already saved.',
    payload: () => ({ message: 'Happy to help. Have a great day!' }),
    after: async () => {
      await r.bot(<>Happy to help, {firstName(employee)}. Have a great day!</>, { wait: 500 });
      set({ stage: 'done', outcome: true });
    },
  }]);
}

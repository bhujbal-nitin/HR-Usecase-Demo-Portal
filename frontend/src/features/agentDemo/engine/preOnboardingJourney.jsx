import { Link } from 'react-router-dom';
import * as realApi from '../../../api/preOnboarding';
import { formatDate, formatInr } from '../../../utils/format';
import DownloadLink from '../components/DownloadLink';
import { fileInfo } from '../lib/fileInfo';
import {
  DOCUMENTS, DOCUMENT_ACCEPT, GENDERS, MARITAL_STATUSES, SCENARIOS, SIMULATED_EMAIL, detectIntent, latestBirthDate, loadSampleFile, sampleDetails, sampleFileOf,
  samplePersonalFor, validateDocumentFile,
} from '../lib/preOnboarding';
import { awaitDecision, card, fillForm, firstName, makeAsk, showCard, understand } from './leaveJourney.jsx';
import { trigger } from './phases/common';
import { createSimulatedPreOnboardingApi } from './simulatedPreOnboardingApi';

// Pre-onboarding lifecycle. Manual: YOU are the candidate and the chat waits for you at every step. Auto-play: the same journey with a sample candidate whose
// seven sample documents are sent for you. The steps: 1 the offer is released (HR's details are entered, the offer letter is made and e-mailed), 2 the
// candidate accepts it and confirms the joining date, 3 fills in their personal information,
// 5 sends seven documents (each is read and its name compared with the candidate's), 6 the background verification is marked done by hand on the Approvals page, 7 HR approves on the Approvals
// page (Pre-Onboarding tab), 8 the joining instructions are made as a PDF and e-mailed, 9 pre-onboarding is completed (the ServiceNow request raised at the
// start is closed) and onboarding can begin. Auto-play · Simulated Environment: the very same journey runs against simulatedPreOnboardingApi, so the flows
// cannot drift apart; its steps are tagged Simulated. AutomationEdge is not used in this demo.

const money = (amount) => formatInr(Number(amount));

/** Where the pre-onboarding waits for HR (the human in the loop): see awaitDecision. */
const HR_APPROVAL = {
  agent: 'pre', tab: 'pre-onboarding', tabName: 'Pre-Onboarding tab', noun: 'pre-onboarding details', who: 'HR',
  phase: 'HR approval', phaseNote: 'HR reviews the details, the documents and the background check. Nothing moves on until they decide.', stepName: 'hr.approve_preonboarding()',
  get: (api, id) => api.getCandidate(id), approve: (api, id) => api.approveHr(id),
  pending: (record) => record.status === 'Awaiting HR approval', rejected: (record) => record.status === 'Rejected',
};

/** Where the pre-onboarding waits for the background verification to be marked done (a person does it, like the HR decision). */
const BGV_CHECK = {
  agent: 'pre', tab: 'pre-onboarding', tabName: 'Pre-Onboarding tab', noun: 'background verification', who: 'HR',
  phase: 'Background verification', phaseNote: 'The candidate’s information is validated by HR’s background verification team. It stays here until someone marks it done.', stepName: 'bgv.check()',
  get: (api, id) => api.getCandidate(id), approve: (api, id) => api.runBackgroundCheck(id),
  pending: (record) => record.status === 'Collecting documents', rejected: () => false,
};

/** The candidate's details form. */
const detailsForm = (defaults) => ({
  title: 'Candidate details', hint: 'HR enters these. They go on the offer letter, which is e-mailed to the e-mail address you enter.', validator: 'candidate', defaults,
  fields: [
    { id: 'fullName', label: 'Full name', type: 'text' },
    { id: 'email', label: 'E-mail address', type: 'email' },
    { id: 'phone', label: 'Phone number', type: 'tel' },
    { id: 'designation', label: 'Job title offered', type: 'text' },
    { id: 'department', label: 'Department', type: 'text' },
    { id: 'manager', label: 'Reporting manager', type: 'text' },
    { id: 'location', label: 'Work location', type: 'text' },
    { id: 'annualCtc', label: 'Yearly pay (CTC) in rupees', type: 'number' },
    { id: 'joiningDate', label: 'Joining date', type: 'date', minToday: true },
  ],
});

/** Step 1: the offer is released. HR's details are entered, the pre-hire record (and its ServiceNow request) is created, and the offer letter is made and e-mailed. */
async function releaseOffer({ r, S, set, ask, auto, email }) {
  await r.bot('Sure. HR enters the candidate’s and the job details below. Fill them in and tap Submit.', { wait: 500 });
  const defaults = sampleDetails(auto ? email : '');
  const values = await fillForm({ r, set, ask, auto, form: detailsForm(defaults), sample: defaults });
  r.msg('out', <><b>{values.fullName}</b>, {values.designation}, {values.department}<br />Joining {formatDate(values.joiningDate)} · {money(values.annualCtc)} a year</>);
  await r.phaseGap();

  let record = null;
  const phase = r.phase('Create the pre-hire record', 'The pre-hire record is saved and a ServiceNow request is raised for it.');
  await r.runSteps(phase, [{
    kind: 'api', agent: 'pre', title: 'Create the pre-hire record and the ServiceNow request', name: 'POST /api/pre-onboarding/candidates', live: !S.api.simulated, noSkip: true,
    note: S.api.simulated
      ? 'Simulated: the record would be saved and a ServiceNow request raised with the candidate’s details.'
      : 'Saves the candidate’s details and raises a ServiceNow request. Every step, document and decision is added to it as a work note.',
    run: async () => {
      record = await S.api.createCandidate({ ...values, annualCtc: Number(values.annualCtc) });
      if (!S.api.simulated) set({ runRecord: { kind: 'preonboarding', id: record.id } }); // lets the header open what this run created
      const sn = record.serviceNow ?? {};
      return {
        payload: { reference: record.id, status: record.status, serviceNowRequest: sn.reqNumber ?? 'not raised', ...(sn.error ? { serviceNowProblem: sn.error } : {}) },
        warn: Boolean(sn.error),
      };
    },
  }]);
  await r.phaseGap();

  const release = r.phase('Release the offer', 'The offer letter is made as a PDF with the company logo and theme, and e-mailed to the candidate.');
  await r.runSteps(release, [
    {
      kind: 'api', agent: 'pre', title: 'Generate the offer letter', name: 'offer_letter.generate()', live: !S.api.simulated,
      note: S.api.simulated
        ? 'Simulated: a one-page sample letter stands in for the PDF the real run makes.'
        : 'Writes the offer letter PDF (company logo and theme) with the candidate’s name, job, pay and joining date.',
      run: async () => {
        record = await S.api.makeOffer(record.id);
        return { payload: { letterNo: record.offer.letterNo, file: record.offer.fileName, candidate: record.fullName, annualCtc: money(record.annualCtc) } };
      },
    },
    {
      kind: 'notify', agent: 'pre', title: 'E-mail the offer letter', name: 'email.send()', live: !S.api.simulated,
      note: S.api.simulated
        ? 'Simulated: nothing is sent. The real run e-mails the letter to the address entered above.'
        : 'Sends the offer letter as an attachment to the e-mail address entered above.',
      run: async () => {
        record = await S.api.dispatchOffer(record.id);
        return { payload: { to: record.offer.sentTo, subject: 'Your offer letter', attachment: record.offer.fileName, status: record.status } };
      },
    },
  ]);
  const sn = record.serviceNow ?? {};
  await r.bot(
    <>The offer is released. I have e-mailed the offer letter to <b>{record.offer.sentTo}</b>{sn.reqNumber ? <> and raised ServiceNow request <b>{sn.reqNumber}</b></> : ''}.</>,
    { wait: 500 },
  );
  showCard(r, card('Offer letter', 'fa-file-signature', { label: 'Released', tone: 'approved' }, [
    ['Letter no.:', record.offer.letterNo], ['Position:', record.designation], ['Department:', record.department], ['Reporting to:', record.manager],
    ['Location:', record.location], ['Joining date:', formatDate(record.joiningDate)], ['Yearly pay (CTC):', money(record.annualCtc)],
  ]));
  await r.sleep(400);
  await r.bot(<DownloadLink {...S.api.offerDownload(record)} icon="fa-file-pdf" />, { wait: 400 });
  return record;
}

/** Step 2: the candidate accepts the offer and confirms the joining date. */
async function acceptOffer({ r, S, set, ask, auto, record }) {
  await r.bot(<>Hi <b>{firstName(record)}</b>, your offer letter is with you. To accept it, confirm your joining date below.</>, { wait: 600 });
  const form = {
    title: 'Accept the offer', hint: 'Confirming accepts the offer. You can change the joining date if the offered one does not suit you.', validator: 'acceptance',
    defaults: { joiningDate: record.joiningDate }, fields: [{ id: 'joiningDate', label: 'Joining date', type: 'date', minToday: true }],
  };
  const values = await fillForm({ r, set, ask, auto, form, sample: { joiningDate: record.joiningDate } });
  r.msg('out', <>I accept the offer and will join on <b>{formatDate(values.joiningDate)}</b>.</>);
  await r.phaseGap();

  let current = record;
  const phase = r.phase('Offer acceptance', 'The candidate’s acceptance and joining date are recorded.');
  await r.runSteps(phase, [{
    kind: 'api', agent: 'pre', title: 'Record the acceptance and joining date', name: 'preonboarding.accept()', live: !S.api.simulated,
    note: S.api.simulated ? 'Simulated: the acceptance would be recorded and a work note added to the ServiceNow request.' : 'Records that the offer was accepted and the joining date confirmed, and adds a work note to the ServiceNow request.',
    run: async () => {
      current = await S.api.acceptOffer(record.id, values.joiningDate);
      return { payload: { candidate: current.fullName, accepted: true, joiningDate: current.joiningDate, status: current.status } };
    },
  }]);
  await r.bot(<>Thank you, <b>{firstName(current)}</b>. Your acceptance is recorded: you join on <b>{formatDate(current.joiningDate)}</b>.</>, { wait: 500 });
  return current;
}

/** Step 4: the candidate's personal information. */
async function personalInformation({ r, S, set, ask, auto, record }) {
  await r.bot('Now please complete your personal information.', { wait: 500 });
  const sample = samplePersonalFor(record.fullName);
  const form = {
    title: 'Personal information', hint: 'These go on your employee record.', validator: 'personal', defaults: sample,
    fields: [
      { id: 'dateOfBirth', label: 'Date of birth', type: 'date', max: latestBirthDate() },
      { id: 'gender', label: 'Gender', type: 'select', options: GENDERS.map((value) => ({ value, label: value })) },
      { id: 'maritalStatus', label: 'Marital status', type: 'select', options: MARITAL_STATUSES.map((value) => ({ value, label: value })) },
      { id: 'currentAddress', label: 'Current address', type: 'text' },
      { id: 'permanentAddress', label: 'Permanent address', type: 'text' },
      { id: 'emergencyName', label: 'Emergency contact name', type: 'text' },
      { id: 'emergencyRelation', label: 'Relationship', type: 'text' },
      { id: 'emergencyPhone', label: 'Emergency contact phone', type: 'tel' },
    ],
  };
  const values = await fillForm({ r, set, ask, auto, form, sample });
  r.msg('out', <>Born {formatDate(values.dateOfBirth)}, {values.gender}, {values.maritalStatus}<br />Emergency contact: {values.emergencyName} ({values.emergencyRelation})</>);
  await r.phaseGap();

  let current = record;
  const phase = r.phase('Personal information', 'The personal details are saved on the pre-hire record.');
  await r.runSteps(phase, [{
    kind: 'api', agent: 'pre', title: 'Save the personal information', name: 'preonboarding.personal()', live: !S.api.simulated,
    note: S.api.simulated ? 'Simulated: the details would be saved and noted on the ServiceNow request.' : 'Saves the personal details on the pre-hire record and adds a work note to the ServiceNow request.',
    run: async () => {
      current = await S.api.savePersonal(record.id, values);
      return { payload: { candidate: current.fullName, dateOfBirth: values.dateOfBirth, gender: values.gender, maritalStatus: values.maritalStatus, emergencyContact: values.emergencyName, status: current.status } };
    },
  }]);
  await r.bot(<>Thanks, <b>{firstName(current)}</b>. I need <b>{DOCUMENTS.length} documents</b> from you next.</>, { wait: 500 });
  return current;
}

/** The issues of a document that was not accepted, as a short list. */
const problems = (check) => (check.issues?.length ? check.issues : [check.readable ? 'It does not look like the right document.' : 'It is not clear enough to read.']);

/**
 * Ask for one document and check it. Returns the stored document, or null if it was not accepted (the candidate is told why; Manual asks again).
 */
async function collectDocument({ r, S, set, auto, record, doc, number }) {
  const upload = { docKey: doc.key, label: doc.label, hint: `${doc.hint}. PDF, photo (PNG, JPG, WEBP) or Word, up to 10 MB.`, accept: DOCUMENT_ACCEPT };
  const cardId = r.msg('in', null, { kind: 'upload', wide: true, upload });
  set({ stage: 'docs' });
  let file;
  if (auto) {
    await r.sleep(900);
    // The sample file is fetched from the portal; a Simulated Environment run reads nothing, so a stand-in is enough if it cannot be fetched.
    file = await loadSampleFile(doc).catch((error) => {
      if (!S.api.simulated) throw error;
      return new File(['Sample document (fictional data)'], sampleFileOf(doc).filename, { type: 'application/pdf' });
    });
  } else {
    ({ file } = await r.ask({ kind: 'attach', docKey: doc.key, label: doc.label, accept: DOCUMENT_ACCEPT }));
  }
  r.msg('out', null, { kind: 'file', file: fileInfo(file) });
  const problem = validateDocumentFile(file);
  if (problem) {
    r.patchMsg(cardId, { upload: { ...upload, error: problem } });
    if (auto) throw new Error(`The sample ${doc.label} could not be sent: ${problem}`);
    await r.bot(<>That file can’t be used: {problem}</>, { wait: 500 });
    return null;
  }
  r.patchMsg(cardId, { upload: { ...upload, file: fileInfo(file) } });

  let result = null;
  let failure = '';
  const phase = r.phase(`Check the ${doc.label} (${number} of ${DOCUMENTS.length})`, 'The document is read: what kind it is, whether it is clear and whose name is on it.');
  await r.runSteps(phase, [
    trigger('Document received', 'A file arrives on the thread.', { type: 'document', document: { mime_type: file.type || 'application/pdf', filename: file.name }, size_kb: Math.max(1, Math.round(file.size / 1024)) }),
    {
      kind: 'api', agent: 'pre', title: `Read and check the ${doc.label}`, name: 'preonboarding.check_document()', live: !S.api.simulated,
      note: S.api.simulated
        ? 'Simulated: the document would be read and checked, and the file attached to the ServiceNow request.'
        : 'Reads the document: is it the right kind, is it clear and whose name is on it. A document that passes is attached to the ServiceNow request.',
      run: async () => {
        try {
          result = await S.api.uploadDocument(record.id, doc.key, file);
        } catch (error) {
          failure = error.message ?? 'The document could not be checked.';
          return { warn: true, payload: { result: 'The document could not be checked', reason: failure } };
        }
        const { check } = result.document;
        return {
          payload: {
            document: doc.title, result: check.passed ? 'Accepted' : 'Not accepted', readable: check.readable, nameOnDocument: check.nameOnDocument ?? 'not applicable',
            nameMatches: check.nameMatches ?? 'not applicable', ...(check.issues?.length ? { issues: check.issues } : {}),
          },
          warn: !check.passed,
        };
      },
    },
  ]);

  if (!result) {
    r.patchMsg(cardId, { upload: { ...upload, error: failure } });
    if (auto) throw new Error(`The sample ${doc.label} could not be checked: ${failure}`);
    await r.bot(<>{failure}</>, { wait: 500 });
    return null;
  }
  const { check } = result.document;
  if (!check.passed) {
    r.patchMsg(cardId, { upload: { ...upload, error: problems(check)[0] } });
    if (auto) throw new Error(`The sample ${doc.label} did not pass the check: ${problems(check).join(' ')}`);
    await r.bot(
      <>I checked your <b>{doc.label}</b>, but it can’t be accepted:<ul className="cl">{problems(check).map((text) => <li key={text}><span>{text}</span></li>)}</ul>Please attach the correct {doc.label}.</>,
      { wait: 500 },
    );
    return null;
  }
  await r.bot(
    <>Got your <b>{doc.label}</b>{check.nameOnDocument ? <>: the name on it is <b>{check.nameOnDocument}</b></> : ''}.</>,
    { wait: 450 },
  );
  return result.document;
}

/** The seven documents, one after the other. `keys` limits which ones are asked for (a resend after a name mismatch). */
async function collectDocuments({ r, S, set, auto, record, keys = DOCUMENTS.map((d) => d.key) }) {
  let latest = record;
  for (const doc of DOCUMENTS.filter((d) => keys.includes(d.key))) {
    const number = DOCUMENTS.indexOf(doc) + 1;
    for (;;) {
      const stored = await collectDocument({ r, S, set, auto, record: latest, doc, number });
      if (stored) break;
      await r.phaseGap();
    }
    latest = await S.api.getCandidate(record.id);
    await r.phaseGap();
  }
  return latest;
}

/** Compare the name on every document. Returns the record, or null when the names do not match (Manual resends the documents that differ). */
async function verifyNames({ r, S, set, auto, record }) {
  let current = record;
  for (;;) {
    let verified = null;
    const phase = r.phase('Compare the names', 'The name on every document is compared with the candidate’s name.');
    await r.runSteps(phase, [{
      kind: 'api', agent: 'pre', title: 'Compare the name on all the documents', name: 'preonboarding.verify()', live: !S.api.simulated,
      note: S.api.simulated
        ? 'Simulated: the names on all seven documents would be compared with the candidate’s name.'
        : 'Compares the name read from each document with the candidate’s name. Everything must match before the background verification starts.',
      run: async () => {
        verified = await S.api.verifyDocuments(record.id);
        const v = verified.verification;
        return {
          payload: { candidate: verified.fullName, documentsMatching: `${v.rows.filter((row) => row.matches).length} of ${v.rows.length}`, result: v.allMatch ? 'All names match' : 'Some names do not match', status: verified.status },
          warn: !v.allMatch,
        };
      },
    }]);
    current = verified;
    const { rows, allMatch } = verified.verification;
    showCard(r, card('Name check', 'fa-user-check', { label: allMatch ? 'All match' : 'Mismatch', tone: allMatch ? 'approved' : 'pending' },
      rows.map((row) => [`${row.label}:`, `${row.name ?? '—'} · ${row.matches ? 'matches' : 'does not match'}`])));
    if (allMatch) return current;
    const wrong = rows.filter((row) => !row.matches);
    if (auto) throw new Error(`The names on the sample documents do not match: ${wrong.map((row) => row.label).join(', ')}.`);
    await r.bot(<>The name on <b>{wrong.map((row) => row.label).join(', ')}</b> does not match <b>{verified.fullName}</b>. Please send the right document{wrong.length === 1 ? '' : 's'} again.</>, { wait: 500 });
    current = await collectDocuments({ r, S, set, auto, record: current, keys: wrong.map((row) => row.key) });
  }
}

/** Step 6: the background verification. Someone marks it done on the Approvals page (the simulated run does it by itself); the check itself is a dummy that comes back clear. */
async function backgroundVerification({ r, S, set, record }) {
  const outcome = await awaitDecision({ r, S, set, record, channel: BGV_CHECK });
  if (outcome === 'stopped') return null;
  const current = await S.api.getCandidate(record.id);
  showCard(r, card('Background verification', 'fa-user-shield', { label: current.bgv.status, tone: 'approved' }, current.bgv.checks.map((check) => [`${check.name}:`, `${check.result} · ${check.note}`])));
  await r.bot('The background verification is clear. Your details now go to HR for approval. I’ll tell you as soon as it is decided.', { wait: 600 });
  return current;
}

/** Step 8: the joining instructions are made as a PDF and e-mailed. */
async function joiningConfirmation({ r, S, record }) {
  let current = record;
  const phase = r.phase('Joining confirmation', 'The final joining instructions are made as a PDF and e-mailed to the candidate.');
  await r.runSteps(phase, [{
    kind: 'notify', agent: 'pre', title: 'Make and e-mail the joining instructions', name: 'joining.send()', live: !S.api.simulated,
    note: S.api.simulated
      ? 'Simulated: nothing is sent. The real run e-mails the joining instructions PDF to the candidate.'
      : 'Writes the joining instructions PDF (company logo and theme) and e-mails it to the candidate. It is also attached to the ServiceNow request.',
    run: async () => {
      current = await S.api.confirmJoining(record.id);
      return { payload: { to: current.joining.sentTo, subject: 'Your joining instructions', attachment: current.joining.fileName, joiningDate: current.joiningDate, status: current.status } };
    },
  }]);
  await r.bot(<>Good news, <b>{firstName(current)}</b>: HR approved. Your joining is confirmed for <b>{formatDate(current.joiningDate)}</b>. I have e-mailed your joining instructions to <b>{current.joining.sentTo}</b>.</>, { wait: 500 });
  await r.bot(<DownloadLink {...S.api.joiningDownload(current)} icon="fa-file-pdf" />, { wait: 400 });
  return current;
}

/** Step 9: pre-onboarding is completed and the onboarding can begin. */
async function completion({ r, S, record }) {
  let current = record;
  const phase = r.phase('Onboarding initiation', 'Pre-onboarding is completed, so the candidate is ready for the official joining and the onboarding process.');
  await r.runSteps(phase, [
    {
      kind: 'api', agent: 'pre', title: 'Complete the pre-onboarding', name: 'preonboarding.complete()', live: !S.api.simulated,
      note: S.api.simulated ? 'Simulated: the pre-onboarding would be marked completed.' : 'Marks the pre-onboarding completed. The candidate is ready for the onboarding process.',
      run: async () => {
        current = await S.api.completePreOnboarding(record.id);
        return { payload: { candidate: current.fullName, status: current.status } };
      },
    },
    {
      kind: 'tool', agent: 'pre', title: 'Close the ServiceNow request', name: 'servicenow_close', lat: 300, live: !S.api.simulated,
      note: S.api.simulated ? 'Simulated: the request would be closed.' : 'Done together with the completion: the request is marked complete with a work note.',
      payload: () => ({ request: current.serviceNow?.reqNumber ?? 'none', result: 'Closed', outcome: current.status }),
    },
  ]);
  await r.bot(<>Pre-onboarding is complete, <b>{firstName(current)}</b>. You are ready for the official joining on <b>{formatDate(current.joiningDate)}</b>, and the onboarding process can begin.</>, { wait: 500 });
  showCard(r, card('Pre-onboarding completed', 'fa-circle-check', { label: 'Completed', tone: 'approved' }, [
    ['Reference:', current.id], ['Documents checked:', `${DOCUMENTS.length} of ${DOCUMENTS.length}`], ['Background check:', current.bgv?.status ?? '—'],
    ['Approved by:', current.hr?.approver ?? '—'], ['Offer sent to:', current.offer?.sentTo ?? '—'], ['Joining date:', formatDate(current.joiningDate)],
    ['ServiceNow request:', current.serviceNow?.reqNumber ? `${current.serviceNow.reqNumber} (closed)` : '—'],
  ]));
  await r.bot(
    <>To begin onboarding, <Link className="ad-inline-link" to="/agent-demo/onboarding">start the Onboarding demo</Link>. Sample documents for the same candidates are on the Sample Files · Onboarding page.</>,
    { wait: 500 },
  );
  return current;
}

/** The whole pre-onboarding lifecycle. */
async function preOnboarding(context) {
  const { r, S, set, ask, auto } = context;
  let record = await releaseOffer(context);
  await r.phaseGap();
  record = await acceptOffer({ r, S, set, ask, auto, record });
  await r.phaseGap();
  record = await personalInformation({ r, S, set, ask, auto, record });
  await r.phaseGap();
  record = await collectDocuments({ r, S, set, auto, record });
  record = await verifyNames({ r, S, set, auto, record });
  await r.phaseGap();
  record = await backgroundVerification({ r, S, set, record });
  if (!record) return;
  set({ stage: 'review' });
  await r.phaseGap();

  const hr = await awaitDecision({ r, S, set, record, channel: HR_APPROVAL });
  if (hr === 'stopped') return;
  if (hr === 'rejected') {
    await r.bot(<>HR did not approve your pre-onboarding, {firstName(record)}. Nothing more will be sent. Please contact HR.</>, { wait: 500 });
    return;
  }
  await r.phaseGap();
  record = await joiningConfirmation({ r, S, record });
  await r.phaseGap();
  await completion({ r, S, record });
}

/** @param auto  null for Manual; { email } for Auto-play (the sample candidate's documents are sent for them; the offer letter goes to that address) */
export async function runPreOnboarding({ r, set, auto = null, simulated = false }) {
  const S = { api: simulated ? createSimulatedPreOnboardingApi(r.timing.stepScale) : realApi, stopped: false };
  const ask = makeAsk(r, auto);
  r.msg('sys', simulated
    ? 'Auto-play · Simulated Environment: this plays the pre-onboarding lifecycle for a sample candidate with seven sample documents. Nothing is contacted, saved or sent anywhere.'
    : auto
    ? 'Auto-play · Live: this plays the pre-onboarding lifecycle for a sample candidate. It is real: a ServiceNow request is raised, the offer letter and the joining instructions are e-mailed to the address you entered, the seven sample documents are read, and HR decides on the Approvals page (Pre-Onboarding tab).'
    : 'Manual mode: you are the candidate. Type a message to begin. It is real: a ServiceNow request is raised, the offer letter and the joining instructions are e-mailed to the address you enter, your documents are read, and HR decides on the Approvals page (Pre-Onboarding tab).');
  set({ stage: 'idle' });

  const first = await ask({ kind: 'text', suggestions: ['Hi'] }, { text: 'Hi' });
  r.msg('out', first.text);
  await understand({ r, text: first.text, intent: 'greeting', workflow: 'pre_onboarding.v1' });
  await r.bot('Hi, I’m your pre-onboarding assistant.');
  await r.bot('I’ll release your offer, take your acceptance and personal information and seven documents (10th and 12th marksheets, degree certificate, Aadhaar, PAN, passport photo and resume), check them, and once HR approves I’ll confirm your joining. What would you like to do?', { wait: 700 });

  const context = { r, S, set, ask, auto, email: auto?.email ?? (simulated ? SIMULATED_EMAIL : '') };
  const scenario = SCENARIOS[0];
  if (auto) {
    const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label), pick: scenario.label }, { text: scenario.label });
    r.msg('out', text);
    await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
    await preOnboarding(context);
  } else {
    for (;;) {
      const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label) });
      r.msg('out', text);
      const intent = detectIntent(text);
      if (intent === 'done') break;
      if (intent !== 'start') {
        await r.bot('I can take you through the pre-onboarding: the offer, your details, your documents and your joining. Try the suggestion below.', { wait: 600 });
        continue;
      }
      await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
      await preOnboarding(context);
      break; // one candidate per conversation: the record, the approval and the letters all belong to it
    }
  }

  await r.phaseGap();
  const bye = r.phase('Close the conversation', 'A short goodbye; the conversation is closed.');
  await r.runSteps(bye, [{
    kind: 'notify', agent: 'pre', title: 'Close the conversation', name: 'whatsapp.send_text()', lat: 160,
    note: 'The assistant says goodbye. Everything above is already saved.',
    payload: () => ({ message: 'Happy to help. Have a great day!' }),
    after: async () => {
      await r.bot('Happy to help. Have a great day!', { wait: 500 });
      set({ stage: 'done', outcome: !S.stopped });
    },
  }]);
}

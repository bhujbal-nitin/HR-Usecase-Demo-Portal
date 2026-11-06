import { getVerificationStatus, verifyDocument } from '../../../api/documents';
import { EMPLOYMENT_FIELDS, PERSONAL_FIELDS } from '../../onboarding/constants';
import { validateField, validateFile } from '../../onboarding/validation';
import { formatFileSize } from '../../../utils/format';
import { maskPhone, trigger } from './phases/common';
import { documentWorkflowStep } from './phases/workflowStep';
import { finishIntake, openRequest } from './phases/record.jsx';
import { attachDocumentStep } from './phases/attachDocument';
import { setup } from './phases/setup.jsx';
import { fileInfo } from '../lib/fileInfo';

// Manual onboarding: YOU are the candidate. The chat waits for you at every step - you type, fill the form, attach
// your own documents. The real backend creates a record and raises the ServiceNow request from the form first (live only);
// each document you attach is then added to that request.
// When document scanning is set up on the backend, each document is read and checked before it is accepted (right document,
// name matches the form, Aadhaar and PAN dates of birth agree). Without a key the files are only attached.

export const MANUAL_FIELDS = [...PERSONAL_FIELDS.filter((f) => f.id !== 'uan'), ...EMPLOYMENT_FIELDS];

const DOCS = [
  { key: 'idDoc', label: 'Aadhaar card', title: 'Aadhaar card', ask: <>Next, please attach your <b>Aadhaar card</b> (PDF or Word) with the paperclip.</> },
  { key: 'panDoc', label: 'PAN card', title: 'PAN card', ask: <>Now please attach your <b>PAN card</b> (PDF or Word).</> },
  { key: 'salaryDoc', label: 'latest salary slip', title: 'latest salary slip', ask: <>Now please attach your <b>latest month’s salary slip</b> (PDF or Word).</> },
];

/** Phase: the user's first message, intent and the joining form. */
async function greeting({ r, S, set, text }) {
  const phase = r.phase('Greeting and intent', 'A new thread opens. The agent works out what to do and sends the joining form.');
  await r.runSteps(phase, [
    trigger('Inbound message received', 'WhatsApp would deliver your message. Nothing has been decided yet.', {
      object: 'whatsapp_business_account', type: 'text', text: { body: text }, timestamp: Math.floor(Date.now() / 1000),
    }),
    {
      kind: 'agent', agent: 'orch', title: 'Understand intent', note: 'The LLM reads the message with the thread state and picks a workflow.', name: 'llm.classify_intent()', lat: 640,
      payload: { thread_state: 'NEW_THREAD', intent: 'start_onboarding', confidence: 0.97, workflow: 'onboarding.v3' },
    },
    {
      kind: 'notify', agent: 'orch', title: 'Send the joining form', note: 'Replies with a short greeting and a form that opens inside WhatsApp.', name: 'whatsapp.send_flow()', lat: 210,
      payload: { flow: 'joining_details_v2', fields: MANUAL_FIELDS.map((f) => f.id) },
      after: async () => {
        await r.bot('Hi, welcome! I’m your onboarding assistant. I’ll help you finish your joining formalities in a few minutes.');
        await r.bot('First, please fill in your details below and tap Submit.', { wait: 500 });
        S.formId = r.msg('in', null, { kind: 'manualForm', wide: true, form: { submitted: false, values: null } });
        set({ stage: 'form' });
      },
    },
  ]);
}

/** Phase: the submitted form is validated with the same rules as the onboarding wizard. */
async function intake({ r, values }) {
  const phase = r.phase('Form intake', 'The submitted form is checked before anything is saved.');
  await r.runSteps(phase, [
    trigger('Form submission received', 'The form arrives as a structured reply, not free text, so no guessing is needed.', {
      type: 'interactive', nfm_reply: { name: 'joining_details_v2', response_json: { ...values, phone: maskPhone(values.phone.replace(/\D/g, '').slice(-10)), aadhaar: `XXXX XXXX ${values.aadhaar.replace(/\D/g, '').slice(-4)}` } },
    }),
    {
      kind: 'tool', agent: 'orch', title: 'Validate every field', note: 'Runs the same validation rules as the onboarding wizard, on exactly what you entered.', name: 'validators.run()', lat: 120, live: true,
      payload: () => Object.fromEntries(MANUAL_FIELDS.map(({ id }) => [id, validateField(id, values[id]) || 'ok'])),
    },
  ]);
}

const TYPE_NAME = { aadhaar: 'Aadhaar card', pan: 'PAN card', salary_slip: 'salary slip', other: 'different kind of document' };
/** What was actually matched, in plain words: "your name matches your form and your date of birth matches your Aadhaar card". */
const MATCH_WORDS = { name: 'your name matches your form', dob: 'your date of birth matches your Aadhaar card' };
const matchSummary = (result) => result.checks.filter((c) => c.passed && MATCH_WORDS[c.id]).map((c) => MATCH_WORDS[c.id]).join(' and ');
const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : undefined);

/** What the check step shows: the checks first (so the stage can tick them off), the details of what was read below. */
function checkPayload(result) {
  const checks = Object.fromEntries(result.checks.map((c) => [c.label, c.passed ? 'Pass' : `Fail: ${c.detail}`]));
  return {
    ...checks,
    'Read from the document': {
      'Detected as': TYPE_NAME[result.detectedType] ?? result.detectedType,
      'Name on the document': result.holderName ?? 'not found',
      ...(result.dateOfBirth ? { 'Date of birth': dmy(result.dateOfBirth) } : {}),
      ...(result.idNumberMasked ? { Number: result.idNumberMasked } : {}),
    },
  };
}

/** Scans the document. Returns { result } or { unavailable } when the check itself could not run. */
async function checkDocument({ r, S, doc, file, values }) {
  const phase = r.phase(`Checking the ${doc.label}`, 'The document is read and compared with what you entered in the form.');
  const outcome = {};
  await r.runSteps(phase, [{
    kind: 'api', agent: 'doc', title: `Read and check the ${doc.label}`, name: 'scanner.verify_document()', live: true,
    note: 'The document is scanned: is it the right document, does the name match the joining form'
      + (doc.key === 'panDoc' ? ', and is the date of birth the same as on the Aadhaar card.' : '.'),
    run: async () => {
      try {
        outcome.result = await verifyDocument(doc.key, file, values.fullName, doc.key === 'panDoc' ? S.aadhaarDob : undefined, S.employeeId);
      } catch (error) {
        outcome.unavailable = error.message ?? 'The check could not run.';
        return { warn: true, payload: { Result: 'The document could not be checked automatically', Reason: outcome.unavailable } };
      }
      const payload = checkPayload(outcome.result);
      if (doc.key === 'panDoc' && !S.aadhaarDob) payload['Date of birth check'] = 'Skipped: no date of birth was read on the Aadhaar card';
      return { warn: !outcome.result.passed, payload };
    },
  }]);
  return outcome;
}

/**
 * Confirms the document with the AutomationEdge "HR Demo Document Verification" workflow. The step only turns green when the
 * workflow instance reaches Complete; if it fails the step shows Rerun / Stop, and Stop ends the run.
 */
async function confirmWithWorkflow({ r, doc }) {
  const phase = r.phase(`Confirming the ${doc.label}`, 'AutomationEdge runs the document-verification workflow. The next step starts only after it completes.');
  await r.runSteps(phase, [documentWorkflowStep(doc.label)]);
}

/** Phase: wait for one document; reject unusable files, files that fail the checks, and ask again. */
async function collectDocument({ r, S, doc, values }) {
  const cardId = r.msg('in', null, { kind: 'upload', wide: true, upload: { docKey: doc.key, label: doc.title } });
  for (;;) {
    const { file } = await r.ask({ kind: 'attach', docKey: doc.key, label: doc.label });
    r.msg('out', null, { kind: 'file', file: fileInfo(file) });
    const problem = validateFile(file);
    if (problem) {
      r.patchMsg(cardId, { upload: { docKey: doc.key, label: doc.title, error: problem } });
      await r.bot(<>That file can’t be used: {problem} Please attach your {doc.label} again.</>, { wait: 500 });
      continue;
    }
    const phase = r.phase(`Document received: ${doc.label}`, S.verify.enabled ? 'The file is checked and attached to your request, then read and compared with your form.' : 'The file is checked and attached to your request.');
    await r.runSteps(phase, [
      trigger('Document received', 'A file arrives on the thread.', { type: 'document', document: { mime_type: file.type || 'application/octet-stream', filename: file.name }, size_kb: Math.round(file.size / 1024) }),
      {
        kind: 'tool', agent: 'doc', title: 'Check the file type and size', note: 'Only PDF and Word files up to 10 MB are accepted, like the onboarding wizard. Checked for real.', name: 'file.validate()', lat: 10, live: true,
        payload: { name: file.name, size: formatFileSize(file.size), accepted: ['.pdf', '.doc', '.docx'], result: 'accepted' },
      },
      attachDocumentStep({ S, docKey: doc.key, label: doc.label, file, live: true }),
    ]);

    let matched = '';
    if (S.verify.enabled) {
      const { result, unavailable } = await checkDocument({ r, S, doc, file, values });
      if (result && !result.passed) {
        const failed = result.checks.filter((c) => !c.passed);
        r.patchMsg(cardId, { upload: { docKey: doc.key, label: doc.title, error: failed[0].detail } });
        await r.bot(<>I checked your {doc.label}, but it can’t be accepted:<br />{failed.map((c) => <span key={c.id}>• {c.detail}<br /></span>)}Please attach the correct {doc.label}.</>, { wait: 500 });
        continue;
      }
      if (unavailable) await r.bot(<>I couldn’t check this {doc.label} automatically just now, so I’ll pass it to HR to review.</>, { wait: 400 });
      matched = result ? matchSummary(result) : '';
      if (doc.key === 'idDoc' && result?.dateOfBirth) S.aadhaarDob = result.dateOfBirth;
    }

    await confirmWithWorkflow({ r, doc });

    r.patchMsg(cardId, { upload: { docKey: doc.key, label: doc.title, file: fileInfo(file) } });
    return { matched };
  }
}

export async function runManualOnboarding({ r, set }) {
  const S = { verify: { enabled: false } };
  S.verify = await getVerificationStatus().catch(() => ({ enabled: false }));
  r.msg('sys', 'Manual mode: you are the candidate. Type a message to begin. Everything you enter is real and creates a real record.');
  if (!S.verify.enabled) r.msg('sys', 'Automatic document checking is switched off, so files are only attached.');
  set({ stage: 'idle' });

  const first = await r.ask({ kind: 'text', suggestions: ['Hi'] });
  r.msg('out', first.text);
  await greeting({ r, S, set, text: first.text });

  const { values } = await r.ask({ kind: 'form' });
  r.patchMsg(S.formId, { form: { submitted: true, values } });
  r.msg('out', <><b>{values.fullName}</b><br />{values.email}<br />{maskPhone(values.phone.replace(/\D/g, '').slice(-10))} · {values.jobTitle}<br />{values.department}</>);
  await r.phaseGap();
  await intake({ r, values });

  const parts = values.fullName.trim().split(/\s+/);
  const D = {
    ...values,
    first: parts[0],
    last: parts[parts.length - 1],
    phone: values.phone.trim(),
    mobile: values.phone.replace(/\D/g, '').slice(-10),
    aadhaar: values.aadhaar.replace(/\D/g, ''),
    uan: '',
    annualCtc: Number(values.annualCtc),
    checks: {},
  };

  // The ServiceNow request is raised first; the documents you attach next are added to it.
  set({ stage: 'record' });
  await r.phaseGap();
  await openRequest({
    r, D, S, set, live: true,
    ask: async () => {
      await r.bot(<>Thanks, {D.first}. Your details are captured{S.requestNumber ? <>, and I have opened request <b>{S.requestNumber}</b> for your onboarding</> : null}.</>);
      await r.bot(DOCS[0].ask, { wait: 600 });
      set({ stage: 'docs' });
    },
  });
  if (S.stopped) return;

  for (const [index, doc] of DOCS.entries()) {
    if (index > 0) await r.bot(doc.ask, { wait: 500 });
    const { matched } = await collectDocument({ r, S, doc, values });
    await r.bot(<>Got your <b>{doc.label}</b>{matched ? `: ${matched}.` : '.'}</>, { wait: 400 });
  }
  await r.bot('Thanks, I have all three documents.', { wait: 500 });
  await r.bot(<>That’s everything I need. I’m <b>passing your file to HR</b> now.</>, { wait: 500 });
  set({ stage: 'record' });

  await r.phaseGap();
  await finishIntake({ r, D, S, set, live: true });
  if (S.stopped) return;
  await r.phaseGap();
  await setup({ r, D, S, set, live: true });
}

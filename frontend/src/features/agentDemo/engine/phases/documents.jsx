import { checkPan, nameSimilarity } from '../../lib/identity';
import { verhoeffValid } from '../../lib/verhoeff';
import { maskPhone, trigger } from './common';
import { documentWorkflowStep } from './workflowStep';
import { fileInfo } from '../../lib/fileInfo';
import { attachDocumentStep } from './attachDocument';

/** The inbound WhatsApp event for the file the candidate sent. */
const documentEvent = (file) => ({
  object: 'whatsapp_business_account', type: 'document', document: { mime_type: file.type || 'application/pdf', filename: file.name }, size_kb: Math.max(1, Math.round(file.size / 1024)),
});

/** The candidate sends the file: it shows in the chat as an attachment, and the request card above it turns to "uploaded". */
function sendFile(r, file, uploadId, upload) {
  r.msg('out', null, { kind: 'file', file: fileInfo(file) });
  r.patchMsg(uploadId, { upload: { ...upload, file: fileInfo(file) } });
}

/** Aadhaar: vision + OCR are simulated; the checksum and the name comparison run for real. */
export async function aadhaar({ r, D, S, set, live }) {
  sendFile(r, D.files.idDoc, D.idUploadId, { docKey: 'idDoc', label: 'Aadhaar card' });
  const phase = r.phase('Aadhaar check', 'The file is read, then its number and its details are checked against the form.');
  await r.runSteps(phase, [
    trigger('Document received', 'A file arrives. The agent does not yet know what is in it.', documentEvent(D.files.idDoc)),
    attachDocumentStep({ S, docKey: 'idDoc', label: 'Aadhaar card', file: D.files.idDoc, live }),
    {
      kind: 'tool', agent: 'doc', title: 'Download, scan and encrypt', note: 'The file would be virus-scanned and stored encrypted with a 90-day retention rule.', name: 'media.fetch_and_store()', lat: 440,
      payload: { antivirus: 'clean', content_type: D.files.idDoc.type || 'application/pdf', storage: `s3://hr-kyc/${D.last.toUpperCase()}/doc-01.enc`, encryption: 'SSE-KMS', retention_days: 90 },
    },
    {
      kind: 'agent', agent: 'doc', title: 'Identify the document (vision)', note: 'A vision model decides what the document is and whether it is readable.', name: 'llm.vision_classify()', lat: 890,
      payload: { label: 'aadhaar_card', confidence: 0.98, expected: 'aadhaar_card', quality: { blur: 'low', glare: 'none', all_corners_visible: true } },
    },
    {
      kind: 'tool', agent: 'doc', title: 'Extract the fields (OCR)', note: 'Text is read from the document into named fields.', name: 'ocr.extract()', lat: 760,
      payload: { name: D.fullName, dob: D.dob, uid: `XXXX XXXX ${D.aadhaar.slice(-4)}`, address: D.address, field_confidence: { name: 0.99, dob: 0.99, uid: 0.97 } },
    },
    {
      kind: 'tool', agent: 'ver', title: 'Check the ID number checksum', note: 'The 12-digit number carries a Verhoeff check digit. This catches typos and invented numbers before any paid service call. Computed for real.', name: 'verhoeff.validate()', lat: 8, live: true,
      payload: () => {
        D.checks.verhoeff = verhoeffValid(D.aadhaar);
        return { algorithm: 'Verhoeff', digits: D.aadhaar.length, number: `XXXX XXXX ${D.aadhaar.slice(-4)}`, check_digit_valid: D.checks.verhoeff };
      },
      get warn() { return D.checks.verhoeff === false; },
    },
    {
      kind: 'agent', agent: 'ver', title: 'Cross-check with the form', note: 'Compares what the card says with what the candidate typed. Similarity is computed for real.', name: 'compare_identity()', lat: 520, live: true,
      payload: () => {
        D.checks.aadhaarName = nameSimilarity(D.fullName, D.fullName);
        return { name: { form: D.fullName, document: D.fullName, similarity: D.checks.aadhaarName }, dob: { form: D.dob, document: D.dob, match: true }, threshold: 0.9, result: D.checks.aadhaarName >= 0.9 ? 'match' : 'needs_review' };
      },
    },
    {
      kind: 'tool', agent: 'ver', title: 'Mask personal data', note: 'Only the last 4 digits would be kept in the conversation record.', name: 'pii_guard.apply()', lat: 140,
      payload: { stored: { uid_last4: D.aadhaar.slice(-4) }, discarded: ['full_uid', 'raw_ocr_text'] },
    },
    ...(live ? [documentWorkflowStep('Aadhaar card')] : []),
    {
      kind: 'notify', agent: 'orch', title: 'Confirm and ask for the PAN card', note: 'Tells the candidate the result and asks for the next document.', name: 'whatsapp.send_text()', lat: 170,
      payload: { state_change: 'AWAITING_AADHAAR → AWAITING_PAN' },
      after: async () => {
        await r.bot(<>Thanks, I have your <b>Aadhaar card</b>: your name and date of birth match your form. I kept only the last 4 digits of the number.</>);
        await r.bot(<>Now please attach your <b>PAN card</b> (PDF or Word).</>, { wait: 500 });
        D.panUploadId = r.msg('in', null, { kind: 'upload', wide: true, upload: { docKey: 'panDoc', label: 'PAN card' } });
      },
    },
  ]);
  set({});
}

/** PAN: structure check and name match run for real; the tax-database lookup is simulated. */
export async function pan({ r, D, S, live }) {
  sendFile(r, D.files.panDoc, D.panUploadId, { docKey: 'panDoc', label: 'PAN card' });
  const phase = r.phase('PAN check', 'Same pattern as Aadhaar: read, validate the format, then match the name and date of birth.');
  await r.runSteps(phase, [
    trigger('Document received', 'A second file arrives on the same thread.', documentEvent(D.files.panDoc)),
    attachDocumentStep({ S, docKey: 'panDoc', label: 'PAN card', file: D.files.panDoc, live }),
    {
      kind: 'agent', agent: 'doc', title: 'Identify and read the PAN card', note: 'One vision call classifies the document and reads its fields.', name: 'llm.vision_extract()', lat: 1020,
      payload: { label: 'pan_card', confidence: 0.99, fields: { pan: D.pan, name: D.panName, father_name: D.fatherName, dob: D.dob }, quality: { blur: 'low', glare: 'none' } },
    },
    {
      kind: 'tool', agent: 'ver', title: 'Check the PAN format', note: 'A PAN has a fixed shape. The 4th letter is the holder type and the 5th is the surname initial. Checked for real.', name: 'pan.validate_format()', lat: 6, live: true,
      payload: () => {
        const result = checkPan(D.pan, D.last);
        D.checks.pan = result.formatOk;
        return { pattern: '[A-Z]{5}[0-9]{4}[A-Z]', format: result.formatOk ? 'valid' : 'invalid', fourth_char: `${result.fourthChar} → ${result.holder}`, fifth_char: `${result.fifthChar} ${result.surnameInitialMatches ? 'matches' : 'does not match'} surname "${D.last}"` };
      },
    },
    {
      kind: 'agent', agent: 'ver', title: 'Match the PAN name and date of birth', note: 'Names are compared after removing case and punctuation, and the date of birth must be the same as on the Aadhaar card. Similarity is computed for real.', name: 'compare_identity()', lat: 410, live: true,
      payload: () => {
        D.checks.panName = nameSimilarity(D.fullName, D.panName);
        return { aadhaar_name: D.fullName, pan_name: D.panName, similarity: D.checks.panName, dob: { aadhaar: D.dob, pan: D.dob, match: true }, threshold: 0.9, result: D.checks.panName >= 0.9 ? 'MATCH' : 'NEEDS_REVIEW' };
      },
    },
    ...(live ? [documentWorkflowStep('PAN card')] : []),
    {
      kind: 'notify', agent: 'orch', title: 'Confirm PAN and ask for the salary slip', note: 'Short confirmation, then the next request.', name: 'whatsapp.send_text()', lat: 160,
      payload: { state_change: 'AWAITING_PAN → AWAITING_SALARY_SLIP' },
      after: async () => {
        await r.bot(<>Thanks, I have your <b>PAN card</b>: your name matches your form and your date of birth matches your Aadhaar card.</>, { wait: 500 });
        await r.bot(<>One last document, please: your <b>latest month’s salary slip</b> (PDF or Word).</>, { wait: 600 });
        D.salaryUploadId = r.msg('in', null, { kind: 'upload', wide: true, upload: { docKey: 'salaryDoc', label: 'latest salary slip' } });
      },
    },
  ]);
}

/** Latest salary slip. */
export async function payslips({ r, D, S, live }) {
  sendFile(r, D.files.salaryDoc, D.salaryUploadId, { docKey: 'salaryDoc', label: 'latest salary slip' });
  const phase = r.phase('Salary slip check', 'The latest month’s salary slip is read and sanity-checked against the offer.');
  await r.runSteps(phase, [
    trigger('Document received', 'A PDF arrives.', documentEvent(D.files.salaryDoc)),
    attachDocumentStep({ S, docKey: 'salaryDoc', label: 'latest salary slip', file: D.files.salaryDoc, live }),
    {
      kind: 'agent', agent: 'doc', title: 'Read the salary slip', note: 'The model extracts the pay month and gross pay from the latest slip.', name: 'llm.document_extract()', lat: 1180,
      payload: { months: 1, currency: 'INR', gross_per_month: D.previousMonthlyGross, employer: 'Previous employer (sample)' },
    },
    {
      kind: 'tool', agent: 'ver', title: 'Check the salary slip against the offer', note: 'A simple rule: previous monthly gross should be within a plausible range of the offered monthly CTC. Computed for real.', name: 'payslip.sanity_check()', lat: 15, live: true,
      payload: () => {
        const offered = Math.round(D.annualCtc / 12);
        const previous = D.previousMonthlyGross;
        D.checks.payslips = previous >= offered * 0.5 && previous <= offered * 1.5;
        return { offered_monthly_ctc: offered, previous_monthly_gross: previous, plausible_range: [Math.round(offered * 0.5), Math.round(offered * 1.5)], result: D.checks.payslips ? 'plausible' : 'review' };
      },
    },
    ...(live ? [documentWorkflowStep('salary slip')] : []),
    {
      kind: 'notify', agent: 'orch', title: 'Confirm all documents received', note: 'Tells the candidate what happens next.', name: 'whatsapp.send_text()', lat: 150,
      payload: { state_change: 'AWAITING_SALARY_SLIP → DOCUMENTS_COMPLETE', to: maskPhone(D.mobile) },
      after: async () => {
        await r.bot('Thanks, I have all three documents.', { wait: 500 });
      },
    },
  ]);
}

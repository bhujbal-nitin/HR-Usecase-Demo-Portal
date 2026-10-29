import DocCard from '../../components/DocCard';
import { checkPan, nameSimilarity } from '../../lib/identity';
import { verhoeffValid } from '../../lib/verhoeff';
import { maskPhone, trigger } from './common';
import { documentWorkflowStep } from './workflowStep';

const media = (hash, kb) => ({
  object: 'whatsapp_business_account', type: 'image', image: { mime_type: 'image/jpeg', sha256: hash, id: 'wamid.HBgM…' }, size_kb: kb,
});

/** Aadhaar: vision + OCR are simulated; the checksum and the name comparison run for real. */
export async function aadhaar({ r, D, set, live }) {
  r.msg('out', <DocCard kind="aadhaar" D={D} />, { wide: true });
  const phase = r.phase('Aadhaar verification', 'The photo is read, checked against the form, then confirmed with an identity provider.');
  await r.runSteps(phase, [
    trigger('Document received', 'An image arrives. The agent does not yet know what is in it.', media('b7d0…a93c', 1184)),
    {
      kind: 'tool', agent: 'doc', title: 'Download, scan and encrypt', note: 'The file would be virus-scanned and stored encrypted with a 90-day retention rule.', name: 'media.fetch_and_store()', lat: 440,
      payload: { antivirus: 'clean', content_type: 'image/jpeg', storage: `s3://hr-kyc/${D.last.toUpperCase()}/doc-01.enc`, encryption: 'SSE-KMS', retention_days: 90 },
    },
    {
      kind: 'agent', agent: 'doc', title: 'Identify the document (vision)', note: 'A vision model decides what the document is and whether the photo is readable.', name: 'llm.vision_classify()', lat: 890,
      payload: { label: 'aadhaar_card', confidence: 0.98, expected: 'aadhaar_card', quality: { blur: 'low', glare: 'none', all_corners_visible: true } },
    },
    {
      kind: 'tool', agent: 'doc', title: 'Extract the fields (OCR)', note: 'Text is read from the image into named fields.', name: 'ocr.extract()', lat: 760,
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
      kind: 'api', agent: 'ver', title: 'Confirm with the identity provider', note: 'An e-KYC provider would confirm the card is genuine. Simulated here: no provider is connected.', name: 'kyc.offline_verify()', lat: 980,
      payload: { request: { uid_token: 'tok_••••a21f', consent_id: 'CNS-5521' }, response: { status: 'VERIFIED', matched: ['NAME', 'DOB'], txn: 'KYC-77310' } },
    },
    {
      kind: 'tool', agent: 'ver', title: 'Mask personal data', note: 'Only the last 4 digits would be kept in the conversation record.', name: 'pii_guard.apply()', lat: 140,
      payload: { stored: { uid_last4: D.aadhaar.slice(-4), verified: true }, discarded: ['full_uid', 'raw_ocr_text'], consent_id: 'CNS-5521' },
    },
    ...(live ? [documentWorkflowStep('Aadhaar card')] : []),
    {
      kind: 'notify', agent: 'orch', title: 'Confirm and ask for the PAN card', note: 'Tells the candidate the result and asks for the next document.', name: 'whatsapp.send_text()', lat: 170,
      payload: { state_change: 'AWAITING_AADHAAR → AWAITING_PAN' },
      after: async () => {
        await r.bot(<>Your <b>Aadhaar is verified</b>. Name and date of birth match your form. I kept only the last 4 digits.</>);
        await r.bot(<>Now please send your <b>PAN card</b>.</>, { wait: 500 });
      },
    },
  ]);
  set({});
}

/** PAN: structure check and name match run for real; the tax-database lookup is simulated. */
export async function pan({ r, D, live }) {
  r.msg('out', <DocCard kind="pan" D={D} />, { wide: true });
  const phase = r.phase('PAN verification', 'Same pattern as Aadhaar: read, validate the format, verify, then match names.');
  await r.runSteps(phase, [
    trigger('Document received', 'A second image arrives on the same thread.', media('9f2c…e41a', 968)),
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
      kind: 'api', agent: 'ver', title: 'Verify with the tax database', note: 'A provider would confirm the PAN exists and is linked to Aadhaar. Simulated here: no provider is connected.', name: 'pan.verify()', lat: 870,
      payload: { request: { pan: `${D.pan.slice(0, 5)}•••••` }, response: { valid: true, status: 'ACTIVE', name_on_record: D.panName, aadhaar_link: 'OPERATIVE' } },
    },
    {
      kind: 'agent', agent: 'ver', title: 'Match the PAN name with Aadhaar', note: 'Names are compared after removing case and punctuation. Similarity is computed for real.', name: 'compare_identity()', lat: 410, live: true,
      payload: () => {
        D.checks.panName = nameSimilarity(D.fullName, D.panName);
        return { aadhaar_name: D.fullName, pan_name: D.panName, similarity: D.checks.panName, threshold: 0.9, result: D.checks.panName >= 0.9 ? 'MATCH' : 'NEEDS_REVIEW' };
      },
    },
    ...(live ? [documentWorkflowStep('PAN card')] : []),
    {
      kind: 'notify', agent: 'orch', title: 'Confirm PAN and ask for the salary slip', note: 'Short confirmation, then the next request.', name: 'whatsapp.send_text()', lat: 160,
      payload: { state_change: 'AWAITING_PAN → AWAITING_SALARY_SLIP' },
      after: async () => {
        await r.bot(<>Your <b>PAN is verified</b>. Thanks!</>, { wait: 500 });
        await r.bot(<>One last document, please: your <b>latest salary slip</b>.</>, { wait: 600 });
        D.salaryUploadId = r.msg('in', null, { kind: 'upload', wide: true, upload: { docKey: 'salaryDoc', label: 'latest salary slip' } });
      },
    },
  ]);
}

/** Latest salary slip. */
export async function payslips({ r, D, live }) {
  r.patchMsg(D.salaryUploadId, { upload: { docKey: 'salaryDoc', label: 'latest salary slip', file: { name: 'salary_slip_sample.pdf' } } });
  r.msg('out', <DocCard kind="payslips" D={D} />, { wide: true });
  const phase = r.phase('Salary slip check', 'The salary slip is read and sanity-checked against the offer.');
  await r.runSteps(phase, [
    trigger('Document received', 'A PDF arrives.', { type: 'document', document: { mime_type: 'application/pdf', filename: 'salary_slip.pdf' }, size_kb: 212 }),
    {
      kind: 'agent', agent: 'doc', title: 'Read the salary slip', note: 'The model extracts the pay period and gross pay from the slip.', name: 'llm.document_extract()', lat: 1180,
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

// A stand-in for the pre-onboarding service calls, used by Auto-play · Simulated Environment. The journey code is exactly the same as in the live flow
// (see preOnboardingJourney.jsx); only the calls behind it are replaced by this timed, in-memory play-through, so the flows cannot drift apart.
// Nothing here contacts any system: no ServiceNow request, no document reading, no e-mail.

import { DOCUMENTS, DOCUMENT_BY_KEY } from '../lib/preOnboarding';
import { makeSamplePdf } from '../lib/samplePdf';

const BGV_CHECKS = [
  { name: 'Identity', result: 'Clear', note: 'Aadhaar and PAN match the candidate (sample check)' },
  { name: 'Education', result: 'Clear', note: '10th, 12th and degree certificates verified (sample check)' },
  { name: 'Employment', result: 'Clear', note: 'Previous employment on the resume confirmed (sample check)' },
  { name: 'Address', result: 'Clear', note: 'Current address confirmed (sample check)' },
];

/** @param scale  how much slower than the nominal timings to play (the demo's step scale) */
export function createSimulatedPreOnboardingApi(scale = 1) {
  let record = null;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms * scale));
  const copy = () => JSON.parse(JSON.stringify(record));
  const now = () => new Date().toISOString();

  return {
    simulated: true,

    createCandidate: async (details) => {
      await pause(1100);
      record = {
        id: 'PRE-480126', ...details, annualCtc: Number(details.annualCtc), status: 'Offer released', personal: null, documents: {}, verification: null, bgv: null,
        hr: { status: 'Pending', approver: null, decidedAt: null, note: null }, serviceNow: { reqNumber: 'REQ0010482', reqUrl: null, reqSysId: null, error: null },
        offer: null, acceptance: null, joining: null, createdAt: now(), completedAt: null,
      };
      return copy();
    },

    getCandidate: async () => copy(),

    makeOffer: async () => {
      await pause(1300);
      record.offer = { letterNo: 'OFFER/2026/0001', fileName: `Offer_Letter_${record.fullName.replace(/\s+/g, '_')}.pdf`, generatedAt: now(), sentTo: null, sentAt: null };
      return copy();
    },
    /** A stand-in file (the simulated run has no backend, so it is a one-page sample, not the real letter). */
    offerDownload: (current) => ({
      href: URL.createObjectURL(makeSamplePdf('Offer letter (sample)', [
        `Letter no.: ${current.offer.letterNo}`, '', `Candidate: ${current.fullName}`, `Position: ${current.designation}`, `Department: ${current.department}`,
        `Reporting manager: ${current.manager}`, `Location: ${current.location}`, `Joining date: ${current.joiningDate}`, `Annual CTC: Rs. ${Number(current.annualCtc).toLocaleString('en-IN')}`,
        '', 'The real run makes this letter as a PDF with the company logo and theme.',
      ])),
      filename: current.offer.fileName.replace(/\.pdf$/, '_sample.pdf'),
    }),
    dispatchOffer: async (_id, to) => {
      await pause(1100);
      record.offer = { ...record.offer, sentTo: to ?? record.email, sentAt: now() };
      return copy();
    },

    acceptOffer: async (_id, joiningDate) => {
      await pause(900);
      record.joiningDate = joiningDate || record.joiningDate;
      record.acceptance = { acceptedAt: now(), joiningDate: record.joiningDate };
      record.status = 'Offer accepted';
      return copy();
    },

    savePersonal: async (_id, personal) => {
      await pause(1000);
      record.personal = { ...personal };
      record.status = 'Collecting documents';
      return copy();
    },

    uploadDocument: async (_id, key, file) => {
      await pause(1300);
      const doc = DOCUMENT_BY_KEY[key];
      const named = key !== 'photo';
      const document = {
        key, label: doc.title, fileName: file.name, contentType: file.type, uploadedAt: now(),
        check: { passed: true, readable: true, documentType: key, nameOnDocument: named ? record.fullName : null, nameMatches: named ? true : null, issues: [] },
      };
      record.documents[key] = document;
      return { document: { ...document }, record: copy() };
    },

    verifyDocuments: async () => {
      await pause(1200);
      record.verification = {
        allMatch: true, checkedAt: now(),
        rows: DOCUMENTS.map((doc) => ({
          key: doc.key, label: doc.title, name: doc.key === 'photo' ? null : record.fullName, matches: true,
          note: doc.key === 'photo' ? 'A passport-style photo is present' : 'Matches the candidate',
        })),
      };
      return copy();
    },

    /** The dummy background verification: it always comes back clear. */
    runBackgroundCheck: async () => {
      await pause(1800);
      record.bgv = { status: 'Clear', checkedAt: now(), checks: BGV_CHECKS.map((check) => ({ ...check })) };
      record.status = 'Awaiting HR approval';
      return copy();
    },

    /** The simulated HR approves itself, so the demo can go on. */
    approveHr: async () => {
      record.hr = { status: 'Approved', approver: 'HR (demo)', decidedAt: now(), note: null };
      record.status = 'Approved';
      return copy();
    },

    confirmJoining: async (_id, to) => {
      await pause(1300);
      record.joining = { fileName: `Joining_Instructions_${record.fullName.replace(/\s+/g, '_')}.pdf`, sentTo: to ?? record.email, sentAt: now() };
      record.status = 'Joining confirmed';
      return copy();
    },
    joiningDownload: (current) => ({
      href: URL.createObjectURL(makeSamplePdf('Joining instructions (sample)', [
        `Candidate: ${current.fullName}`, `Position: ${current.designation}`, `Joining date: ${current.joiningDate}`, `Reporting to: ${current.manager}`, `Location: ${current.location}`,
        '', 'The real run makes this letter as a PDF with the company logo and theme.',
      ])),
      filename: current.joining.fileName.replace(/\.pdf$/, '_sample.pdf'),
    }),

    completePreOnboarding: async () => {
      await pause(900);
      record.status = 'Completed';
      record.completedAt = now();
      return copy();
    },
  };
}

import { getAutofillProfile } from '../../../api/system';
import { makePan } from '../lib/identity';
import { makeSamplePdf } from '../lib/samplePdf';
import { toValidAadhaar } from '../lib/verhoeff';

const addDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// Used only if the backend's /api/autofill cannot be reached.
const FALLBACK_PROFILE = {
  fullName: 'Priya Sharma', email: 'priya.sharma92@example.com', phone: '+91 9822 014521', dob: '1997-08-14',
  aadhaar: '234567890123', emergencyName: 'Ramesh Sharma (Father)', emergencyPhone: '+91 9822 000111',
  address: 'Flat 402, Marvel Palms, Baner, Pune, Maharashtra 411045', department: 'Engineering',
  jobTitle: 'Software Engineer II', manager: 'Amit Deshmukh (VP of Engineering)', startDate: addDays(14),
  annualCtc: 2800000, hardware: 'Apple MacBook Pro M3 Max', workLocation: 'Hybrid',
};

const formatDob = (iso) => iso.split('-').reverse().join('/');

/**
 * The fictional candidate for one demo run. Comes from the backend's autofill (unique per run);
 * the Aadhaar number is adjusted so it carries a valid Verhoeff check digit.
 */
export async function buildCandidate() {
  let profile;
  let fromBackend = true;
  try {
    profile = await getAutofillProfile();
  } catch {
    profile = FALLBACK_PROFILE;
    fromBackend = false;
  }
  const parts = profile.fullName.trim().split(/\s+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  const aadhaar = toValidAadhaar(profile.aadhaar);
  const mobile = profile.phone.replace(/\D/g, '').slice(-10);

  const candidate = {
    ...profile,
    uan: '', // not collected in the demo
    fromBackend,
    first,
    last,
    mobile,
    dobDisplay: formatDob(profile.dob),
    aadhaar,
    pan: makePan(last),
    // Fictional previous salary (85% of the offered monthly CTC) shown on the sample salary slip.
    previousMonthlyGross: Math.round((profile.annualCtc / 12) * 0.85),
    panName: profile.fullName.toUpperCase(),
    fatherName: `RAMESH ${last}`.toUpperCase(),
    checks: {}, // filled in by the verification phases with the real results
  };

  // The three documents the backend requires (the EPFO UAN card is optional and not part of this demo). All content is fictional and stamped SAMPLE.
  candidate.files = {
    idDoc: new File([makeSamplePdf('Aadhaar - sample', [
      `Name: ${profile.fullName}`, `Date of birth: ${candidate.dobDisplay}`, `Aadhaar: XXXX XXXX ${aadhaar.slice(-4)}`, `Address: ${profile.address}`,
    ])], 'aadhaar_sample.pdf', { type: 'application/pdf' }),
    panDoc: new File([makeSamplePdf('PAN card - sample', [
      `Name: ${profile.fullName}`, `Date of birth: ${candidate.dobDisplay}`, `Permanent Account Number: ${candidate.pan ?? 'SAMPLE'}`,
    ])], 'pan_sample.pdf', { type: 'application/pdf' }),
    salaryDoc: new File([makeSamplePdf('Salary slip (latest month) - sample', [
      `Employee: ${profile.fullName}`, 'Month: most recent',
      `Monthly gross: INR ${candidate.previousMonthlyGross.toLocaleString('en-IN')}`,
    ])], 'salary_slip_sample.pdf', { type: 'application/pdf' }),
  };
  return candidate;
}

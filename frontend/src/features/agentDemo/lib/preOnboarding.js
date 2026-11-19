// Pre-onboarding: the facts the journey, the simulated run and the Sample Files page share. The lifecycle: the offer is released (HR enters the details, the
// offer letter is e-mailed), the candidate accepts it and confirms the joining date, registers and logs in (a chat step), fills in their personal
// information and sends seven documents (each is read and its name compared with the candidate's), a dummy background check runs, HR approves on the
// Approvals page, the joining instructions are e-mailed, and pre-onboarding is completed so that onboarding can begin.

import { joiningDate } from '../../sampleFiles/samplePeople';

const DOCUMENT_FOLDER = `${import.meta.env.BASE_URL}sample-documents/pre-onboarding`; // under the portal's base path (/hr/)

/** The seven documents, in the order they are asked for. `prefix` is the start of the sample file's name. */
export const DOCUMENTS = [
  { key: 'tenth', label: '10th marksheet', title: '10th marksheet', icon: 'fa-file-lines', prefix: '10th_Marksheet', ext: 'pdf', hint: 'Class X statement of marks' },
  { key: 'twelfth', label: '12th marksheet', title: '12th marksheet', icon: 'fa-file-lines', prefix: '12th_Marksheet', ext: 'pdf', hint: 'Class XII statement of marks' },
  { key: 'degree', label: 'degree certificate', title: 'Degree certificate', icon: 'fa-graduation-cap', prefix: 'Degree_Certificate', ext: 'pdf', hint: 'Final graduation certificate' },
  { key: 'aadhaar', label: 'Aadhaar card', title: 'Aadhaar card', icon: 'fa-id-card', prefix: 'Aadhaar_Card', ext: 'pdf', hint: 'Masked or full' },
  { key: 'pan', label: 'PAN card', title: 'PAN card', icon: 'fa-address-card', prefix: 'PAN_Card', ext: 'pdf', hint: 'Income Tax PAN card' },
  { key: 'photo', label: 'passport photo', title: 'Passport photo', icon: 'fa-image-portrait', prefix: 'Passport_Photo', ext: 'jpg', hint: 'Passport-style photo' },
  { key: 'resume', label: 'resume', title: 'Resume', icon: 'fa-user-tie', prefix: 'Resume', ext: 'pdf', hint: 'Latest resume' },
];
export const DOCUMENT_BY_KEY = Object.fromEntries(DOCUMENTS.map((doc) => [doc.key, doc]));
export const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx';

/** The one sample candidate: their name is on all seven sample documents. The e-mail is left out on purpose: the offer letter really is sent to it. */
export const SAMPLE_CANDIDATE = {
  file: 'Priya_Anil_Nair', fullName: 'Priya Anil Nair', phone: '+91 98670 20771', designation: 'Senior Manager - Finance', department: 'Finance',
  manager: 'Anand Rao (Finance Director)', location: 'Mumbai', annualCtc: '1800000',
  personal: {
    dateOfBirth: '1993-03-03', gender: 'Female', maritalStatus: 'Single', currentAddress: 'B-17, Green Park Society, Andheri East, Mumbai, Maharashtra - 400069',
    permanentAddress: 'B-17, Green Park Society, Andheri East, Mumbai, Maharashtra - 400069', emergencyName: 'Anil Kumar Nair', emergencyRelation: 'Father', emergencyPhone: '+91 98670 20772',
  },
};

/** Two more sample candidates for Manual · Live (each has all seven documents; Auto-play always uses the first). Same fields as SAMPLE_CANDIDATE. */
export const MORE_SAMPLE_CANDIDATES = [
  {
    file: 'Rahul_Sharma', fullName: 'Rahul Suresh Sharma', phone: '+91 98220 10458', designation: 'Senior Operations Analyst', department: 'Operations',
    manager: 'Meera Kulkarni (Head of Operations)', location: 'Pune', annualCtc: '1400000',
    personal: {
      dateOfBirth: '1990-08-15', gender: 'Male', maritalStatus: 'Married', currentAddress: 'Flat 402, Sunrise Apartments, Baner Road, Pune, Maharashtra - 411045',
      permanentAddress: 'Flat 402, Sunrise Apartments, Baner Road, Pune, Maharashtra - 411045', emergencyName: 'Suresh Ramesh Sharma', emergencyRelation: 'Father', emergencyPhone: '+91 98220 10459',
    },
  },
  {
    file: 'Mohammed_Imran_Khan', fullName: 'Mohammed Imran Khan', phone: '+91 99890 30145', designation: 'Software Engineer II', department: 'Engineering',
    manager: 'Amit Deshmukh (VP of Engineering)', location: 'Hyderabad', annualCtc: '1100000',
    personal: {
      dateOfBirth: '1987-11-27', gender: 'Male', maritalStatus: 'Married', currentAddress: 'H.No. 21-4/B, Jubilee Hills, Hyderabad, Telangana - 500033',
      permanentAddress: 'H.No. 21-4/B, Jubilee Hills, Hyderabad, Telangana - 500033', emergencyName: 'Abdul Rahim Khan', emergencyRelation: 'Father', emergencyPhone: '+91 99890 30146',
    },
  },
];
export const SAMPLE_CANDIDATES = [SAMPLE_CANDIDATE, ...MORE_SAMPLE_CANDIDATES];

export const SIMULATED_EMAIL = 'priya.nair.demo@example.com'; // only shown in a Simulated Environment run: nothing is ever sent to it

/** The values the details form starts with (and Auto-play fills in). */
export const sampleDetails = (email = '', candidate = SAMPLE_CANDIDATE) => ({
  fullName: candidate.fullName, email, phone: candidate.phone, designation: candidate.designation, department: candidate.department,
  manager: candidate.manager, location: candidate.location, annualCtc: candidate.annualCtc, joiningDate: joiningDate(),
});

/** The personal information the candidate fills in (step 4) for a sample candidate. */
export const samplePersonal = (candidate = SAMPLE_CANDIDATE) => ({ ...candidate.personal });
/** The sample personal information of the sample candidate with this name, or an empty form for anybody else (Manual can type a different candidate). */
export const samplePersonalFor = (fullName) => {
  const match = SAMPLE_CANDIDATES.find((candidate) => candidate.fullName === fullName);
  return match ? samplePersonal(match) : {
    dateOfBirth: '', gender: 'Female', maritalStatus: 'Single', currentAddress: '', permanentAddress: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  };
};

export const GENDERS = ['Female', 'Male', 'Other'];
export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'];

/** Where each sample file is and what it is called (for the Sample Files page and for Auto-play). */
export const sampleFileOf = (doc, candidate = SAMPLE_CANDIDATE) => {
  const filename = `${doc.prefix}_${candidate.file}.${doc.ext}`;
  return { ...doc, href: `${DOCUMENT_FOLDER}/${filename}`, filename };
};
export const sampleFiles = (candidate = SAMPLE_CANDIDATE) => DOCUMENTS.map((doc) => sampleFileOf(doc, candidate));

const TYPE = { pdf: 'application/pdf', jpg: 'image/jpeg' };

/** The sample file of a document as a File, fetched from the portal (Auto-play uploads it as if the candidate sent it). */
export async function loadSampleFile(doc) {
  const sample = sampleFileOf(doc);
  const response = await fetch(sample.href);
  if (!response.ok) throw new Error(`The sample ${doc.label} could not be loaded.`);
  return new File([await response.blob()], sample.filename, { type: TYPE[doc.ext] });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** { field: message } for the candidate's details form (empty when valid). The backend repeats these checks. */
export function validateCandidate(values) {
  const errors = {};
  const need = (id, message, ok = (value) => value.trim().length >= 2) => { if (!ok(values[id] ?? '')) errors[id] = message; };
  need('fullName', 'Enter the candidate’s full name.', (v) => v.trim().split(/\s+/).length >= 2);
  need('email', 'Enter a valid e-mail address: the offer letter is sent here.', (v) => EMAIL.test(v.trim()));
  need('phone', 'Enter a phone number.', (v) => v.replace(/\D/g, '').length >= 8);
  need('designation', 'Enter the job title.');
  need('department', 'Enter the department.');
  need('manager', 'Enter the reporting manager.');
  need('location', 'Enter the work location.');
  need('annualCtc', 'Enter the yearly pay (CTC) in rupees.', (v) => Number(v) >= 100000 && Number(v) <= 100000000);
  if (!values.joiningDate) errors.joiningDate = 'Choose the joining date.';
  return errors;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isSunday = (iso) => new Date(`${iso}T00:00:00`).getDay() === 0;

/** The latest date of birth that makes the candidate 18 today (yyyy-mm-dd). */
export const latestBirthDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Step 2: the candidate confirms the joining date. The backend repeats these checks. */
export function validateAcceptance(values) {
  const errors = {};
  if (!values.joiningDate) errors.joiningDate = 'Choose the joining date.';
  else if (values.joiningDate < todayIso()) errors.joiningDate = 'The joining date cannot be in the past.';
  else if (isSunday(values.joiningDate)) errors.joiningDate = 'Sunday is a weekly off, so the joining date cannot be on a Sunday.';
  return errors;
}

/** Step 4: the personal information form. The backend repeats these checks. */
export function validatePersonal(values) {
  const errors = {};
  const need = (id, message, ok = (value) => value.trim().length >= 2) => { if (!ok(values[id] ?? '')) errors[id] = message; };
  if (!values.dateOfBirth) errors.dateOfBirth = 'Choose the date of birth.';
  else if (values.dateOfBirth > latestBirthDate()) errors.dateOfBirth = 'The candidate must be at least 18 years old.';
  need('gender', 'Choose the gender.', (v) => GENDERS.includes(v));
  need('maritalStatus', 'Choose the marital status.', (v) => MARITAL_STATUSES.includes(v));
  need('currentAddress', 'Enter the current address.', (v) => v.trim().length >= 5);
  need('permanentAddress', 'Enter the permanent address.', (v) => v.trim().length >= 5);
  need('emergencyName', 'Enter the name of the emergency contact.');
  need('emergencyRelation', 'Enter how this person is related.');
  need('emergencyPhone', 'Enter the emergency contact’s phone number.', (v) => v.replace(/\D/g, '').length >= 8);
  return errors;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A problem with a chosen file, or '' when it can be sent. */
export function validateDocumentFile(file) {
  if (!file) return 'No file was chosen.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_FILE_BYTES) return 'That file is larger than 10 MB.';
  if (!/\.(pdf|png|jpe?g|webp|docx)$/i.test(file.name)) return 'Please send a PDF, a photo (PNG, JPG, WEBP) or a .docx file.';
  return '';
}

export const SCENARIOS = [{ id: 'start', label: 'Start my pre-onboarding', intent: 'pre_onboarding.start' }];

/** What a message means in Manual mode: 'start', 'done' or null. */
export function detectIntent(text) {
  const t = String(text ?? '').toLowerCase();
  if (/(^|\b)(no|nothing|that'?s all|that is all|done|bye|thanks|thank you|exit|stop)\b/.test(t)) return 'done';
  if (/pre.?onboard|start|begin|join|offer|document|upload|yes|ok/.test(t)) return 'start';
  return null;
}

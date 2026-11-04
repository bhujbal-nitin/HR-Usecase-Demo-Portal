// The three sample candidates for the Manual · Live onboarding demo. Each has three documents (PDFs kept in public/sample-documents/onboarding) and the
// details to type into the joining form. Name, date of birth, Aadhaar, PAN, UAN, address and father's name are exactly what the documents show; the
// e-mail, phones, role, manager, CTC, workstation and work location are fictional.

const DOCUMENT_FOLDER = '/sample-documents/onboarding';

export const SAMPLE_PEOPLE = [
  {
    id: 'rahul-sharma', name: 'Rahul Suresh Sharma', summary: 'Pune · joins Operations', file: 'Rahul_Sharma',
    details: {
      fullName: 'Rahul Suresh Sharma', email: 'rahul.sharma.demo@example.com', phone: '+91 98220 10458', dob: '1990-08-15', aadhaar: '1234 5678 9012', uan: '100123456789',
      emergencyName: 'Suresh Ramesh Sharma (Father)', emergencyPhone: '+91 98220 10459', address: 'Flat 402, Sunrise Apartments, Baner Road, Pune, Maharashtra - 411045',
      department: 'Operations', jobTitle: 'Senior Operations Analyst', manager: 'Meera Kulkarni (Head of Operations)', annualCtc: '1400000',
      hardware: 'Dell XPS 15 9530 (i9 64GB RTX)', workLocation: 'On-Site (Pune Tech Park)',
    },
  },
  {
    id: 'priya-nair', name: 'Priya Anil Nair', summary: 'Mumbai · joins Finance', file: 'Priya_Anil_Nair',
    details: {
      fullName: 'Priya Anil Nair', email: 'priya.nair.demo@example.com', phone: '+91 98670 20771', dob: '1993-03-03', aadhaar: '2345 6789 0123', uan: '100234567890',
      emergencyName: 'Anil Kumar Nair (Father)', emergencyPhone: '+91 98670 20772', address: 'B-17, Green Park Society, Andheri East, Mumbai, Maharashtra - 400069',
      department: 'Finance', jobTitle: 'Senior Manager - Finance', manager: 'Anand Rao (Finance Director)', annualCtc: '1800000',
      hardware: 'Apple MacBook Pro 16" M3 Pro', workLocation: 'Hybrid',
    },
  },
  {
    id: 'imran-khan', name: 'Mohammed Imran Khan', summary: 'Hyderabad · joins Engineering', file: 'Mohammed_Imran_Khan',
    details: {
      fullName: 'Mohammed Imran Khan', email: 'imran.khan.demo@example.com', phone: '+91 99890 30145', dob: '1987-11-27', aadhaar: '3456 7890 1234', uan: '100345678901',
      emergencyName: 'Abdul Rahim Khan (Father)', emergencyPhone: '+91 99890 30146', address: 'H.No. 21-4/B, Jubilee Hills, Hyderabad, Telangana - 500033',
      department: 'Engineering', jobTitle: 'Software Engineer II', manager: 'Amit Deshmukh (VP of Engineering)', annualCtc: '1100000',
      hardware: 'Lenovo ThinkPad P1 Gen 6', workLocation: 'Remote',
    },
  },
];

/** The three documents of a person: where each one is and what the download is called. */
export const documentsOf = (person) => [
  ['aadhaar', 'Aadhaar card', 'fa-id-card', 'Aadhaar_Card'],
  ['pan', 'PAN card', 'fa-address-card', 'PAN_Card'],
  ['salary', 'Salary slip', 'fa-file-invoice-dollar', 'Salary_Slip'],
].map(([key, title, icon, prefix]) => ({ key, title, icon, href: `${DOCUMENT_FOLDER}/${prefix}_${person.file}.pdf`, filename: `${prefix}_${person.file}.pdf` }));

const dmy = (iso) => iso.split('-').reverse().join('/');
const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The joining date offered: three weeks from today, so it is always a date in the future. */
export const joiningDate = (today = new Date()) => {
  const date = new Date(today);
  date.setDate(date.getDate() + 21);
  return isoDate(date);
};

/**
 * The text of the form-details file: one "Field: value" line per field of the joining form, in the order of the form, so each value can be copied and pasted.
 * The two dates are shown as dd/mm/yyyy; pick them in the form's date box.
 */
export function formDetailsText(person, today = new Date()) {
  const d = person.details;
  return [
    `JOINING FORM DETAILS - ${person.name}`,
    'Copy each value into the matching box of the joining form (Manual · Live onboarding demo).',
    '',
    'PERSONAL DETAILS',
    `Full Legal Name: ${d.fullName}`,
    `Personal Email Address: ${d.email}`,
    `Phone Number: ${d.phone}`,
    `Date of Birth: ${dmy(d.dob)}   (pick this date in the date box)`,
    `Aadhaar Number: ${d.aadhaar}`,
    `EPFO UAN Number: ${d.uan}`,
    `Emergency Contact Name: ${d.emergencyName}`,
    `Emergency Contact Phone: ${d.emergencyPhone}`,
    `Residential Address: ${d.address}`,
    '',
    'EMPLOYMENT DETAILS',
    `Department: ${d.department}`,
    `Job Title: ${d.jobTitle}`,
    `Reporting Manager: ${d.manager}`,
    `Joining Date: ${dmy(joiningDate(today))}   (pick this date in the date box)`,
    `Annual CTC (INR): ${d.annualCtc}`,
    `Preferred Workstation: ${d.hardware}   (choose from the list)`,
    `Work Location: ${d.workLocation}   (choose from the list)`,
    '',
    'DOCUMENTS TO ATTACH (download them from the Sample Files page)',
    `Aadhaar Card: Aadhaar_Card_${person.file}.pdf`,
    `PAN Card: PAN_Card_${person.file}.pdf`,
    `Latest Salary Slip: Salary_Slip_${person.file}.pdf`,
    '',
  ].join('\r\n');
}

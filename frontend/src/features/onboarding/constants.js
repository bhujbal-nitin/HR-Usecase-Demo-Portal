export const STEPS = [
  { num: 1, label: 'Personal Details', icon: 'fa-user' },
  { num: 2, label: 'Documents & Signature', icon: 'fa-folder-open' },
];

export const PERSONAL_FIELDS = [
  { id: 'fullName', label: 'Full Legal Name', type: 'text', placeholder: 'e.g. Aarav Sharma', autoComplete: 'name' },
  { id: 'email', label: 'Personal Email Address', type: 'email', placeholder: 'aarav.sharma@example.com', autoComplete: 'email' },
  { id: 'phone', label: 'Phone Number', type: 'tel', placeholder: '+91 98765 43210', autoComplete: 'tel' },
  { id: 'dob', label: 'Date of Birth', type: 'date', autoComplete: 'bday' },
  { id: 'aadhaar', label: 'Aadhaar Number', type: 'text', placeholder: '12-digit Aadhaar number', inputMode: 'numeric', maxLength: 14 },
  { id: 'uan', label: 'EPFO UAN Number', type: 'text', placeholder: '12-digit UAN number', inputMode: 'numeric', maxLength: 14 },
  { id: 'emergencyName', label: 'Emergency Contact Name', type: 'text', placeholder: 'e.g. Sunita Sharma (Mother)' },
  { id: 'emergencyPhone', label: 'Emergency Contact Phone', type: 'tel', placeholder: '+91 98765 00000' },
  { id: 'address', label: 'Residential Address', type: 'text', placeholder: 'Flat 402, Marvel Palms, Baner, Pune, Maharashtra 411045', full: true, autoComplete: 'street-address' },
];

export const DEPARTMENT_SUGGESTIONS = [
  'Engineering', 'Data & AI', 'Quality Assurance', 'Cloud Infrastructure', 'Product Management', 'Cybersecurity',
  'Human Resources', 'Finance', 'Marketing',
];

export const HARDWARE_OPTIONS = [
  'Apple MacBook Pro M3 Max',
  'Apple MacBook Pro 16" M3 Pro',
  'Dell XPS 15 9530 (i9 64GB RTX)',
  'Lenovo ThinkPad P1 Gen 6',
];

export const WORK_LOCATIONS = ['Hybrid', 'On-Site (Pune Tech Park)', 'Remote'];

export const EMPLOYMENT_FIELDS = [
  { id: 'department', label: 'Department', type: 'text', placeholder: 'e.g. Engineering', list: 'department-suggestions' },
  { id: 'jobTitle', label: 'Job Title', type: 'text', placeholder: 'e.g. Staff AI Systems Engineer' },
  { id: 'manager', label: 'Reporting Manager', type: 'text', placeholder: 'e.g. Amit Deshmukh (VP of Engineering)' },
  { id: 'startDate', label: 'Joining Date', type: 'date' },
  { id: 'annualCtc', label: 'Annual CTC (₹)', type: 'number', placeholder: 'e.g. 3200000', min: 1, step: 1000 },
  { id: 'hardware', label: 'Preferred Workstation', type: 'select', options: HARDWARE_OPTIONS },
  { id: 'workLocation', label: 'Work Location', type: 'select', options: WORK_LOCATIONS },
];

export const DOCUMENTS = [
  { key: 'idDoc', title: 'Aadhaar Card', icon: 'fa-id-card', prompt: 'Click or drag Aadhaar Card here', hint: 'PDF or Word copy' },
  { key: 'panDoc', title: 'PAN Card', icon: 'fa-address-card', prompt: 'Click or drag PAN Card here', hint: 'PDF or Word copy' },
  { key: 'salaryDoc', title: 'Latest Salary Slip', icon: 'fa-file-invoice-dollar', prompt: 'Click or drag the latest Salary Slip', hint: 'PDF or Word copy' },
  { key: 'uanDoc', title: 'EPFO Card / UAN Certificate', icon: 'fa-file-shield', prompt: 'Click or drag EPFO Card', hint: 'PDF or Word copy' },
];

export const INITIAL_VALUES = {
  fullName: '', email: '', phone: '', dob: '', aadhaar: '', uan: '',
  emergencyName: '', emergencyPhone: '', address: '',
  department: '', jobTitle: '', manager: '', startDate: '', annualCtc: '',
  hardware: HARDWARE_OPTIONS[0], workLocation: WORK_LOCATIONS[0],
};

export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // keep in sync with MAX_UPLOAD_BYTES on the backend

import { ALLOWED_EXTENSIONS, DOCUMENTS, EMPLOYMENT_FIELDS, MAX_FILE_BYTES, PERSONAL_FIELDS } from './constants';

const digitsOnly = (value) => value.replace(/\D/g, '');

/** Mirrors the backend `CandidateCreate` rules so users get feedback before submitting. */
export function validateField(id, rawValue, today = new Date()) {
  const value = String(rawValue ?? '').trim();
  if (!value) return 'This field is required.';

  switch (id) {
    case 'fullName':
      return value.length < 2 ? 'Enter the full name.' : '';
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Enter a valid email address, e.g. name@example.com.';
    case 'phone':
    case 'emergencyPhone':
      return digitsOnly(value).length >= 10 ? '' : 'Enter at least 10 digits.';
    case 'dob':
      return new Date(`${value}T00:00:00`) < today ? '' : 'Date of birth must be in the past.';
    case 'aadhaar':
      return digitsOnly(value).length === 12 ? '' : 'Aadhaar number must be exactly 12 digits.';
    case 'uan':
      return digitsOnly(value).length === 12 ? '' : 'EPFO UAN number must be exactly 12 digits.';
    case 'address':
      return value.length < 5 ? 'Enter the complete address.' : '';
    case 'annualCtc':
      return Number.isInteger(Number(value)) && Number(value) > 0 ? '' : 'Enter the annual CTC as a whole number of rupees.';
    default:
      return value.length < 2 ? 'This field is required.' : '';
  }
}

export function validateStep1(values) {
  const errors = {};
  [...PERSONAL_FIELDS, ...EMPLOYMENT_FIELDS].forEach(({ id }) => {
    const message = validateField(id, values[id]);
    if (message) errors[id] = message;
  });
  return errors;
}

export function validateFile(file) {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return 'Only PDF (.pdf) and Word (.doc, .docx) files are accepted.';
  }
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > MAX_FILE_BYTES) return `File is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`;
  return '';
}

export function validateDocuments(files) {
  const errors = {};
  DOCUMENTS.forEach(({ key, title }) => {
    if (!files[key]) errors[key] = `${title} is required.`;
  });
  return errors;
}

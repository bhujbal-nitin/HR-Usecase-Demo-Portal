import { describe, expect, it } from 'vitest';
import { INITIAL_VALUES } from './constants';
import { validateDocuments, validateField, validateFile, validateStep1 } from './validation';

const TODAY = new Date('2026-10-21T00:00:00');

describe('validateField', () => {
  it('requires a value', () => {
    expect(validateField('fullName', '   ')).toMatch(/required/i);
  });

  it('checks email shape', () => {
    expect(validateField('email', 'nope')).toMatch(/valid email/i);
    expect(validateField('email', 'a@b.co')).toBe('');
  });

  it('requires ten digits in phone numbers regardless of formatting', () => {
    expect(validateField('phone', '+91 98765')).toMatch(/10 digits/);
    expect(validateField('phone', '+91 98765 43210')).toBe('');
  });

  it('requires exactly twelve digits for Aadhaar and UAN, allowing spaces', () => {
    expect(validateField('aadhaar', '1234')).toMatch(/12 digits/);
    expect(validateField('aadhaar', '2345 6789 0123')).toBe('');
    expect(validateField('uan', '1012 9845 2310 9')).toMatch(/12 digits/);
  });

  it('rejects a birth date that is not in the past', () => {
    expect(validateField('dob', '2026-10-21', TODAY)).toMatch(/past/);
    expect(validateField('dob', '1995-07-20', TODAY)).toBe('');
  });

  it('requires CTC to be a positive whole number', () => {
    expect(validateField('annualCtc', '0')).toMatch(/whole number/);
    expect(validateField('annualCtc', '32.5')).toMatch(/whole number/);
    expect(validateField('annualCtc', '3200000')).toBe('');
  });
});

describe('validateStep1', () => {
  it('flags every empty required field', () => {
    const errors = validateStep1(INITIAL_VALUES);
    expect(errors.fullName).toBeTruthy();
    expect(errors.annualCtc).toBeTruthy();
    expect(errors.hardware).toBeUndefined(); // has a default selection
  });
});

describe('validateFile', () => {
  const file = (name, size = 10) => ({ name, size });

  it('accepts PDF and Word documents', () => {
    expect(validateFile(file('a.PDF'))).toBe('');
    expect(validateFile(file('a.docx'))).toBe('');
  });

  it('rejects other types, empty files and oversized files', () => {
    expect(validateFile(file('a.png'))).toMatch(/PDF/);
    expect(validateFile(file('a.pdf', 0))).toMatch(/empty/);
    expect(validateFile(file('a.pdf', 11 * 1024 * 1024))).toMatch(/larger/);
  });
});

describe('validateDocuments', () => {
  it('lists missing documents', () => {
    expect(Object.keys(validateDocuments({ idDoc: {} }))).toEqual(['panDoc', 'salaryDoc', 'uanDoc']);
  });
});

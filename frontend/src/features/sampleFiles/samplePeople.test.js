import { describe, expect, it } from 'vitest';
import { SAMPLE_PEOPLE, documentsOf, formDetailsText, joiningDate } from './samplePeople';
import { HARDWARE_OPTIONS, WORK_LOCATIONS } from '../onboarding/constants';
import { validateField } from '../onboarding/validation';

describe('sample people', () => {
  it('offers three people, each with the three documents', () => {
    expect(SAMPLE_PEOPLE).toHaveLength(3);
    SAMPLE_PEOPLE.forEach((person) => expect(documentsOf(person).map((d) => d.key)).toEqual(['aadhaar', 'pan', 'salary']));
  });

  it('uses a workstation and work location that the form offers, and a 12-digit Aadhaar and UAN', () => {
    SAMPLE_PEOPLE.forEach(({ details }) => {
      expect(HARDWARE_OPTIONS).toContain(details.hardware);
      expect(WORK_LOCATIONS).toContain(details.workLocation);
      expect(details.aadhaar.replace(/\D/g, '')).toHaveLength(12);
      expect(details.uan).toHaveLength(12);
    });
  });

  it('passes the checks of the joining form for every field', () => {
    SAMPLE_PEOPLE.forEach(({ details }) => {
      const values = { ...details, startDate: joiningDate() };
      Object.entries(values).forEach(([id, value]) => expect(validateField(id, value), `${details.fullName}: ${id}`).toBe(''));
    });
  });

  it('writes every field of the joining form in the text file', () => {
    const text = formDetailsText(SAMPLE_PEOPLE[0]);
    ['Full Legal Name: Rahul Suresh Sharma', 'Date of Birth: 15/08/1990', 'Aadhaar Number: 1234 5678 9012', 'Annual CTC (INR): 1400000'].forEach((line) => expect(text).toContain(line));
  });

  it('offers a joining date three weeks after the given day', () => {
    expect(joiningDate(new Date(2026, 10, 4))).toBe('2026-11-25');
  });
});

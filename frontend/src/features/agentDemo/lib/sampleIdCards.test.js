import { describe, expect, it } from 'vitest';
import { aadhaarCardPdf, panCardPdf, salarySlipPdf } from './sampleIdCards';

const candidate = {
  fullName: 'Priya Sharma', dobDisplay: '14/08/1997', aadhaar: '234567890123', pan: 'CRQPS3846K', panName: 'PRIYA SHARMA', fatherName: 'RAMESH SHARMA',
  address: 'Flat 402, Marvel Palms, Baner, Pune, Maharashtra 411045', department: 'Engineering', previousMonthlyGross: 198000,
};

describe('sample identity documents', () => {
  it('draws the Aadhaar card with the name, date of birth and only the last four digits of the number', async () => {
    const text = await aadhaarCardPdf(candidate).text();
    expect(text).toContain('Priya Sharma');
    expect(text).toContain('14/08/1997');
    expect(text).toContain('XXXX XXXX 0123');
    expect(text).not.toContain('234567890123');
  });

  it('draws the PAN card with the number, the name, the father\'s name and the date of birth', async () => {
    const text = await panCardPdf(candidate).text();
    ['INCOME TAX DEPARTMENT', 'CRQPS3846K', 'PRIYA SHARMA', 'RAMESH SHARMA', '14/08/1997'].forEach((part) => expect(text).toContain(part));
  });

  it('draws a salary slip whose figures add up', async () => {
    const text = await salarySlipPdf(candidate).text();
    expect(text).toContain('Employee Name: Priya Sharma');
    expect(text).toContain('Rs. 1,98,000'); // gross = the previous monthly gross
  });
});

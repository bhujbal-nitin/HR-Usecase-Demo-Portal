import { describe, expect, it } from 'vitest';
import { wrap } from './form16Pdf';
import { PdfPage, textWidth } from './pdf';
import { financialYear, inr } from './sampleDocuments';
import { form16Model, money, sampleForm16 } from './sampleForm16';
import { ctcModel, payslipModel, rupeesInWords, sampleCtc, samplePayslip } from './sampleSlips';

const EMPLOYEE = { employeeId: 'AE-482915', fullName: 'Aditi Rao', jobTitle: 'Senior Product Designer', department: 'Design' };

const textOf = async (blob) => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

describe('sample documents', () => {
  it('groups amounts the Indian way', () => {
    expect(inr(2400000)).toBe('24,00,000');
    expect(inr(24375)).toBe('24,375');
    expect(inr(200)).toBe('200');
  });

  it('writes amounts in words like the backend', () => {
    expect(rupeesInWords(30676)).toBe('Thirty Thousand Six Hundred Seventy Six Rupees');
    expect(rupeesInWords(2400000)).toBe('Twenty Four Lakh Rupees');
    expect(rupeesInWords(165825)).toBe('One Lakh Sixty Five Thousand Eight Hundred Twenty Five Rupees');
  });

  it('knows the last completed financial year', () => {
    expect(financialYear(new Date(2026, 9, 30))).toEqual(['2025-26', '2026-27']);
    expect(financialYear(new Date(2026, 1, 1))).toEqual(['2024-25', '2025-26']);
  });

  it('measures text in Helvetica widths', () => {
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 1);
    expect(textWidth('Hello', 10, true)).toBeGreaterThan(textWidth('Hello', 10));
  });

  it('the payslip adds up: earnings less deductions is the net pay', () => {
    const m = payslipModel(EMPLOYEE, 'October 2026', 31);
    expect(m.title).toBe('Salary Slip for Oct 2026');
    expect(m.left).toContain('Employee Name: Aditi Rao');
    expect(m.left).toContain('Employee Code: AE482915');
    expect(m.earnings.map(([label]) => label)).toEqual(['Basic', 'Conveyance Allowance', 'HRA', 'Special Allowance']);
    const number = (text) => Number(text.replace(/,/g, ''));
    expect(m.earnings.reduce((sum, [, amount]) => sum + number(amount), 0)).toBe(number(m.totalEarnings));
    expect(m.deductions.reduce((sum, [, amount]) => sum + number(amount), 0)).toBe(number(m.totalDeductions));
    expect(number(m.totalEarnings) - number(m.totalDeductions)).toBe(number(m.net));
    expect(m.net).toBe('1,65,825');
  });

  it('the CTC statement splits 24,00,000 into parts that add up', () => {
    const m = ctcModel(EMPLOYEE, new Date(2026, 9, 30));
    const number = (text) => Number(text.replace(/,/g, ''));
    expect(m.sections[0][1].reduce((sum, row) => sum + number(row[2]), 0)).toBe(2400000);
    expect(m.totals[0]).toEqual(['Gross pay (CTC)', '2,00,000', '24,00,000']);
  });

  it('makes one-page PDFs carrying the employee name and figures', async () => {
    const slip = samplePayslip(EMPLOYEE, 'October 2026', 31);
    expect(slip.type).toBe('application/pdf');
    const raw = await textOf(slip);
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(raw).toContain('/Count 1');
    expect(raw).toContain('(Employee Name: Aditi Rao)');
    expect(raw).toContain('(Salary Slip for Oct 2026)');
    expect(raw).toContain('(Rs. 1,65,825)');
    const ctc = await textOf(sampleCtc(EMPLOYEE));
    expect(ctc).toContain('(Employee Name: Aditi Rao)');
    expect(ctc).toContain('(24,00,000)');
  });

  it('embeds a logo given as a PNG', async () => {
    const page = new PdfPage();
    page.logo({ width: 2, height: 1, data: new Uint8Array([1, 2, 3]) }, 10, 10, 20, 10);
    const raw = await textOf(page.toBlob());
    expect(raw).toContain('/Subtype /Image');
    expect(raw).toContain('/Im1 Do');
  });

  it('writes money with two decimals', () => {
    expect([money(600000), money(22000), money(0)]).toEqual(['6,00,000.00', '22,000.00', '0.00']);
  });

  it('wraps long text into lines that fit', () => {
    const lines = wrap('Flat 10, Residency Park, Baner, Pune, Maharashtra - 411045', 120, 8);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Flat 10, Residency Park, Baner, Pune, Maharashtra - 411045');
    expect(lines.every((line) => textWidth(line, 8) <= 120)).toBe(true);
  });

  it('the Form 16 figures add up and read like the real certificate', () => {
    const m = form16Model(EMPLOYEE, new Date(2026, 9, 30));
    expect([m.year, m.assessment]).toEqual(['2025-26', '2026-27']);
    expect(m.quarters.map((q) => q[0])).toEqual(['Q1 (Apr-Jun 2025)', 'Q2 (Jul-Sep 2025)', 'Q3 (Oct-Dec 2025)', 'Q4 (Jan-Mar 2026)', 'Total']);
    expect(m.quarters[0].slice(2)).toEqual(['73,125.00', '73,125.00']);
    expect(m.quarters[4].slice(2)).toEqual(['2,92,500.00', '2,92,500.00']);
    const figures = Object.fromEntries(m.computation.map(([label, amount]) => [label, amount]));
    expect(figures['Total taxable income']).toBe('23,25,000.00');
    expect(figures['Total tax liability']).toBe('2,92,500.00');
    expect(JSON.stringify(m).toLowerCase()).not.toMatch(/demo|sample|fictional|illustrative/);
  });

  it('makes the Form 16 as a one-page PDF with the employee name and figures', async () => {
    const form16 = sampleForm16(EMPLOYEE, null, new Date(2026, 9, 30));
    expect(form16.type).toBe('application/pdf');
    const raw = await textOf(form16);
    expect(raw).toContain('/Count 1');
    expect(raw).toContain('(FORM NO. 16)');
    expect(raw).toContain('(Aditi Rao)');
    expect(raw).toContain('(Certificate period: Financial Year 2025-26  |  Assessment Year 2026-27)');
    expect(raw).toContain('(23,25,000.00)');
  });
});

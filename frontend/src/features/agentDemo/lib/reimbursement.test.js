import { describe, expect, it } from 'vitest';
import { buildSampleBills, detectIntent, splitByPolicy, totalOf, validateBill, withinPolicy } from './reimbursement';

describe('the policy hint', () => {
  it('puts Travel and Food within the policy', () => {
    expect(['Travel', 'Food', 'Mobile', 'Stay', 'Medical', 'Others'].filter(withinPolicy)).toEqual(['Travel', 'Food']);
  });

  it('splits the bills into within and outside the policy, in order, with their totals', () => {
    const bills = [
      { expenseType: 'Food', amount: 6634 }, { expenseType: 'Stay', amount: 45400 }, { expenseType: 'Travel', amount: 342.5 }, { expenseType: 'Others', amount: 1258 },
    ];
    const [inside, outside] = splitByPolicy(bills);
    expect(inside.map((b) => b.expenseType)).toEqual(['Food', 'Travel']);
    expect(outside.map((b) => b.expenseType)).toEqual(['Stay', 'Others']);
    expect([totalOf(inside), totalOf(outside), totalOf([])]).toEqual([6976.5, 46658, 0]);
  });
});

describe('uploading a bill', () => {
  const file = (name, size = 100) => ({ name, size });

  it('accepts PDFs and photos only', () => {
    expect(validateBill(file('ola.PDF'))).toBe('');
    expect(validateBill(file('lunch.jpeg'))).toBe('');
    expect(validateBill(file('sheet.xlsx'))).toMatch(/PDF or a photo/);
    expect(validateBill(file('letter.docx'))).toMatch(/PDF or a photo/);
  });

  it('refuses an empty or a too large file', () => {
    expect(validateBill(file('a.pdf', 0))).toMatch(/empty/);
    expect(validateBill(file('a.pdf', 11 * 1024 * 1024))).toMatch(/10 MB/);
  });
});

describe('the sample bills', () => {
  it('are three real PDFs: Food and Travel (within the policy) and Stay (outside it)', () => {
    const samples = buildSampleBills(new Date(2026, 9, 29));
    expect(samples.map((s) => [s.file.name, s.reading.expenseType, s.reading.withinPolicy])).toEqual([
      ['spice_route_restaurant_bill.pdf', 'Food', true], ['ola_ride_receipt.pdf', 'Travel', true], ['hotel_sunrise_invoice.pdf', 'Stay', false],
    ]);
    expect(samples.every((s) => s.file.type === 'application/pdf' && s.file.size > 0)).toBe(true);
    expect(samples[0].reading.date).toBe('2026-10-26');
  });
});

describe('detectIntent', () => {
  it('tells a claim from goodbye', () => {
    expect(detectIntent('I want to submit an expense claim')).toBe('claim');
    expect(detectIntent('can you reimburse this receipt?')).toBe('claim');
    expect(detectIntent('thanks, that is all')).toBe('done');
    expect(detectIntent('what is the weather')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { SCENARIOS, detectIntent, monthLabel, recentMonths } from './payroll';

describe('months', () => {
  it('lists the six completed months newest first, across a year end, without the current month', () => {
    expect(recentMonths(new Date(2026, 1, 10))).toEqual(['2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08']);
  });

  it('starts at last month on the 2nd of November', () => {
    expect(recentMonths(new Date(2026, 10, 2))[0]).toBe('2026-10');
  });

  it('writes a month as a label', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('the three requests', () => {
  it('are the payslip, the CTC and Form 16, in this order', () => {
    expect(SCENARIOS.map((s) => s.label)).toEqual(['Payslip', 'CTC', 'Form 16']);
  });
});

describe('detectIntent', () => {
  it('tells the three requests and goodbye apart', () => {
    expect(detectIntent('Payslip')).toBe('payslip');
    expect(detectIntent('Send me my payslip for October')).toBe('payslip');
    expect(detectIntent('What is my take-home?')).toBe('payslip');
    expect(detectIntent('CTC')).toBe('ctc');
    expect(detectIntent('Can you show my salary structure?')).toBe('ctc');
    expect(detectIntent('Form 16')).toBe('form16');
    expect(detectIntent('I need my form-16 for the tax return')).toBe('form16');
    expect(detectIntent('thanks, that is all')).toBe('done');
    expect(detectIntent('what is the weather')).toBeNull();
  });
});

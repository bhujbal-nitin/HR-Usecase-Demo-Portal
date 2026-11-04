import { describe, expect, it } from 'vitest';
import { lastMonth, money, sampleBills, totals } from './sampleBills';
import { billPdf } from './billPdf';

const TODAY = new Date(2026, 10, 4); // 4 November 2026

describe('sample bills', () => {
  it('has nine separate bills with the totals of the earlier test data', () => {
    const bills = sampleBills(TODAY);
    expect(bills).toHaveLength(9);
    expect(new Set(bills.map((bill) => bill.file)).size).toBe(9);
    expect(bills.map((bill) => totals(bill.items, bill.gst).total)).toEqual([397.95, 1312.5, 1567.5, 668.6, 7168, 749.3, 2150, 5297.5, 1713.6]);
  });

  it('dates every bill in the month before the given day', () => {
    expect(lastMonth(TODAY).day(14)).toBe('14/10/2026');
    expect(lastMonth(new Date(2027, 0, 9)).day(22)).toBe('22/12/2026'); // across the new year
    sampleBills(new Date(2027, 0, 9)).forEach((bill) => expect(bill.fields.find(([label]) => label === bill.dateField)[1]).toMatch(/\/12\/2026$/));
  });

  it('formats amounts the Indian way', () => {
    expect(money(7168)).toBe('7,168.00');
    expect(money(125000.5)).toBe('1,25,000.50');
    expect(money(90)).toBe('90.00');
  });

  it('draws every bill with its vendor and total', async () => {
    for (const bill of sampleBills(TODAY)) {
      const text = await billPdf(bill).text();
      expect(text).toContain(bill.vendor);
      expect(text).toContain(`INR ${money(totals(bill.items, bill.gst).total)}`);
    }
  });
});

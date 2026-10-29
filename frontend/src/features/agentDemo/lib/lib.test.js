import { describe, expect, it } from 'vitest';
import { checkPan, makePan, nameSimilarity, normaliseName } from './identity';
import { makeSamplePdf } from './samplePdf';
import { toValidAadhaar, verhoeffCheckDigit, verhoeffValid } from './verhoeff';

describe('verhoeff', () => {
  it('matches the published example (236 -> check digit 3)', () => {
    expect(verhoeffCheckDigit('236')).toBe(3);
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('2364')).toBe(false);
  });

  it('turns any 12 digits into a valid Aadhaar-style number', () => {
    const value = toValidAadhaar('391234584786');
    expect(value).toHaveLength(12);
    expect(value.startsWith('39123458478')).toBe(true);
    expect(verhoeffValid(value)).toBe(true);
  });

  it('detects a single wrong digit and a transposition', () => {
    const value = toValidAadhaar('234567890123');
    const wrong = `${value.slice(0, 5)}${(Number(value[5]) + 1) % 10}${value.slice(6)}`;
    expect(verhoeffValid(wrong)).toBe(false);
    expect(verhoeffValid(`${value.slice(0, 3)}${value[4]}${value[3]}${value.slice(5)}`)).toBe(value[3] === value[4]);
  });
});

describe('identity checks', () => {
  it('ignores case and punctuation when comparing names', () => {
    expect(normaliseName(' Priya  K. Sharma ')).toBe('PRIYA K SHARMA');
    expect(nameSimilarity('Priya Sharma', 'PRIYA SHARMA.')).toBe(1);
  });

  it('scores a different name lower', () => {
    expect(nameSimilarity('Priya Sharma', 'Priya Ramesh Sharma')).toBeLessThan(0.9);
    expect(nameSimilarity('Priya Sharma', 'Rohit Mehta')).toBeLessThan(0.5);
  });

  it('validates PAN structure and surname initial', () => {
    const pan = makePan('Sharma');
    expect(pan).toMatch(/^ABCPS\d{4}[A-Z]$/);
    expect(checkPan(pan, 'Sharma')).toMatchObject({ formatOk: true, holder: 'individual', surnameInitialMatches: true });
    expect(checkPan('ABC123', 'Sharma').formatOk).toBe(false);
    expect(checkPan(pan, 'Mehta').surnameInitialMatches).toBe(false);
  });
});

describe('makeSamplePdf', () => {
  it('produces a structurally valid PDF with correct xref offsets', async () => {
    const text = await makeSamplePdf('Aadhaar (sample)', ['Name: Priya Sharma', 'DOB: 14/08/1997 (fiction)']).text();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + 7)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain('Priya Sharma');
  });

  it('escapes PDF-significant characters', async () => {
    const text = await makeSamplePdf('T', ['a (b) \\ c']).text();
    expect(text).toContain('a \\(b\\) \\\\ c');
  });
});

import { toRows } from './humanize';

describe('humanize', () => {
  it('turns a payload into readable rows without code names', () => {
    const rows = toRows({ employee_id: 'E1', isActive: true, docs: ['PAN', 'Aadhaar'], result: { match_score: 98 } });
    expect(rows).toEqual([
      { label: 'Employee ID', value: 'E1' },
      { label: 'Is active', value: 'Yes' },
      { label: 'Docs', value: 'PAN, Aadhaar' },
      { label: 'Result', children: [{ label: 'Match score', value: '98' }] },
    ]);
  });
});

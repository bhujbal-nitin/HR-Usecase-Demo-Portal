import { describe, expect, it } from 'vitest';
import { plain } from './wording';

describe('plain', () => {
  it('removes request lines and HTTP codes from server messages', () => {
    expect(plain('OrangeHRM PIM profile: POST pim/employees -> HTTP 422: Invalid Parameter (rejected: workEmail)'))
      .toBe('OrangeHRM PIM profile: Invalid Parameter (rejected: workEmail)');
    expect(plain('The server returned an error (HTTP 500).')).not.toMatch(/HTTP|server returned/);
  });

  it('never says backend, API or Graph', () => {
    const out = plain('Microsoft Graph call failed in the backend via the REST API and SMTP');
    expect(out).not.toMatch(/backend|API|Graph|REST|SMTP/i);
  });

  it('leaves business wording and non-strings alone', () => {
    expect(plain('HR Demo Document Verification ended with status Failed')).toBe('HR Demo Document Verification ended with status Failed');
    expect(plain(null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { passwordProblem } from './ChangePasswordDialog';

describe('passwordProblem', () => {
  const ok = { current: 'old-password', next: 'new-password-1', again: 'new-password-1' };
  it('accepts a good change', () => expect(passwordProblem(ok)).toBe(''));
  it('asks for the current password', () => expect(passwordProblem({ ...ok, current: '' })).toMatch(/current password/));
  it('refuses a short new password', () => expect(passwordProblem({ ...ok, next: 'short', again: 'short' })).toMatch(/at least 8/));
  it('refuses the same password', () => expect(passwordProblem({ ...ok, next: 'old-password', again: 'old-password' })).toMatch(/different/));
  it('refuses two different new passwords', () => expect(passwordProblem({ ...ok, again: 'other-password' })).toMatch(/do not match/));
});

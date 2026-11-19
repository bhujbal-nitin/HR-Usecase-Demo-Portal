import { describe, expect, it } from 'vitest';
import {
  attendanceRow, balanceRow, buildQuery, claimRow, currentPeriod, diffHours, employeeRow, errorText,
  fmtDate, fmtDuration, fmtRange, fullName, humanizeKey, leaveRequestRow, statusTone, todayISO,
} from './helpers';

describe('dates and durations', () => {
  it('formats a date without shifting the day', () => {
    expect(fmtDate('2026-03-05')).toBe('05 Mar 2026');
    expect(fmtDate('')).toBe('-');
    expect(fmtDate('soon')).toBe('soon');
  });
  it('builds today as YYYY-MM-DD', () => expect(todayISO(new Date(2026, 0, 9))).toBe('2026-01-09'));
  it('formats a range', () => {
    expect(fmtRange('2026-03-05', '2026-03-05')).toBe('05 Mar 2026');
    expect(fmtRange('2026-03-05', '2026-03-07')).toBe('05 Mar 2026 to 07 Mar 2026');
  });
  it('measures hours between punches', () => {
    expect(diffHours('2026-03-05', '09:00', '2026-03-05', '17:30')).toBe(8.5);
    expect(diffHours('2026-03-05', '22:00', '2026-03-06', '06:00')).toBe(8);
    expect(diffHours('2026-03-05', '10:00', '2026-03-05', '09:00')).toBe(0);
    expect(diffHours('2026-03-05', '10:00', null, null)).toBe(0);
  });
  it('shows hours and minutes', () => {
    expect(fmtDuration(7.5)).toBe('7h 30m');
    expect(fmtDuration(0)).toBe('0h 00m');
  });
});

describe('error text', () => {
  it('explains rejected fields in plain words', () => {
    const payload = { error: { message: 'Invalid Parameter', data: { invalidParamKeys: ['employeeId'] } } };
    expect(errorText(payload, 422)).toBe('Please check these fields: Employee Id.');
  });
  it('keeps a specific server message', () => {
    expect(errorText({ error: { message: 'Failed to Submit: Leave Balance Exceeded' } }, 422)).toMatch(/Balance Exceeded/);
  });
  it('covers sessions, missing records, server and network failures', () => {
    expect(errorText(null, 401)).toMatch(/sign in again/);
    expect(errorText({ error: {} }, 404)).toMatch(/could not find/);
    expect(errorText(null, 500)).toMatch(/problem/);
    expect(errorText(null, 0)).toMatch(/Could not reach/);
  });
  it('humanizes keys', () => expect(humanizeKey('workEmail')).toBe('Work Email'));
});

describe('query strings', () => {
  it('skips empty values and repeats list keys', () => {
    expect(buildQuery({ a: 'x', b: '', c: undefined, s: ['1', '2'] })).toBe('?a=x&s%5B%5D=1&s%5B%5D=2');
    expect(buildQuery({})).toBe('');
  });
});

describe('row mapping', () => {
  it('maps a leave request', () => {
    const row = leaveRequestRow({
      id: 4, leaveType: { name: 'Casual Leave' }, firstName: 'Asha', lastName: 'Rao',
      dates: { fromDate: '2026-03-05', toDate: '2026-03-06' }, noOfDays: 2, leaveBreakdown: '1.00 Scheduled, 1.00 Taken', comment: 'Trip',
    });
    expect(row).toMatchObject({ id: 4, employee: 'Asha Rao', type: 'Casual Leave', days: '2.00', status: 'Scheduled, Taken', comment: 'Trip' });
    expect(row.statusLabel).toBe('Scheduled (1.00), Taken (1.00)');
  });
  it('maps a balance, treating no entitlement as zero', () => {
    expect(balanceRow({ leaveType: { name: 'Sick' }, usageBreakdown: { entitled: 12, used: 2, scheduled: 1, pending: 0.5, balance: 8.5 } }))
      .toMatchObject({ type: 'Sick', entitled: '12.00', used: '3.00', pending: '0.50', balance: '8.50', hasEntitlement: true });
    expect(balanceRow({ leaveType: { name: 'Sick' }, usageBreakdown: null })).toMatchObject({ balance: '0.00', hasEntitlement: false });
  });
  it('maps an attendance record', () => {
    const done = attendanceRow({ id: 1, punchIn: { userDate: '2026-03-05', userTime: '09:00' }, punchOut: { userDate: '2026-03-05', userTime: '17:00' } });
    expect(done).toMatchObject({ duration: '8h 00m', open: false, hours: 8 });
    expect(attendanceRow({ id: 2, punchIn: { userDate: '2026-03-05', userTime: '09:00' } })).toMatchObject({ open: true, punchOut: '-' });
  });
  it('maps claims whatever shape the nested parts have', () => {
    expect(claimRow({ id: 3, referenceId: '202600003', employee: { firstName: 'A', lastName: 'B' }, claimEvent: { name: 'Travel' }, status: 'Submitted', currencyId: 'INR' }))
      .toMatchObject({ reference: '202600003', employee: 'A B', event: 'Travel', status: 'Submitted' });
    expect(claimRow({ id: 5, status: { name: 'Paid' } }).status).toBe('Paid');
  });
  it('maps an employee and flags past employees', () => {
    const row = employeeRow({ empNumber: 7, employeeId: '0007', firstName: 'Ravi', middleName: 'K', lastName: 'S', terminationId: 2, supervisors: [{ firstName: 'Lead', lastName: 'One' }] });
    expect(row).toMatchObject({ firstMiddle: 'Ravi K', past: true, supervisor: 'Lead One', jobTitle: '-' });
    expect(fullName({ firstName: 'A', lastName: 'B' })).toBe('A B');
  });
});

describe('status and periods', () => {
  it('picks a tone', () => {
    expect(statusTone('Approved')).toBe('green');
    expect(statusTone('Pending Approval')).toBe('orange');
    expect(statusTone('Rejected')).toBe('red');
    expect(statusTone('')).toBe('grey');
  });
  it('finds the period containing today', () => {
    const periods = [{ startDate: '2025-01-01', endDate: '2025-12-31' }, { startDate: '2026-01-01', endDate: '2026-12-31' }];
    expect(currentPeriod(periods, '2026-06-01').startDate).toBe('2026-01-01');
    expect(currentPeriod(periods, '2030-06-01').startDate).toBe('2025-01-01');
    expect(currentPeriod([], '2026-06-01')).toBeNull();
  });
});

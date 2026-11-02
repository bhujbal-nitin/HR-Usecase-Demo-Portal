import { describe, expect, it } from 'vitest';
import { attendanceDateRange, detectIntent, sampleLeaveDates, upcomingHolidays, validateAttendance, validateLeave, workingDays } from './leave';

describe('detectIntent', () => {
  it('tells the three requests and goodbye apart', () => {
    expect(detectIntent('How many leaves do I have left?')).toBe('balance');
    expect(detectIntent('Is there a holiday next week')).toBe('balance');
    expect(detectIntent('I want to apply for 2 days casual leave')).toBe('apply');
    expect(detectIntent('I forgot to punch out yesterday')).toBe('attendance');
    expect(detectIntent('Attendance request')).toBe('attendance');
    expect(detectIntent('Regularize my attendance')).toBe('attendance');
    expect(detectIntent('thanks, that is all')).toBe('done');
    expect(detectIntent('what is the weather')).toBeNull();
  });
});

describe('working days', () => {
  it('skips weekends and company holidays', () => {
    expect(workingDays('2026-11-02', '2026-11-08')).toBe(5); // Monday to Sunday
    expect(workingDays('2026-12-24', '2026-12-28')).toBe(2); // 25 Dec is a holiday, 26-27 a weekend
  });

  it('finds a sample request that is two clean working days in the future', () => {
    const { startDate, endDate } = sampleLeaveDates(7, new Date(2026, 11, 20)); // would run into Christmas and New Year
    expect(startDate > '2026-12-26').toBe(true);
    expect(workingDays(startDate, endDate)).toBe(2);
  });

  it('lists the next holidays in date order', () => {
    const list = upcomingHolidays(3, new Date(2026, 9, 27));
    expect(list.map((h) => h.date)).toEqual(['2026-12-25', '2027-01-01', '2027-01-26']);
  });
});

describe('forms', () => {
  it('validates a leave request', () => {
    expect(validateLeave({ leaveType: 'Casual Leave', startDate: '2999-01-02', endDate: '2999-01-03', reason: 'Family function' })).toEqual({});
    const errors = validateLeave({ leaveType: '', startDate: '2000-01-01', endDate: '1999-01-01', reason: ' ' });
    expect(Object.keys(errors).sort()).toEqual(['endDate', 'leaveType', 'reason', 'startDate']);
  });

  it('works out the days an attendance request can be for', () => {
    expect(attendanceDateRange(new Date(2026, 9, 29))).toEqual({ min: '2026-09-29', max: '2026-10-28' });
    expect(attendanceDateRange(new Date(2026, 0, 5))).toEqual({ min: '2025-12-06', max: '2026-01-04' });
  });

  it('validates an attendance request: day, both times and the reason', () => {
    const { max } = attendanceDateRange();
    const good = { attendanceDate: max, inPunch: '09:10', outPunch: '18:30', reason: 'Scanner offline' };
    expect(validateAttendance(good)).toEqual({});
    expect(Object.keys(validateAttendance({ attendanceDate: '', inPunch: '9am', outPunch: '6:30pm', reason: '' })).sort()).toEqual(['attendanceDate', 'inPunch', 'outPunch', 'reason']);
    expect(validateAttendance({ ...good, outPunch: '08:00' }).outPunch).toMatch(/after the time you came in/);
    expect(validateAttendance({ ...good, attendanceDate: '2999-01-01' }).attendanceDate).toMatch(/already passed/);
    expect(validateAttendance({ ...good, attendanceDate: '2000-01-01' }).attendanceDate).toMatch(/last 30 days/);
  });
});

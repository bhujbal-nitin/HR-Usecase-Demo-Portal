// A stand-in for the leave & attendance service calls, used by Auto-play · Simulated. The journey code is exactly the same as in
// the live flow (see leaveJourney.jsx); only the calls behind it are replaced by this timed, in-memory play-through, so the
// flows cannot drift apart. Nothing here contacts any system (the live flow works in OrangeHRM).

import {
  IN_PUNCH, LEAVE_POLICY, SHIFT_END, fromIso, holidayOn, hoursWorked, isAfter, previousWorkingDays, toIso, upcomingHolidays, workingDays,
} from '../lib/leave';
import { todayIso } from '../lib/resignation';
import { SIM_EMPLOYEE } from './simulatedOffboardingApi';
import { LEAVE_WORKFLOWS } from './phases/leaveWorkflow';

/** @param scale  how much slower than the nominal timings to play (the demo's step scale) */
export function createSimulatedLeaveApi(scale = 1) {
  const requests = [];
  let counter = 204817;
  let workflowRun = 5120;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms * scale));
  const leaveRequests = () => requests.filter((r) => r.kind === 'leave');
  const holds = (r) => r.status === 'Pending Approval' || (r.status === 'Approved' && !r.applied);

  const balances = () => Object.entries(LEAVE_POLICY).map(([leaveType, [total, taken]]) => {
    const own = leaveRequests().filter((r) => r.leaveType === leaveType);
    const booked = own.filter((r) => r.applied).reduce((sum, r) => sum + r.days, 0);
    const held = own.filter((r) => holds(r)).reduce((sum, r) => sum + r.days, 0);
    return { leaveType, total, used: taken + booked, pending: held, left: total - taken - booked - held };
  });

  const skipped = (start, end) => {
    const list = [];
    for (const day = fromIso(start); day <= fromIso(end); day.setDate(day.getDate() + 1)) {
      const name = holidayOn(day);
      if (name && day.getDay() >= 1 && day.getDay() <= 5) list.push({ date: toIso(day), name });
    }
    return list;
  };

  const check = ({ leaveType, startDate, endDate }) => {
    const days = workingDays(startDate, endDate);
    const left = balances().find((b) => b.leaveType === leaveType).left;
    const problems = [];
    if (startDate < todayIso()) problems.push('The leave cannot start in the past.');
    if (days === 0) problems.push('These dates are all weekends or holidays, so no leave is needed.');
    if (days > left) problems.push(`Only ${left} day(s) of ${leaveType} are left, but ${days} were asked for.`);
    leaveRequests().filter((r) => holds(r) && r.startDate <= endDate && startDate <= r.endDate)
      .forEach((r) => problems.push(`You already have leave from ${r.startDate} to ${r.endDate} (${r.id}).`));
    return { leaveType, startDate, endDate, days, balanceBefore: left, balanceAfter: left - days, holidaysSkipped: skipped(startDate, endDate), problems, ok: problems.length === 0 };
  };

  // One day with a missing out-punch, the most recent working day, until it is corrected.
  const punchDay = previousWorkingDays(1)[0];
  const attendance = () => {
    const fix = requests.find((r) => r.kind === 'regularization' && r.status !== 'Rejected');
    const day = fix?.applied
      ? { date: punchDay, inPunch: IN_PUNCH, outPunch: fix.outPunch, state: 'ok' }
      : { date: punchDay, inPunch: IN_PUNCH, outPunch: null, state: fix ? 'pending' : 'missing' };
    return { days: [day], missing: day.state === 'missing' ? [day] : [] };
  };

  const base = (kind, prefix, reason) => ({
    id: `${prefix}-${counter++}`, kind, employeeId: SIM_EMPLOYEE.employeeId, fullName: SIM_EMPLOYEE.fullName, workEmail: SIM_EMPLOYEE.workEmail,
    department: SIM_EMPLOYEE.department, jobTitle: SIM_EMPLOYEE.jobTitle, manager: SIM_EMPLOYEE.manager, reason, status: 'Pending Approval',
    submittedAt: new Date().toISOString(), decidedAt: null, applied: false, appliedAt: null, orangeHrmId: null, orangeHrmUrl: null,
  });

  return {
    simulated: true,
    getLeaveOptions: async () => { await pause(600); return { leaveTypes: Object.keys(LEAVE_POLICY), shiftEnd: SHIFT_END }; },
    /** A showcase AutomationEdge workflow run that simply completes after a short wait. */
    runLeaveWorkflow: async (key) => {
      await pause(1400);
      return { workflowName: LEAVE_WORKFLOWS[key].name, status: 'Complete', ok: true, automationRequestId: workflowRun++, agent: 'Simulated agent', message: 'Workflow completed' };
    },
    lookupEmployee: async () => { await pause(500); return { ...SIM_EMPLOYEE }; },
    getBalances: async () => { await pause(700); return balances(); },
    getHolidays: async () => { await pause(600); return upcomingHolidays(); },
    checkLeave: async (request) => { await pause(900); return check(request); },
    getAttendance: async () => { await pause(800); return attendance(); },
    prepareDemoPunch: async () => ({ created: false, day: null, message: 'The simulated punch log already has a missing out-punch.' }),
    submitLeave: async (application) => {
      await pause(900);
      const result = check(application);
      if (!result.ok) throw new Error(result.problems.join(' '));
      const record = { ...base('leave', 'LV', application.reason), leaveType: application.leaveType, startDate: application.startDate, endDate: application.endDate, days: result.days, balanceAfter: result.balanceAfter };
      requests.unshift(record);
      return { ...record };
    },
    submitRegularization: async ({ attendanceDate, outPunch, reason }) => {
      await pause(900);
      if (!attendance().missing.some((d) => d.date === attendanceDate)) throw new Error('There is no missing out-punch on that date.');
      if (!isAfter(outPunch, IN_PUNCH)) throw new Error(`The out-punch must be after the in-punch (${IN_PUNCH}).`);
      const record = { ...base('regularization', 'AT', reason), attendanceDate, inPunch: IN_PUNCH, outPunch, hoursWorked: hoursWorked(IN_PUNCH, outPunch) };
      requests.unshift(record);
      return { ...record };
    },
    getLeaveRequest: async (id) => ({ ...requests.find((r) => r.id === id) }),
    approveLeaveRequest: async (id) => {
      const record = requests.find((r) => r.id === id);
      record.status = 'Approved';
      record.decidedAt = new Date().toISOString();
      return { ...record };
    },
    /** "Record it in OrangeHRM": the simulated system just remembers it. */
    applyLeaveRequest: async (id) => {
      await pause(1000);
      const record = requests.find((r) => r.id === id);
      Object.assign(record, { applied: true, appliedAt: new Date().toISOString(), orangeHrmId: record.kind === 'leave' ? 4021 : null });
      return { ...record };
    },
  };
}

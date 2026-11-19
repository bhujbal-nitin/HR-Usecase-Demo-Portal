import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// No network: every api call resolves to an empty list. Pages render their first (loading) state on the server.
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal();
  const empty = () => Promise.resolve({ data: [], meta: { total: 0 } });
  const stubs = Object.fromEntries(
    Object.entries(actual).filter(([, v]) => typeof v === 'function' && v !== actual.HrmsError).map(([k]) => [k, empty]),
  );
  return { ...actual, ...stubs };
});

const { default: HrmsLogin } = await import('./layout/HrmsLogin');
const { default: HrmsShell } = await import('./layout/HrmsShell');
const { default: DashboardPage } = await import('./dashboard/DashboardPage');
const { default: EmployeeListPage } = await import('./pim/EmployeeListPage');
const { default: AddEmployeePage } = await import('./pim/AddEmployeePage');
const { default: EmployeeProfilePage } = await import('./pim/EmployeeProfilePage');
const { default: BalanceReportPage } = await import('./leave/BalanceReportPage');
const { default: LeaveListPage } = await import('./leave/LeaveListPage');
const { default: LeaveRequestPage } = await import('./leave/LeaveRequestPage');
const { default: AssignLeavePage } = await import('./leave/AssignLeavePage');
const { EntitlementsPage, AddEntitlementPage } = await import('./leave/EntitlementsPage');
const { default: HolidayListPage } = await import('./leave/HolidayListPage');
const { default: LeaveTypesPage } = await import('./leave/LeaveTypesPage');
const { default: AttendanceRecordPage } = await import('./time/AttendanceRecordPage');
const { default: AttendanceSummaryPage } = await import('./time/AttendanceSummaryPage');
const { default: AssignClaimPage } = await import('./claim/AssignClaimPage');
const { default: ClaimDetailPage } = await import('./claim/ClaimDetailPage');
const { default: ClaimListPage } = await import('./claim/ClaimListPage');
const { EventsPage, ExpenseTypesPage } = await import('./claim/ConfigPages');
const { assignBody } = await import('./leave/AssignLeavePage');
const { actionsFor, expenseTotal } = await import('./claim/ClaimDetailPage');
const { filterByStatus } = await import('./leave/LeaveListPage');
const { punchBody } = await import('./time/AttendanceRecordPage');
const { summaryHours } = await import('./time/AttendanceSummaryPage');

const render = (path, pattern, Page, props) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] },
      createElement(Routes, null, createElement(Route, { path: pattern, element: createElement(Page, props) }))),
  );

describe('sign-in page', () => {
  it('shows the demo login hint and labelled fields', () => {
    const html = renderToStaticMarkup(createElement(HrmsLogin, { onSignedIn() {} }));
    expect(html).toContain('Admin');
    expect(html).toContain('admin123');
    expect(html).toContain('for="hrms-username"');
    expect(html).toContain('for="hrms-password"');
  });
});

describe('app shell', () => {
  it('shows the menu and a logout button', () => {
    const html = render('/simulated/hrms/leave/viewLeaveList', '/simulated/hrms/*', HrmsShell);
    for (const label of ['Dashboard', 'PIM', 'Leave', 'Time', 'Claim', 'Logout']) expect(html).toContain(label);
    expect(html).toContain('Assign Leave');
  });
});

describe('pages render without crashing', () => {
  const cases = [
    ['dashboard', DashboardPage, 'Quick Launch'],
    ['employee list', EmployeeListPage, 'Employee Information'],
    ['add employee', AddEmployeePage, 'Add Employee'],
    ['balance report', BalanceReportPage, 'Loading'],
    ['leave list', LeaveListPage, 'Leave List'],
    ['assign leave', AssignLeavePage, 'Assign Leave'],
    ['entitlements', EntitlementsPage, 'Leave Entitlements'],
    ['add entitlement', AddEntitlementPage, 'Loading'],
    ['holidays', HolidayListPage, 'Holidays'],
    ['leave types', LeaveTypesPage, 'Leave Types'],
    ['attendance records', AttendanceRecordPage, 'Employee Attendance Records'],
    ['attendance summary', AttendanceSummaryPage, 'Attendance Summary'],
    ['assign claim', AssignClaimPage, 'Create Claim Request'],
    ['claims', ClaimListPage, 'Employee Claims'],
    ['events', EventsPage, 'Events'],
    ['expense types', ExpenseTypesPage, 'Expense Types'],
  ];
  it.each(cases)('%s', (_name, Page, text) => {
    expect(render('/x', '/x', Page)).toContain(text);
  });

  it('employee profile', () => {
    expect(render('/p/empNumber/7', '/p/empNumber/:empNumber', EmployeeProfilePage)).toContain('Loading');
  });
  it('leave request', () => {
    expect(render('/r/12', '/r/:id', LeaveRequestPage)).toContain('Leave Request #12');
  });
  it('claim detail', () => {
    expect(render('/c/5', '/c/:id', ClaimDetailPage)).toContain('Claim 5');
  });
});

describe('page logic', () => {
  it('builds the assign-leave body for a single day', () => {
    expect(assignBody({ employee: { empNumber: 3 }, typeId: '2', from: '2026-03-05', to: '', comment: 'x' }))
      .toEqual({ empNumber: 3, leaveTypeId: 2, fromDate: '2026-03-05', toDate: '2026-03-05', comment: 'x', duration: { type: 'full_day' } });
  });
  it('filters leave rows by status text', () => {
    const rows = [{ status: 'Scheduled' }, { status: 'Taken' }];
    expect(filterByStatus(rows, [])).toHaveLength(2);
    expect(filterByStatus(rows, ['Taken'])).toEqual([{ status: 'Taken' }]);
  });
  it('offers the right claim actions', () => {
    expect(actionsFor('Initiated').map((a) => a.action)).toEqual(['SUBMIT', 'CANCEL']);
    expect(actionsFor('Paid')).toEqual([]);
    expect(expenseTotal([{ amount: '10.50' }, { amount: 4 }])).toBe(14.5);
  });
  it('builds punch bodies and reads summary hours', () => {
    expect(punchBody({ date: '2026-03-05', time: '09:00', note: 'n' })).toMatchObject({ date: '2026-03-05', time: '09:00', note: 'n' });
    expect(summaryHours({ total: '7.5' })).toBe(7.5);
    expect(summaryHours({})).toBe(0);
  });
});

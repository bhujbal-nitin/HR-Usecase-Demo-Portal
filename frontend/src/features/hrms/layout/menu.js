export const HRMS_BASE = '/simulated/hrms';

export const hrmsPath = (page) => `${HRMS_BASE}/${page}`;

// Left menu: modules and the tabs shown in the bar under the header, like HRMS.
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge', home: 'dashboard/index', tabs: [] },
  {
    key: 'pim', label: 'PIM', icon: 'fa-users', home: 'pim/viewEmployeeList',
    tabs: [
      { label: 'Employee List', page: 'pim/viewEmployeeList' },
      { label: 'Add Employee', page: 'pim/addEmployee' },
    ],
  },
  {
    key: 'leave', label: 'Leave', icon: 'fa-calendar-days', home: 'leave/viewLeaveList',
    tabs: [
      { label: 'Leave List', page: 'leave/viewLeaveList' },
      { label: 'Assign Leave', page: 'leave/assignLeave' },
      { label: 'Entitlements', page: 'leave/viewLeaveEntitlements' },
      { label: 'Balance Report', page: 'leave/viewLeaveBalanceReport' },
      { label: 'Leave Types', page: 'leave/viewLeaveTypeList' },
      { label: 'Holidays', page: 'leave/viewHolidayList' },
    ],
  },
  {
    key: 'attendance', label: 'Time', icon: 'fa-clock', home: 'attendance/viewAttendanceRecord',
    tabs: [
      { label: 'Employee Records', page: 'attendance/viewAttendanceRecord' },
      { label: 'Attendance Summary', page: 'attendance/viewEmployeeAttendanceRecord' },
    ],
  },
  {
    key: 'claim', label: 'Claim', icon: 'fa-receipt', home: 'claim/viewClaim',
    tabs: [
      { label: 'Employee Claims', page: 'claim/viewClaim' },
      { label: 'Assign Claim', page: 'claim/viewAssignClaim' },
      { label: 'Events', page: 'claim/viewEvents' },
      { label: 'Expense Types', page: 'claim/viewExpenseTypes' },
    ],
  },
];

/** Which module a path like "/simulated/hrms/leave/viewLeaveList" belongs to. */
export function moduleForPath(pathname) {
  const rest = pathname.startsWith(HRMS_BASE) ? pathname.slice(HRMS_BASE.length + 1) : pathname;
  const first = rest.split('/')[0];
  return MODULES.find((m) => m.key === first) ?? MODULES[0];
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { SESSION_ENDED, getSession, signOut } from './api';
import HrmsLogin from './layout/HrmsLogin';
import HrmsShell from './layout/HrmsShell';
import { HrmsSession } from './layout/session';
import { Loading } from './components/ui';
import DashboardPage from './dashboard/DashboardPage';
import EmployeeListPage from './pim/EmployeeListPage';
import AddEmployeePage from './pim/AddEmployeePage';
import EmployeeProfilePage from './pim/EmployeeProfilePage';
import BalanceReportPage from './leave/BalanceReportPage';
import LeaveListPage from './leave/LeaveListPage';
import LeaveRequestPage from './leave/LeaveRequestPage';
import AssignLeavePage from './leave/AssignLeavePage';
import { AddEntitlementPage, EntitlementsPage } from './leave/EntitlementsPage';
import HolidayListPage from './leave/HolidayListPage';
import LeaveTypesPage from './leave/LeaveTypesPage';
import AttendanceRecordPage from './time/AttendanceRecordPage';
import AttendanceSummaryPage from './time/AttendanceSummaryPage';
import AssignClaimPage from './claim/AssignClaimPage';
import ClaimDetailPage from './claim/ClaimDetailPage';
import ClaimListPage from './claim/ClaimListPage';
import { EventsPage, ExpenseTypesPage } from './claim/ConfigPages';
import { HRMS_BASE } from './layout/menu';

/** `/simulated/hrms/web/index.php/<page>` (the older link form) -> `/simulated/hrms/<page>`. */
function LegacyRedirect() {
  const rest = useParams()['*'] ?? '';
  const { search } = useLocation();
  return <Navigate to={`${HRMS_BASE}/${rest}${search}`} replace />;
}

/** The pages themselves, shown once signed in. */
export function HrmsRoutes() {
  return (
    <Routes>
      <Route path="web/index.php/*" element={<LegacyRedirect />} />
      <Route path="auth/login" element={<Navigate to={`${HRMS_BASE}/dashboard/index`} replace />} />
      <Route element={<HrmsShell />}>
        <Route index element={<Navigate to={`${HRMS_BASE}/dashboard/index`} replace />} />
        <Route path="dashboard/index" element={<DashboardPage />} />
        <Route path="pim/viewEmployeeList" element={<EmployeeListPage />} />
        <Route path="pim/addEmployee" element={<AddEmployeePage />} />
        <Route path="pim/viewPersonalDetails/empNumber/:empNumber" element={<EmployeeProfilePage />} />
        <Route path="leave/viewLeaveBalanceReport" element={<BalanceReportPage />} />
        <Route path="leave/viewLeaveList" element={<LeaveListPage />} />
        <Route path="leave/viewLeaveRequest/:id" element={<LeaveRequestPage />} />
        <Route path="leave/assignLeave" element={<AssignLeavePage />} />
        <Route path="leave/viewLeaveEntitlements" element={<EntitlementsPage />} />
        <Route path="leave/addLeaveEntitlement" element={<AddEntitlementPage />} />
        <Route path="leave/viewHolidayList" element={<HolidayListPage />} />
        <Route path="leave/defineHoliday" element={<HolidayListPage adding />} />
        <Route path="leave/viewLeaveTypeList" element={<LeaveTypesPage />} />
        <Route path="leave/defineLeaveType" element={<LeaveTypesPage adding />} />
        <Route path="attendance/viewAttendanceRecord" element={<AttendanceRecordPage />} />
        <Route path="attendance/viewEmployeeAttendanceRecord" element={<AttendanceSummaryPage />} />
        <Route path="claim/viewAssignClaim" element={<AssignClaimPage />} />
        <Route path="claim/assignClaim/id/:id" element={<ClaimDetailPage />} />
        <Route path="claim/viewClaim" element={<ClaimListPage />} />
        <Route path="claim/viewEvents" element={<EventsPage />} />
        <Route path="claim/viewExpenseTypes" element={<ExpenseTypesPage />} />
        <Route path="*" element={<Navigate to={`${HRMS_BASE}/dashboard/index`} replace />} />
      </Route>
    </Routes>
  );
}

/** Own sign-in and session guard for the replica; the portal's own login is separate. */
export default function HrmsApp() {
  const [state, setState] = useState({ status: 'checking', user: null });

  useEffect(() => {
    let cancelled = false;
    getSession().then(
      (res) => { if (!cancelled) setState({ status: 'in', user: res.data ?? {} }); },
      () => { if (!cancelled) setState({ status: 'out', user: null }); },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const ended = () => setState({ status: 'out', user: null });
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, []);

  const logout = useCallback(async () => {
    try { await signOut(); } catch { /* the cookie may already be gone */ }
    setState({ status: 'out', user: null });
  }, []);

  const value = useMemo(() => ({ user: state.user, logout }), [state.user, logout]);

  if (state.status === 'checking') return <div className="hrms-root"><Loading label="Opening HRMS..." /></div>;
  if (state.status === 'out') {
    return <div className="hrms-root"><HrmsLogin onSignedIn={(user) => setState({ status: 'in', user })} /></div>;
  }
  return (
    <div className="hrms-root">
      <HrmsSession.Provider value={value}><HrmsRoutes /></HrmsSession.Provider>
    </div>
  );
}

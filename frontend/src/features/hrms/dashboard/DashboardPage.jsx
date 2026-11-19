import { Link } from 'react-router-dom';
import { listClaims, listEmployees, listLeaveRequests } from '../api';
import { PageCard } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

const TILES = [
  { label: 'Assign Leave', icon: 'fa-calendar-plus', page: 'leave/assignLeave' },
  { label: 'Leave List', icon: 'fa-list-check', page: 'leave/viewLeaveList' },
  { label: 'Employee List', icon: 'fa-users', page: 'pim/viewEmployeeList' },
  { label: 'Add Employee', icon: 'fa-user-plus', page: 'pim/addEmployee' },
  { label: 'Attendance Records', icon: 'fa-clock', page: 'attendance/viewAttendanceRecord' },
  { label: 'Assign Claim', icon: 'fa-receipt', page: 'claim/viewAssignClaim' },
];

// Each count is fetched on its own so one slow or failing call does not hide the others.
const settle = (call) => call().then((res) => res?.meta?.total ?? (res?.data ?? []).length, () => null);

export async function loadCounts() {
  const [employees, past, leave, claims] = await Promise.all([
    settle(() => listEmployees({ limit: 1 })),
    settle(() => listEmployees({ limit: 1, includeEmployees: 'onlyPast' })),
    settle(() => listLeaveRequests({ limit: 1 })),
    settle(() => listClaims({ limit: 1 })),
  ]);
  return { employees, past, leave, claims };
}

function Count({ label, value, icon }) {
  return (
    <div className="hrms-count">
      <i className={`fa-solid ${icon}`} aria-hidden="true"></i>
      <div><strong>{value ?? '-'}</strong><span>{label}</span></div>
    </div>
  );
}

export default function DashboardPage() {
  const counts = useAsync(loadCounts, []);
  const c = counts.data ?? {};
  return (
    <div className="hrms-grid-2">
      <PageCard title="Quick Launch">
        <div className="hrms-tiles">
          {TILES.map((t) => (
            <Link key={t.page} to={hrmsPath(t.page)} className="hrms-tile">
              <i className={`fa-solid ${t.icon}`} aria-hidden="true"></i>
              <span>{t.label}</span>
            </Link>
          ))}
        </div>
      </PageCard>
      <PageCard title="At a Glance">
        <div className="hrms-counts" aria-busy={counts.loading}>
          <Count label="Current employees" value={c.employees} icon="fa-users" />
          <Count label="Past employees" value={c.past} icon="fa-user-slash" />
          <Count label="Leave requests" value={c.leave} icon="fa-calendar-days" />
          <Count label="Claims" value={c.claims} icon="fa-receipt" />
        </div>
      </PageCard>
    </div>
  );
}

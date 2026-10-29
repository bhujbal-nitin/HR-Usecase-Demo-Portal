import { useSearchParams } from 'react-router-dom';
import ApprovalsView from './ApprovalsView';
import LeaveApprovals from './LeaveApprovals';
import OffboardingApprovals from './OffboardingApprovals';

const TABS = [
  { id: 'onboarding', label: 'Onboarding', icon: 'fa-user-plus' },
  { id: 'offboarding', label: 'Offboarding', icon: 'fa-door-open' },
  { id: 'leave', label: 'Leave & Attendance', icon: 'fa-umbrella-beach' },
];

/** HR Approvals: one place for HR decisions. Candidates to onboard, employees who have resigned, and leave & attendance requests. */
export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some(({ id }) => id === requested) ? requested : 'onboarding';

  return (
    <section className="view-section active">
      <div className="filter-group" role="tablist" aria-label="Approval type" style={{ marginBottom: '1rem' }}>
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id} type="button" role="tab" aria-selected={tab === id}
            className={`btn ${tab === id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setParams(id === 'onboarding' ? {} : { tab: id }, { replace: true })}
          >
            <i className={`fa-solid ${icon}`}></i> {label}
          </button>
        ))}
      </div>
      {tab === 'leave' ? <LeaveApprovals /> : tab === 'offboarding' ? <OffboardingApprovals /> : <ApprovalsView embedded />}
    </section>
  );
}

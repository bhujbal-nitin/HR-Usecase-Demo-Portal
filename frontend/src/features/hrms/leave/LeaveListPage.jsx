import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listLeavePeriods, listLeaveRequests } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { currentPeriod, leaveRequestRow } from '../components/helpers';
import { AsyncBody, Button, DataTable, PageCard, rowsOf, StatusPill, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

export const STATUSES = ['Pending Approval', 'Scheduled', 'Taken', 'Rejected', 'Cancelled'];

/** Keeps the rows whose status text mentions one of the chosen statuses (none chosen = all). */
export function filterByStatus(rows, chosen) {
  if (!chosen.length) return rows;
  return rows.filter((r) => chosen.some((s) => r.status.toLowerCase().includes(s.toLowerCase())));
}

async function load({ from, to, employee }) {
  let fromDate = from;
  let toDate = to;
  if (!fromDate && !toDate) {
    const period = currentPeriod(rowsOf(await listLeavePeriods().catch(() => ({}))));
    fromDate = period?.startDate;
    toDate = period?.endDate;
  }
  return listLeaveRequests({ fromDate, toDate, empNumber: employee?.empNumber });
}

export default function LeaveListPage() {
  const [draft, setDraft] = useState({ from: '', to: '', employee: null, statuses: ['Pending Approval', 'Scheduled'] });
  const [applied, setApplied] = useState(draft);
  const state = useAsync(() => load(applied), [applied]);
  const toggle = (s) => setDraft({ ...draft, statuses: draft.statuses.includes(s) ? draft.statuses.filter((x) => x !== s) : [...draft.statuses, s] });

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'employee', label: 'Employee Name' },
    { key: 'type', label: 'Leave Type' },
    { key: 'days', label: 'Number of Days' },
    { key: 'statusLabel', label: 'Status', render: (r) => <StatusPill status={r.statusLabel} /> },
    { key: 'comment', label: 'Comments' },
    { key: 'open', label: '', render: (r) => <Link className="hrms-link" to={hrmsPath(`leave/viewLeaveRequest/${r.id}`)}>View Details</Link> },
  ];

  return (
    <>
      <PageCard title="Leave List">
        <form className="hrms-filters" onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
          <TextField label="From Date" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="To Date" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <EmployeePicker includePast value={draft.employee} onChange={(employee) => setDraft({ ...draft, employee })} />
          <fieldset className="hrms-checks">
            <legend>Show Leave with Status</legend>
            {STATUSES.map((s) => (
              <label key={s}><input type="checkbox" checked={draft.statuses.includes(s)} onChange={() => toggle(s)} /> {s}</label>
            ))}
          </fieldset>
          <div className="hrms-filter-actions"><Button type="submit">Search</Button></div>
        </form>
      </PageCard>
      <PageCard title="Leave Requests">
        <AsyncBody state={state}>
          {(res) => {
            const rows = filterByStatus(rowsOf(res).map(leaveRequestRow), applied.statuses);
            return (
              <>
                <p className="hrms-muted">{rows.length} record{rows.length === 1 ? '' : 's'} found</p>
                <DataTable columns={columns} rows={rows} empty="No leave requests match your search." />
              </>
            );
          }}
        </AsyncBody>
      </PageCard>
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listClaims } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { claimRow, fmtNumber } from '../components/helpers';
import { AsyncBody, Button, DataTable, PageCard, rowsOf, SelectField, StatusPill, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

const STATUS_OPTIONS = ['Initiated', 'Submitted', 'Approved', 'Rejected', 'Paid', 'Cancelled'].map((s) => ({ value: s, label: s }));

export default function ClaimListPage() {
  const [draft, setDraft] = useState({ referenceId: '', employee: null, status: '' });
  const [applied, setApplied] = useState(draft);
  const state = useAsync(
    () => listClaims({ referenceId: applied.referenceId.trim(), empNumber: applied.employee?.empNumber, status: applied.status }),
    [applied],
  );

  const columns = [
    { key: 'reference', label: 'Reference Id' },
    { key: 'employee', label: 'Employee Name' },
    { key: 'event', label: 'Event Name' },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'amount', label: 'Amount', render: (r) => (r.amount == null ? '-' : `${r.currency} ${fmtNumber(r.amount)}`.trim()) },
    { key: 'open', label: '', render: (r) => <Link className="hrms-link" to={hrmsPath(`claim/assignClaim/id/${r.id}`)}>View Details</Link> },
  ];

  return (
    <>
      <PageCard title="Employee Claims">
        <form className="hrms-filters" onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
          <EmployeePicker includePast value={draft.employee} onChange={(employee) => setDraft({ ...draft, employee })} />
          <TextField label="Reference Id" value={draft.referenceId} onChange={(e) => setDraft({ ...draft, referenceId: e.target.value })} />
          <SelectField label="Status" options={STATUS_OPTIONS} placeholder="-- All --" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} />
          <div className="hrms-filter-actions"><Button type="submit">Search</Button></div>
        </form>
      </PageCard>
      <PageCard title="Claims">
        <AsyncBody state={state}>
          {(res) => {
            const rows = rowsOf(res).map(claimRow);
            return (
              <>
                <p className="hrms-muted">{rows.length} record{rows.length === 1 ? '' : 's'} found</p>
                <DataTable columns={columns} rows={rows} empty="No claims match your search." />
              </>
            );
          }}
        </AsyncBody>
      </PageCard>
    </>
  );
}

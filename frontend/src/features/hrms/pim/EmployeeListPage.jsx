import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listEmployees } from '../api';
import { employeeRow } from '../components/helpers';
import { AsyncBody, Button, DataTable, PageCard, SelectField, StatusPill, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

const INCLUDE = [
  { value: 'currentOnly', label: 'Current Employees Only' },
  { value: 'currentAndPast', label: 'Current and Past Employees' },
  { value: 'onlyPast', label: 'Past Employees Only' },
];

export default function EmployeeListPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({ nameOrId: '', include: 'currentOnly' });
  const [applied, setApplied] = useState(draft);
  const state = useAsync(
    () => listEmployees({ nameOrId: applied.nameOrId.trim(), includeEmployees: applied.include }),
    [applied],
  );

  const columns = [
    { key: 'id', label: 'Id' },
    { key: 'firstMiddle', label: 'First (& Middle) Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'jobTitle', label: 'Job Title' },
    { key: 'status', label: 'Employment Status' },
    { key: 'unit', label: 'Sub Unit' },
    { key: 'supervisor', label: 'Supervisor' },
    { key: 'view', label: '', render: (r) => (
      <span className="hrms-row-end">
        {r.past && <StatusPill status="Past employee" />}
        <Link className="hrms-link" to={hrmsPath(`pim/viewPersonalDetails/empNumber/${r.empNumber}`)}>View</Link>
      </span>
    ) },
  ];

  return (
    <>
      <PageCard title="Employee Information">
        <form className="hrms-filters" onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
          <TextField label="Employee Name or Id" placeholder="Type a name or id" value={draft.nameOrId} onChange={(e) => setDraft({ ...draft, nameOrId: e.target.value })} />
          <SelectField label="Include" placeholder={null} options={INCLUDE} value={draft.include} onChange={(e) => setDraft({ ...draft, include: e.target.value })} />
          <div className="hrms-filter-actions">
            <Button kind="ghost" onClick={() => { const reset = { nameOrId: '', include: 'currentOnly' }; setDraft(reset); setApplied(reset); }}>Reset</Button>
            <Button type="submit">Search</Button>
          </div>
        </form>
      </PageCard>
      <PageCard
        title="Employees"
        actions={<Button onClick={() => navigate(hrmsPath('pim/addEmployee'))}>+ Add</Button>}
      >
        <AsyncBody state={state}>
          {(res) => {
            const rows = (res?.data ?? []).map(employeeRow);
            return (
              <>
                <p className="hrms-muted">{rows.length} record{rows.length === 1 ? '' : 's'} found</p>
                <DataTable columns={columns} rows={rows} rowKey="empNumber" empty="No employees match your search." />
              </>
            );
          }}
        </AsyncBody>
      </PageCard>
    </>
  );
}

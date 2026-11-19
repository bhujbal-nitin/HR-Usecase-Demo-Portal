import { useState } from 'react';
import { getLeaveBalances, listEmployees, listLeavePeriods, listLeaveTypes } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { balanceRow, currentPeriod, fmtDate, fullName } from '../components/helpers';
import { Button, DataTable, Loading, Notice, PageCard, rowsOf, SelectField } from '../components/ui';
import { useAsync } from '../components/useAsync';

const loadLookups = () => Promise.all([listLeaveTypes(), listLeavePeriods()]);
const MAX_PEOPLE = 40;

/** Balance of one leave type for everybody (one call per person, capped so the page stays quick). */
export async function balancesForType(typeId) {
  const people = rowsOf(await listEmployees({ limit: MAX_PEOPLE }));
  const all = await Promise.all(people.map((p) => getLeaveBalances(p.empNumber).then((r) => ({ p, rows: rowsOf(r) }), () => ({ p, rows: [] }))));
  return all
    .map(({ p, rows }) => ({ ...balanceRow(rows.find((b) => String(b.leaveType?.id) === String(typeId)) ?? { leaveType: {} }), employee: fullName(p) }))
    .filter((r) => r.hasEntitlement);
}

export default function BalanceReportPage() {
  const lookups = useAsync(loadLookups, []);
  const [mode, setMode] = useState('employee');
  const [employee, setEmployee] = useState(null);
  const [typeId, setTypeId] = useState('');
  const [periodKey, setPeriodKey] = useState('');
  const [report, setReport] = useState({ rows: null, busy: false, error: '' });

  if (lookups.loading) return <Loading />;
  if (lookups.error) return <Notice>{lookups.error}</Notice>;
  const types = rowsOf(lookups.data?.[0]).filter((t) => !t.deleted);
  const periods = rowsOf(lookups.data?.[1]);
  const period = periods.find((p) => p.startDate === periodKey) ?? currentPeriod(periods);

  const generate = async (event) => {
    event.preventDefault();
    if (mode === 'employee' && !employee) { setReport({ rows: null, busy: false, error: 'Please pick an employee from the suggestions.' }); return; }
    if (mode === 'type' && !typeId) { setReport({ rows: null, busy: false, error: 'Please choose a leave type.' }); return; }
    setReport({ rows: null, busy: true, error: '' });
    try {
      const rows = mode === 'employee'
        ? rowsOf(await getLeaveBalances(employee.empNumber)).map((b) => ({ ...balanceRow(b), employee: employee.name }))
        : await balancesForType(typeId);
      setReport({ rows, busy: false, error: '' });
    } catch (e) {
      setReport({ rows: null, busy: false, error: e.message });
    }
  };

  const columns = [
    ...(mode === 'type' ? [{ key: 'employee', label: 'Employee' }] : [{ key: 'type', label: 'Leave Type' }]),
    { key: 'entitled', label: 'Leave Entitlements (Days)' },
    { key: 'used', label: 'Leave Taken / Scheduled (Days)' },
    { key: 'pending', label: 'Leave Pending Approval (Days)' },
    { key: 'balance', label: 'Leave Balance (Days)' },
  ];

  return (
    <>
      <PageCard title="Leave Entitlements and Usage Report">
        <form className="hrms-filters" onSubmit={generate}>
          <SelectField label="Generate For" placeholder={null} value={mode} onChange={(e) => { setMode(e.target.value); setReport({ rows: null, busy: false, error: '' }); }}
            options={[{ value: 'employee', label: 'Employee' }, { value: 'type', label: 'Leave Type' }]} />
          {mode === 'employee'
            ? <EmployeePicker required value={employee} onChange={setEmployee} />
            : <SelectField label="Leave Type" required value={typeId} onChange={(e) => setTypeId(e.target.value)} options={types.map((t) => ({ value: t.id, label: t.name }))} />}
          <SelectField label="Leave Period" placeholder={null} value={period?.startDate ?? ''} onChange={(e) => setPeriodKey(e.target.value)}
            options={periods.map((p) => ({ value: p.startDate, label: `${fmtDate(p.startDate)} - ${fmtDate(p.endDate)}` }))} />
          <div className="hrms-filter-actions"><Button type="submit" disabled={report.busy}>{report.busy ? 'Generating...' : 'Generate'}</Button></div>
        </form>
        <Notice>{report.error}</Notice>
      </PageCard>
      {report.rows && (
        <PageCard title="Report">
          <p className="hrms-muted">Balances shown are as of today for the current leave period.</p>
          <DataTable columns={columns} rows={report.rows.map((r, i) => ({ ...r, id: i }))} empty="No leave entitlements found for this selection." />
        </PageCard>
      )}
    </>
  );
}

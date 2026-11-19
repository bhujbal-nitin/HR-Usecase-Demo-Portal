import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addEntitlement, listEntitlements, listLeavePeriods, listLeaveTypes } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { currentPeriod, fmtDate, fmtNumber } from '../components/helpers';
import { AsyncBody, Button, DataTable, Loading, Notice, PageCard, rowsOf, SelectField, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

export function EntitlementsPage() {
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [applied, setApplied] = useState(null);
  const state = useAsync(applied ? () => listEntitlements({ empNumber: applied.empNumber }) : null, [applied]);
  const columns = [
    { key: 'type', label: 'Leave Type', render: (r) => r.leaveType?.name ?? '-' },
    { key: 'period', label: 'Entitlement Period', render: (r) => `${fmtDate(r.fromDate)} - ${fmtDate(r.toDate)}` },
    { key: 'entitlement', label: 'Days', render: (r) => fmtNumber(r.noOfDays ?? r.entitlement) },
  ];
  return (
    <>
      <PageCard title="Leave Entitlements">
        <form className="hrms-filters" onSubmit={(e) => { e.preventDefault(); setApplied(employee); }}>
          <EmployeePicker required value={employee} onChange={setEmployee} />
          <div className="hrms-filter-actions"><Button type="submit" disabled={!employee}>Search</Button></div>
        </form>
      </PageCard>
      <PageCard title="Entitlements" actions={<Button onClick={() => navigate(hrmsPath('leave/addLeaveEntitlement'))}>+ Add</Button>}>
        {!applied ? <p className="hrms-muted">Choose an employee to see their entitlements.</p> : (
          <AsyncBody state={state}>{(res) => <DataTable columns={columns} rows={rowsOf(res).map((r, i) => ({ ...r, id: r.id ?? i }))} empty={`No entitlements for ${applied.name}.`} />}</AsyncBody>
        )}
      </PageCard>
    </>
  );
}

export function AddEntitlementPage() {
  const navigate = useNavigate();
  const lookups = useAsync(() => Promise.all([listLeaveTypes(), listLeavePeriods()]), []);
  const [form, setForm] = useState({ employee: null, typeId: '', amount: '' });
  const [status, setStatus] = useState({ busy: false, error: '', ok: false });

  if (lookups.loading) return <Loading />;
  if (lookups.error) return <Notice>{lookups.error}</Notice>;
  const types = rowsOf(lookups.data[0]).filter((t) => !t.deleted);
  const period = currentPeriod(rowsOf(lookups.data[1]));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.employee || !form.typeId || !(Number(form.amount) > 0) || !period) {
      setStatus({ busy: false, ok: false, error: 'Please choose an employee, a leave type and an entitlement above zero.' });
      return;
    }
    setStatus({ busy: true, error: '', ok: false });
    try {
      await addEntitlement({ empNumber: form.employee.empNumber, leaveTypeId: Number(form.typeId) || form.typeId, fromDate: period.startDate, toDate: period.endDate, entitlement: form.amount });
      setStatus({ busy: false, error: '', ok: true });
      setForm({ ...form, amount: '' });
    } catch (e) {
      setStatus({ busy: false, ok: false, error: e.message });
    }
  };

  return (
    <PageCard title="Add Leave Entitlement">
      <form className="hrms-form" onSubmit={submit} noValidate>
        <div className="hrms-form-row three">
          <EmployeePicker required value={form.employee} onChange={(employee) => setForm({ ...form, employee })} />
          <SelectField label="Leave Type" required value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })} options={types.map((t) => ({ value: t.id, label: t.name }))} />
          <TextField label="Entitlement (Days)" type="number" min="0" step="0.5" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <p className="hrms-muted">Leave period: {period ? `${fmtDate(period.startDate)} - ${fmtDate(period.endDate)}` : 'not available'}. Adding to an existing entitlement increases it.</p>
        <Notice>{status.error}</Notice>
        <Notice kind="success">{status.ok ? 'Entitlement saved.' : ''}</Notice>
        <div className="hrms-form-actions">
          <Button kind="ghost" onClick={() => navigate(hrmsPath('leave/viewLeaveEntitlements'))}>Cancel</Button>
          <Button type="submit" disabled={status.busy}>{status.busy ? 'Saving...' : 'Save'}</Button>
        </div>
      </form>
    </PageCard>
  );
}

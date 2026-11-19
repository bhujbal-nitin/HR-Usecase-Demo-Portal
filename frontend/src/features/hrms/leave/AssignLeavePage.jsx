import { useState } from 'react';
import { Link } from 'react-router-dom';
import { assignLeave, getLeaveBalances, listLeaveTypes } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { balanceRow } from '../components/helpers';
import { Button, Notice, PageCard, rowsOf, SelectField, TextAreaField, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

/** Request body for `POST leave/employees/leave-requests`; a single day when no end date is given. */
export function assignBody(form) {
  return {
    empNumber: form.employee.empNumber,
    leaveTypeId: Number(form.typeId) || form.typeId,
    fromDate: form.from,
    toDate: form.to || form.from,
    comment: form.comment,
    duration: { type: 'full_day' },
  };
}

export default function AssignLeavePage() {
  const types = useAsync(listLeaveTypes, []);
  const [form, setForm] = useState({ employee: null, typeId: '', from: '', to: '', comment: '' });
  const [status, setStatus] = useState({ busy: false, error: '', done: null });
  const balance = useAsync(
    form.employee && form.typeId ? () => getLeaveBalances(form.employee.empNumber) : null,
    [form.employee?.empNumber, form.typeId, status.done],
  );
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const mine = rowsOf(balance.data).find((b) => String(b.leaveType?.id) === String(form.typeId));
  const row = mine ? balanceRow(mine) : null;

  const submit = async (event) => {
    event.preventDefault();
    if (!form.employee || !form.typeId || !form.from) {
      setStatus({ busy: false, error: 'Please choose an employee, a leave type and a from date.', done: null });
      return;
    }
    if (form.to && form.to < form.from) {
      setStatus({ busy: false, error: 'The to date cannot be before the from date.', done: null });
      return;
    }
    setStatus({ busy: true, error: '', done: null });
    try {
      const res = await assignLeave(assignBody(form));
      setStatus({ busy: false, error: '', done: res?.data?.id ?? true });
      setForm({ ...form, from: '', to: '', comment: '' });
    } catch (e) {
      setStatus({ busy: false, error: e.message, done: null });
    }
  };

  return (
    <PageCard title="Assign Leave">
      <form className="hrms-form" onSubmit={submit} noValidate>
        <div className="hrms-form-row three">
          <EmployeePicker required value={form.employee} onChange={(employee) => setForm({ ...form, employee })} />
          <SelectField label="Leave Type" required value={form.typeId} onChange={set('typeId')}
            options={rowsOf(types.data).filter((t) => !t.deleted).map((t) => ({ value: t.id, label: t.name }))} />
          <div className="hrms-field">
            <span className="hrms-label">Leave Balance</span>
            <div className="hrms-static">{row ? `${row.balance} Day(s)` : form.employee && form.typeId ? (balance.loading ? 'Checking...' : '0.00 Day(s)') : '-'}</div>
          </div>
        </div>
        <div className="hrms-form-row three">
          <TextField label="From Date" type="date" required value={form.from} onChange={set('from')} />
          <TextField label="To Date" type="date" value={form.to} onChange={set('to')} hint="Leave empty for a single day." />
        </div>
        <TextAreaField label="Comments" value={form.comment} onChange={set('comment')} />
        <Notice>{status.error}</Notice>
        {status.done && (
          <Notice kind="success">
            Leave assigned successfully.{' '}
            {status.done !== true && <Link className="hrms-link" to={hrmsPath(`leave/viewLeaveRequest/${status.done}`)}>View the request</Link>}
          </Notice>
        )}
        <div className="hrms-form-actions"><Button type="submit" disabled={status.busy}>{status.busy ? 'Assigning...' : 'Assign'}</Button></div>
      </form>
    </PageCard>
  );
}

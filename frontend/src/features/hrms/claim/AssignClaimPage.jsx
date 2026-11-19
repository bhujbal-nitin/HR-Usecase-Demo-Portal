import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClaim, listClaimEvents } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { Button, Notice, PageCard, rowsOf, SelectField, TextAreaField, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

export default function AssignClaimPage() {
  const navigate = useNavigate();
  const events = useAsync(listClaimEvents, []);
  const [form, setForm] = useState({ employee: null, eventId: '', currency: 'INR', remarks: '' });
  const [status, setStatus] = useState({ busy: false, error: '' });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (event) => {
    event.preventDefault();
    if (!form.employee || !form.eventId || !form.currency.trim()) {
      setStatus({ busy: false, error: 'Please choose an employee, an event and a currency.' });
      return;
    }
    setStatus({ busy: true, error: '' });
    try {
      const res = await createClaim(form.employee.empNumber, {
        claimEventId: Number(form.eventId) || form.eventId,
        currencyId: form.currency.trim().toUpperCase(),
        remarks: form.remarks,
      });
      navigate(hrmsPath(`claim/assignClaim/id/${res.data.id}`));
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  return (
    <PageCard title="Create Claim Request">
      <form className="hrms-form" onSubmit={submit} noValidate>
        <div className="hrms-form-row three">
          <EmployeePicker required value={form.employee} onChange={(employee) => setForm({ ...form, employee })} />
          <SelectField label="Event" required value={form.eventId} onChange={set('eventId')}
            options={rowsOf(events.data).filter((e) => e.status !== false && !e.deleted).map((e) => ({ value: e.id, label: e.name }))} />
          <TextField label="Currency" required value={form.currency} onChange={set('currency')} hint="For example INR" />
        </div>
        <TextAreaField label="Remarks" value={form.remarks} onChange={set('remarks')} />
        <Notice>{status.error || events.error}</Notice>
        <div className="hrms-form-actions"><Button type="submit" disabled={status.busy}>{status.busy ? 'Creating...' : 'Create'}</Button></div>
      </form>
    </PageCard>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEmployee } from '../api';
import { Button, Notice, PageCard, TextField } from '../components/ui';
import { hrmsPath } from '../layout/menu';

export default function AddEmployeePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: '', middleName: '', lastName: '', employeeId: '' });
  const [error, setError] = useState('');
  const [keys, setKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const bad = (key) => (keys.includes(key) ? 'This value is not accepted or is already used.' : '');

  const submit = async (event) => {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First name and last name are required.');
      setKeys([!form.firstName.trim() && 'firstName', !form.lastName.trim() && 'lastName'].filter(Boolean));
      return;
    }
    setBusy(true);
    setError('');
    setKeys([]);
    try {
      const body = { firstName: form.firstName.trim(), middleName: form.middleName.trim(), lastName: form.lastName.trim() };
      if (form.employeeId.trim()) body.employeeId = form.employeeId.trim();
      const res = await createEmployee(body);
      navigate(hrmsPath(`pim/viewPersonalDetails/empNumber/${res.data.empNumber}`));
    } catch (e) {
      setError(e.message);
      setKeys(e.keys ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageCard title="Add Employee">
      <form className="hrms-form" onSubmit={submit} noValidate>
        <div className="hrms-form-row three">
          <TextField label="First Name" required value={form.firstName} onChange={set('firstName')} error={bad('firstName')} />
          <TextField label="Middle Name" value={form.middleName} onChange={set('middleName')} />
          <TextField label="Last Name" required value={form.lastName} onChange={set('lastName')} error={bad('lastName')} />
        </div>
        <div className="hrms-form-row">
          <TextField label="Employee Id" value={form.employeeId} onChange={set('employeeId')} error={bad('employeeId')} hint="Leave empty to get the next free id." />
        </div>
        <Notice>{error}</Notice>
        <div className="hrms-form-actions">
          <Button kind="ghost" onClick={() => navigate(hrmsPath('pim/viewEmployeeList'))}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
        </div>
      </form>
    </PageCard>
  );
}

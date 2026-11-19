import { useState } from 'react';
import { getJob, listTerminationReasons, saveJob, terminateEmployee } from '../api';
import { AsyncBody, Button, Notice, rowsOf, SelectField, TextAreaField, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { todayISO } from '../components/helpers';
import RecordForm from './RecordForm';

const JOB_FIELDS = [
  { key: 'joinedDate', label: 'Joined Date', type: 'date' },
  { key: 'jobTitle', label: 'Job Title', path: 'jobTitle.title', readOnly: true },
  { key: 'empStatus', label: 'Employment Status', path: 'empStatus.name', readOnly: true },
  { key: 'subunit', label: 'Sub Unit', path: 'subunit.name', readOnly: true },
  { key: 'location', label: 'Location', path: 'location.name', readOnly: true },
];

function TerminateForm({ empNumber, onDone }) {
  const reasons = useAsync(listTerminationReasons, []);
  const [form, setForm] = useState({ reason: '', date: todayISO(), note: '' });
  const [status, setStatus] = useState({ busy: false, error: '' });

  const submit = async (event) => {
    event.preventDefault();
    if (!form.reason || !form.date) { setStatus({ busy: false, error: 'Please choose a reason and a date.' }); return; }
    setStatus({ busy: true, error: '' });
    try {
      await terminateEmployee(empNumber, { date: form.date, terminationReasonId: Number(form.reason) || form.reason, note: form.note });
      onDone();
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  return (
    <AsyncBody state={reasons}>
      {(res) => (
        <form className="hrms-form hrms-danger-box" onSubmit={submit} noValidate>
          <h3>Terminate Employment</h3>
          <div className="hrms-form-row three">
            <TextField label="Termination Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <SelectField label="Termination Reason" required options={rowsOf(res).map((r) => ({ value: r.id, label: r.name }))} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <TextAreaField label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Notice>{status.error}</Notice>
          <div className="hrms-form-actions"><Button kind="danger" type="submit" disabled={status.busy}>{status.busy ? 'Terminating...' : 'Terminate Employment'}</Button></div>
        </form>
      )}
    </AsyncBody>
  );
}

export default function JobTab({ empNumber, terminated, onChanged }) {
  return (
    <div>
      <div className="hrms-subhead"><h3>Job Details</h3></div>
      <RecordForm reloadKey={empNumber} load={() => getJob(empNumber)} save={(body) => saveJob(empNumber, body)} fields={JOB_FIELDS} />
      <div className="hrms-subhead"><h3>Employment Status</h3></div>
      {terminated
        ? <Notice kind="info">This employee's employment has been terminated. The profile is kept as a past employee.</Notice>
        : <TerminateForm empNumber={empNumber} onDone={onChanged} />}
    </div>
  );
}

import { useState } from 'react';
import { addAttachment, addEmergency, addSalary, attachmentUrl, listAttachments, listEmergency, listSalary } from '../api';
import { fmtDate } from '../components/helpers';
import { AsyncBody, Button, DataTable, Notice, rowsOf, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';

/** A list with an "Add" form under it. `toBody` turns the form values into the API body. */
function ListTab({ empNumber, title, load, add, fields, columns, toBody, validate, extra }) {
  const state = useAsync(load, [empNumber]);
  const empty = Object.fromEntries(fields.map((f) => [f.key, '']));
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({ busy: false, error: '' });

  const submit = async (event) => {
    event.preventDefault();
    const problem = validate?.(form);
    if (problem) { setStatus({ busy: false, error: problem }); return; }
    setStatus({ busy: true, error: '' });
    try {
      await add(toBody(form));
      setForm(empty);
      setOpen(false);
      setStatus({ busy: false, error: '' });
      state.reload();
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  return (
    <div>
      <div className="hrms-subhead"><h3>{title}</h3><Button onClick={() => setOpen(!open)}>{open ? 'Close' : '+ Add'}</Button></div>
      {open && (
        <form className="hrms-form hrms-inline-form" onSubmit={submit} noValidate>
          <div className="hrms-form-row three">
            {fields.map((f) => (
              <TextField key={f.key} label={f.label} type={f.type ?? 'text'} required={f.required} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ))}
            {extra?.(form, setForm)}
          </div>
          <Notice>{status.error}</Notice>
          <div className="hrms-form-actions"><Button type="submit" disabled={status.busy}>{status.busy ? 'Saving...' : 'Save'}</Button></div>
        </form>
      )}
      <AsyncBody state={state}>{(res) => <DataTable columns={columns} rows={rowsOf(res)} empty={`No ${title.toLowerCase()} yet.`} />}</AsyncBody>
    </div>
  );
}

export function EmergencyTab({ empNumber }) {
  const load = () => listEmergency(empNumber);
  return (
    <ListTab
      empNumber={empNumber}
      title="Emergency Contacts"
      load={load}
      add={(body) => addEmergency(empNumber, body)}
      fields={[
        { key: 'name', label: 'Name', required: true }, { key: 'relationship', label: 'Relationship', required: true },
        { key: 'homePhone', label: 'Home Telephone' }, { key: 'mobilePhone', label: 'Mobile' }, { key: 'officePhone', label: 'Work Telephone' },
      ]}
      toBody={(f) => f}
      validate={(f) => (!f.name.trim() || !f.relationship.trim() ? 'Name and relationship are required.' : '')}
      columns={[
        { key: 'name', label: 'Name' }, { key: 'relationship', label: 'Relationship' },
        { key: 'homePhone', label: 'Home Telephone' }, { key: 'mobilePhone', label: 'Mobile' }, { key: 'officePhone', label: 'Work Telephone' },
      ]}
    />
  );
}

export function SalaryTab({ empNumber }) {
  const load = () => listSalary(empNumber);
  return (
    <ListTab
      empNumber={empNumber}
      title="Salary Components"
      load={load}
      add={(body) => addSalary(empNumber, body)}
      fields={[
        { key: 'salaryComponent', label: 'Salary Component', required: true },
        { key: 'salaryAmount', label: 'Amount', type: 'number', required: true },
        { key: 'currencyId', label: 'Currency', required: true },
      ]}
      toBody={(f) => ({ salaryComponent: f.salaryComponent.trim(), salaryAmount: f.salaryAmount, currencyId: f.currencyId.trim().toUpperCase() })}
      validate={(f) => (!f.salaryComponent.trim() || !f.salaryAmount || !f.currencyId.trim() ? 'Component, amount and currency are required.' : '')}
      columns={[
        { key: 'salaryName', label: 'Salary Component' },
        { key: 'amount', label: 'Amount' },
        { key: 'cur', label: 'Currency', render: (r) => r.currencyType?.name ?? r.currencyType?.id ?? '' },
        { key: 'comment', label: 'Comments' },
      ]}
    />
  );
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export function AttachmentsTab({ empNumber }) {
  const load = () => listAttachments(empNumber);
  const state = useAsync(load, [empNumber]);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState({ busy: false, error: '' });

  const upload = async (event) => {
    event.preventDefault();
    const file = event.target.elements.file.files[0];
    if (!file) { setStatus({ busy: false, error: 'Please choose a file first.' }); return; }
    setStatus({ busy: true, error: '' });
    try {
      const base64 = await readFile(file);
      await addAttachment(empNumber, { attachment: { name: file.name, type: file.type, size: file.size, base64 }, description });
      event.target.reset();
      setDescription('');
      setStatus({ busy: false, error: '' });
      state.reload();
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  const columns = [
    { key: 'filename', label: 'File Name' },
    { key: 'description', label: 'Description' },
    { key: 'size', label: 'Size', render: (r) => `${Math.max(1, Math.round((r.size ?? 0) / 1024))} KB` },
    { key: 'fileType', label: 'Type' },
    { key: 'dateAdded', label: 'Date Added', render: (r) => fmtDate(r.dateAdded) },
    { key: 'dl', label: '', render: (r) => <a className="hrms-link" href={attachmentUrl(empNumber, r.id)} target="_blank" rel="noreferrer">Download</a> },
  ];

  return (
    <div>
      <div className="hrms-subhead"><h3>Attachments</h3></div>
      <form className="hrms-form hrms-inline-form" onSubmit={upload}>
        <div className="hrms-form-row three">
          <div className="hrms-field"><label htmlFor="hrms-att-file">Select File</label><input id="hrms-att-file" name="file" type="file" /></div>
          <TextField label="Comment" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Notice>{status.error}</Notice>
        <div className="hrms-form-actions"><Button type="submit" disabled={status.busy}>{status.busy ? 'Uploading...' : 'Upload'}</Button></div>
      </form>
      <AsyncBody state={state}>{(res) => <DataTable columns={columns} rows={rowsOf(res)} empty="No attachments yet." />}</AsyncBody>
    </div>
  );
}

import { useState } from 'react';
import { AsyncBody, Button, DataTable, Notice, PageCard, rowsOf, SelectField, TextField } from './ui';
import { useAsync } from './useAsync';

/**
 * A list page with an "Add" form (used for leave types, holidays, claim events and expense types).
 * fields: [{key,label,type?,required?,options?}]; initial values are '' (or `initial`).
 * toBody(form) builds the API body; add(body) saves it.
 */
export default function ConfigList({ title, noun, load, add, fields, columns, toBody, initial = {}, adding = false }) {
  const state = useAsync(load, []);
  const blank = { ...Object.fromEntries(fields.map((f) => [f.key, ''])), ...initial };
  const [open, setOpen] = useState(adding);
  const [form, setForm] = useState(blank);
  const [status, setStatus] = useState({ busy: false, error: '', keys: [] });

  const submit = async (event) => {
    event.preventDefault();
    const missing = fields.find((f) => f.required && !String(form[f.key]).trim());
    if (missing) { setStatus({ busy: false, error: `${missing.label} is required.`, keys: [missing.key] }); return; }
    setStatus({ busy: true, error: '', keys: [] });
    try {
      await add(toBody(form));
      setForm(blank);
      setOpen(false);
      setStatus({ busy: false, error: '', keys: [] });
      state.reload();
    } catch (e) {
      setStatus({ busy: false, error: e.message, keys: e.keys ?? [] });
    }
  };

  return (
    <>
      {open && (
        <PageCard title={`Add ${noun}`}>
          <form className="hrms-form" onSubmit={submit} noValidate>
            <div className="hrms-form-row three">
              {fields.map((f) => {
                const common = { label: f.label, required: f.required, value: form[f.key], onChange: (e) => setForm({ ...form, [f.key]: f.type === 'checkbox' ? e.target.checked : e.target.value }), error: status.keys.includes(f.key) ? 'This value is not accepted or is already used.' : '' };
                return f.options ? <SelectField key={f.key} {...common} options={f.options} placeholder={null} /> : <TextField key={f.key} {...common} type={f.type ?? 'text'} />;
              })}
            </div>
            <Notice>{status.error}</Notice>
            <div className="hrms-form-actions">
              <Button kind="ghost" onClick={() => { setOpen(false); setStatus({ busy: false, error: '', keys: [] }); }}>Cancel</Button>
              <Button type="submit" disabled={status.busy}>{status.busy ? 'Saving...' : 'Save'}</Button>
            </div>
          </form>
        </PageCard>
      )}
      <PageCard title={title} actions={!open && <Button onClick={() => setOpen(true)}>+ Add</Button>}>
        <AsyncBody state={state}>
          {(res) => {
            const rows = rowsOf(res).filter((r) => !r.deleted);
            return (
              <>
                <p className="hrms-muted">{rows.length} record{rows.length === 1 ? '' : 's'} found</p>
                <DataTable columns={columns} rows={rows} empty={`No ${noun.toLowerCase()} records yet.`} />
              </>
            );
          }}
        </AsyncBody>
      </PageCard>
    </>
  );
}

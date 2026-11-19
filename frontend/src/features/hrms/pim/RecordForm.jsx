import { useEffect, useState } from 'react';
import { AsyncBody, Button, Notice, SelectField, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';

/**
 * Loads one record, lets the user edit the listed fields and saves it.
 * fields: [{key, label, type?, options?, readOnly?, path?}]. `path` reads a nested value (e.g. "jobTitle.title") for read-only fields.
 */
function pick(obj, path) {
  return path.split('.').reduce((v, k) => (v == null ? v : v[k]), obj);
}

function Form({ record, fields, save, onSaved, children }) {
  const [form, setForm] = useState(() => Object.fromEntries(fields.filter((f) => !f.readOnly).map((f) => [f.key, record?.[f.key] ?? ''])));
  const [state, setState] = useState({ busy: false, error: '', keys: [], saved: false });

  useEffect(() => { setState((s) => ({ ...s, saved: false })); }, [form]);

  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, error: '', keys: [], saved: false });
    try {
      await save({ ...record, ...form });
      setState({ busy: false, error: '', keys: [], saved: true });
      onSaved?.();
    } catch (e) {
      setState({ busy: false, error: e.message, keys: e.keys ?? [], saved: false });
    }
  };

  return (
    <form className="hrms-form" onSubmit={submit} noValidate>
      <div className="hrms-form-row three">
        {fields.map((f) => {
          if (f.readOnly) {
            return <TextField key={f.key} label={f.label} value={String(pick(record, f.path ?? f.key) ?? '')} readOnly />;
          }
          const common = { label: f.label, value: form[f.key] ?? '', onChange: (e) => setForm({ ...form, [f.key]: e.target.value }), error: state.keys.includes(f.key) ? 'This value is not accepted or is already used.' : '' };
          return f.options ? <SelectField key={f.key} {...common} options={f.options} /> : <TextField key={f.key} {...common} type={f.type ?? 'text'} />;
        })}
      </div>
      <Notice>{state.error}</Notice>
      <Notice kind="success">{state.saved ? 'Saved successfully.' : ''}</Notice>
      <div className="hrms-form-actions"><Button type="submit" disabled={state.busy}>{state.busy ? 'Saving...' : 'Save'}</Button></div>
      {children}
    </form>
  );
}

export default function RecordForm({ load, save, fields, onSaved, reloadKey, children }) {
  const state = useAsync(load, [reloadKey]);
  return (
    <AsyncBody state={state}>
      {(res) => <Form record={res?.data ?? {}} fields={fields} save={save} onSaved={onSaved}>{children}</Form>}
    </AsyncBody>
  );
}

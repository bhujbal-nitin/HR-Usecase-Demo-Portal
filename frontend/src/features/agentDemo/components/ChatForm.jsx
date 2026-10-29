import { useState } from 'react';
import { formatDate } from '../../../utils/format';
import { VALIDATORS } from '../lib/leave';
import { todayIso } from '../lib/resignation';

// A small in-chat form for the leave & attendance agent. `form` describes it:
//   { title, hint, fields: [{ id, label, type: 'select'|'date'|'time'|'text', options?: [{ value, label }], minToday? }],
//     validator: 'leave' | 'regularize', defaults?, values, submitted, auto }
// Manual: the employee fills it in. Auto-play: it fills itself in, one field at a time, then submits. Submitted: read-only.

const shown = (field, value) => {
  if (value === undefined || value === '') return '';
  if (field.type === 'select') return field.options?.find((option) => option.value === value)?.label ?? value;
  return field.type === 'date' ? formatDate(value) : value;
};

export default function ChatForm({ form, active, onSubmit }) {
  const [values, setValues] = useState(() => ({
    ...Object.fromEntries(form.fields.map((field) => [field.id, field.type === 'select' ? field.options?.[0]?.value ?? '' : ''])),
    ...form.defaults,
  }));
  const [errors, setErrors] = useState({});

  if (form.submitted || form.auto) {
    const filled = Object.keys(form.values ?? {});
    const last = filled[filled.length - 1];
    return (
      <div className="ad-flow">
        <h5>{form.title}</h5>
        {!form.submitted && form.hint && <p>{form.hint}</p>}
        {form.fields.map((field) => {
          const has = form.values?.[field.id] !== undefined;
          return (
            <div key={field.id}>
              <label>{field.label}</label>
              <div className={`ad-input${has ? ' filled' : ''}${!form.submitted && field.id === last ? ' typing' : ''}`}>
                {has ? shown(field, form.values[field.id]) || '—' : ''}
              </div>
            </div>
          );
        })}
        <div className="ad-flow-row"><span className={`ad-go${form.submitted ? ' done' : ''}`}>{form.submitted ? '✓ Submitted' : 'Submit'}</span></div>
      </div>
    );
  }

  const change = (id, value) => {
    setValues((current) => ({ ...current, [id]: value }));
    setErrors((current) => (current[id] ? { ...current, [id]: '' } : current));
  };

  const submit = (event) => {
    event.preventDefault();
    const found = VALIDATORS[form.validator](values);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(values);
  };

  return (
    <form className="ad-flow" onSubmit={submit} noValidate>
      <h5>{form.title}</h5>
      {form.hint && <p>{form.hint}</p>}
      {form.fields.map((field) => (
        <div key={field.id}>
          <label htmlFor={`cf-${field.id}`}>{field.label}</label>
          {field.type === 'select' ? (
            <select id={`cf-${field.id}`} className="ad-edit" value={values[field.id]} disabled={!active} onChange={(e) => change(field.id, e.target.value)}>
              {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <input
              id={`cf-${field.id}`} className="ad-edit" type={field.type} value={values[field.id]} disabled={!active}
              min={field.type === 'date' && field.minToday ? (field.id === 'endDate' && values.startDate ? values.startDate : todayIso()) : undefined}
              maxLength={field.type === 'text' ? 300 : undefined} onChange={(e) => change(field.id, e.target.value)} aria-invalid={Boolean(errors[field.id])}
            />
          )}
          {errors[field.id] && <div className="ad-err" role="alert">{errors[field.id]}</div>}
        </div>
      ))}
      <div className="ad-flow-row ad-flow-actions">
        <button type="submit" className="ad-go" disabled={!active}>Submit</button>
      </div>
    </form>
  );
}

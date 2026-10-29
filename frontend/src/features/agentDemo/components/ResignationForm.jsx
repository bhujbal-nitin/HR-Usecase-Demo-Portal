import { useEffect, useState } from 'react';
import { RESIGNATION_FIELDS, todayIso, validateResignation } from '../lib/resignation';

/** The resignation form as an editable in-chat form (Manual · Live, Offboarding agent). */
export default function ResignationForm({ form, active, onSubmit }) {
  const [values, setValues] = useState({ lastWorkingDay: '', reason: form.reasons?.[0] ?? '', leaveBalanceDays: '0', comments: '' });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setValues((current) => (current.reason ? current : { ...current, reason: form.reasons?.[0] ?? '' }));
  }, [form.reasons]);

  if (form.submitted) {
    return (
      <div className="ad-flow">
        <h5>Resignation details</h5>
        {RESIGNATION_FIELDS.map(({ id, label }) => (
          <div key={id}><label>{label}</label><div className="ad-input filled">{String(form.values[id] || '—')}</div></div>
        ))}
        <div className="ad-flow-row"><span className="ad-go done">✓ Submitted</span></div>
      </div>
    );
  }

  if (form.auto) {
    // Auto-play: the form fills itself in, one field at a time, then submits (nothing here is editable).
    const filled = Object.keys(form.values ?? {});
    const last = filled[filled.length - 1];
    return (
      <div className="ad-flow">
        <h5>Resignation details</h5>
        <p>Your last working day counts the notice period of {form.noticePeriodDays ?? 30} days from today.</p>
        {RESIGNATION_FIELDS.map(({ id, label }) => (
          <div key={id}>
            <label>{label}</label>
            <div className={`ad-input${form.values?.[id] !== undefined ? ' filled' : ''}${id === last ? ' typing' : ''}`}>{form.values?.[id] ?? ''}</div>
          </div>
        ))}
        <div className="ad-flow-row"><span className="ad-go">Submit</span></div>
      </div>
    );
  }

  const change = (id, value) => {
    setValues((current) => ({ ...current, [id]: value }));
    setErrors((current) => (current[id] ? { ...current, [id]: '' } : current));
  };

  const submit = (event) => {
    event.preventDefault();
    const found = validateResignation(values);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(values);
  };

  return (
    <form className="ad-flow" onSubmit={submit} noValidate>
      <h5>Resignation details</h5>
      <p>Your last working day counts the notice period of {form.noticePeriodDays ?? 30} days from today.</p>
      {RESIGNATION_FIELDS.map(({ id, label, type }) => (
        <div key={id}>
          <label htmlFor={`rf-${id}`}>{label}</label>
          {type === 'select' ? (
            <select id={`rf-${id}`} className="ad-edit" value={values[id]} disabled={!active} onChange={(e) => change(id, e.target.value)}>
              {(form.reasons ?? []).map((option) => <option key={option}>{option}</option>)}
            </select>
          ) : (
            <input
              id={`rf-${id}`} className="ad-edit" type={type} value={values[id]} disabled={!active} min={type === 'date' ? todayIso() : type === 'number' ? 0 : undefined}
              maxLength={id === 'comments' ? 500 : undefined} placeholder={id === 'comments' ? 'Optional' : undefined}
              onChange={(e) => change(id, e.target.value)} aria-invalid={Boolean(errors[id])}
            />
          )}
          {errors[id] && <div className="ad-err" role="alert">{errors[id]}</div>}
        </div>
      ))}
      <div className="ad-flow-row ad-flow-actions">
        <button type="submit" className="ad-go" disabled={!active}>Submit</button>
      </div>
    </form>
  );
}

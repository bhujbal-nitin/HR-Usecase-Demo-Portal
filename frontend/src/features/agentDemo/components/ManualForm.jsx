import { useState } from 'react';
import { getAutofillProfile } from '../../../api/system';
import { INITIAL_VALUES } from '../../onboarding/constants';
import { validateField } from '../../onboarding/validation';
import { MANUAL_FIELDS } from '../engine/manualJourney.jsx';

const START = Object.fromEntries(MANUAL_FIELDS.map(({ id }) => [id, INITIAL_VALUES[id] ?? '']));

/** The joining form as an editable in-chat form. Validated with the same rules as the onboarding wizard. */
export default function ManualForm({ form, active, onSubmit }) {
  const [values, setValues] = useState(START);
  const [errors, setErrors] = useState({});
  const [filling, setFilling] = useState(false);

  if (form.submitted) {
    return (
      <div className="ad-flow">
        <h5>Joining details</h5>
        {MANUAL_FIELDS.map(({ id, label }) => (
          <div key={id}><label>{label}</label><div className="ad-input filled">{String(form.values[id])}</div></div>
        ))}
        <div className="ad-flow-row"><span className="ad-go done">✓ Submitted</span></div>
      </div>
    );
  }

  const change = (id, value) => {
    setValues((current) => ({ ...current, [id]: value }));
    setErrors((current) => (current[id] ? { ...current, [id]: '' } : current));
  };

  const fillSample = async () => {
    setFilling(true);
    try {
      const profile = await getAutofillProfile();
      setValues((current) => ({ ...current, ...Object.fromEntries(MANUAL_FIELDS.map(({ id }) => [id, profile[id] === undefined ? current[id] : String(profile[id])])) }));
      setErrors({});
    } finally {
      setFilling(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const found = {};
    MANUAL_FIELDS.forEach(({ id }) => {
      const message = validateField(id, values[id]);
      if (message) found[id] = message;
    });
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(values);
  };

  return (
    <form className="ad-flow" onSubmit={submit} noValidate>
      <h5>Joining details</h5>
      <p>Enter the name exactly as it appears on your Aadhaar.</p>
      {MANUAL_FIELDS.map(({ id, label, type, options, placeholder, maxLength }) => (
        <div key={id}>
          <label htmlFor={`mf-${id}`}>{label}</label>
          {type === 'select' ? (
            <select id={`mf-${id}`} className="ad-edit" value={values[id]} disabled={!active} onChange={(e) => change(id, e.target.value)}>
              {options.map((option) => <option key={option}>{option}</option>)}
            </select>
          ) : (
            <input
              id={`mf-${id}`} className="ad-edit" type={type} value={values[id]} placeholder={placeholder} maxLength={maxLength}
              disabled={!active} onChange={(e) => change(id, e.target.value)} aria-invalid={Boolean(errors[id])}
            />
          )}
          {errors[id] && <div className="ad-err" role="alert">{errors[id]}</div>}
        </div>
      ))}
      <div className="ad-flow-row ad-flow-actions">
        <button type="submit" className="ad-go" disabled={!active}>Submit</button>
        <button type="button" className="ad-link" onClick={fillSample} disabled={!active || filling}>{filling ? 'Filling…' : 'Fill sample'}</button>
      </div>
    </form>
  );
}

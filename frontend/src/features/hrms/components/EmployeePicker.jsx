import { useEffect, useId, useState } from 'react';
import { listEmployees } from '../api';
import { fullName } from './helpers';

/** Type-ahead employee search. `value` is {empNumber, name} or null. */
export default function EmployeePicker({ label = 'Employee Name', value, onChange, includePast = false, required, error }) {
  const id = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => { setText(value?.name ?? ''); }, [value]);

  useEffect(() => {
    if (!open || text.trim().length < 1 || text === value?.name) return undefined;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      listEmployees({ nameOrId: text.trim(), limit: 8, includeEmployees: includePast ? 'currentAndPast' : 'currentOnly' })
        .then((res) => { if (!cancelled) setOptions(res.data ?? []); })
        .catch(() => { if (!cancelled) setOptions([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, open, includePast, value]);

  const pick = (e) => {
    onChange({ empNumber: e.empNumber, name: fullName(e) });
    setOpen(false);
  };

  return (
    <div className={`hrms-field hrms-picker${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder="Type for hints..."
        value={text}
        aria-invalid={Boolean(error)}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (value) onChange(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && text.trim() && !value && (
        <ul className="hrms-picker-list" id={`${id}-list`} role="listbox">
          {searching && <li className="hrms-picker-note">Searching...</li>}
          {!searching && options.length === 0 && <li className="hrms-picker-note">No matching employees</li>}
          {options.map((e) => (
            <li key={e.empNumber} role="option" aria-selected="false" tabIndex={-1} onMouseDown={() => pick(e)}>
              {fullName(e)} <span>{e.employeeId}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <small className="hrms-field-error">{error}</small>}
    </div>
  );
}

import { useState } from 'react';

/** Masks all but the last four characters until the user chooses to reveal the value. */
export default function Sensitive({ value, label }) {
  const [shown, setShown] = useState(false);
  if (!value) return <>—</>;
  const masked = value.length > 4 ? `${'•'.repeat(value.length - 4)}${value.slice(-4)}` : '••••';
  return (
    <span className="sensitive">
      <code>{shown ? value : masked}</code>
      <button type="button" className="link-btn" onClick={() => setShown((s) => !s)} aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}>
        <i className={`fa-solid ${shown ? 'fa-eye-slash' : 'fa-eye'}`}></i>
      </button>
    </span>
  );
}

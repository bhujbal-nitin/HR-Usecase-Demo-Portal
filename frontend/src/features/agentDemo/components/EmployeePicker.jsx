import { useEffect, useState } from 'react';
import { eligibleEmployees } from '../lib/eligibleEmployees';

/**
 * Lists the employees a demo can be run for and reports the chosen one: onboarded and approved ones; for offboarding only those with
 * no offboarding yet, for leave and reimbursement not those who have already left. `kind` is 'offboarding', 'leave', 'reimbursement', 'payroll' or 'hr_policy'.
 */
export default function EmployeePicker({ value, onChange, kind = 'offboarding' }) {
  const offboarding = kind === 'offboarding';
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    eligibleEmployees(kind)
      .then((employees) => alive && setPeople(employees))
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, [kind]);

  if (error) return <p className="inline-warning">{error}</p>;
  if (!people) return <p>Loading employees…</p>;
  if (people.length === 0) return <p>{offboarding ? 'No employee is available to offboard.' : 'No employee is available.'} Onboard and approve someone first.</p>;

  return (
    <fieldset className="ad-picker">
      <legend>{offboarding ? 'Choose the employee who resigns' : 'Choose the employee'}</legend>
      {people.map((person) => (
        <label key={person.id} className={`ad-pick${value === person.id ? ' on' : ''}`}>
          <input type="radio" name={`${kind}-employee`} checked={value === person.id} onChange={() => onChange(person.id)} />
          <span><b>{person.fullName}</b> <small>{person.id}</small><br /><small>{person.jobTitle} · {person.department}</small></span>
        </label>
      ))}
    </fieldset>
  );
}

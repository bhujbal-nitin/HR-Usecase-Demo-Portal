import { useId } from 'react';
import { statusTone } from './helpers';

export function PageCard({ title, actions, children, className = '' }) {
  return (
    <section className={`hrms-card ${className}`}>
      {(title || actions) && (
        <header className="hrms-card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="hrms-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`hrms-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ label = 'Loading...' }) {
  return <div className="hrms-loading" role="status">{label}</div>;
}

export function Empty({ children = 'No records found.' }) {
  return <div className="hrms-empty">{children}</div>;
}

export function StatusPill({ status }) {
  return <span className={`hrms-pill ${statusTone(status)}`}>{status || '-'}</span>;
}

export function Button({ kind = 'primary', type = 'button', children, ...rest }) {
  return <button type={type} className={`hrms-btn ${kind}`} {...rest}>{children}</button>;
}

/** A labelled text-like input. `error` shows under the field. */
export function TextField({ label, error, required, hint, ...input }) {
  const id = useId();
  return (
    <div className={`hrms-field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input id={id} required={required} aria-invalid={Boolean(error)} {...input} />
      {hint && <small>{hint}</small>}
      {error && <small className="hrms-field-error">{error}</small>}
    </div>
  );
}

/** options: [{value,label}] */
export function SelectField({ label, options, error, required, placeholder = '-- Select --', ...select }) {
  const id = useId();
  return (
    <div className={`hrms-field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <select id={id} required={required} aria-invalid={Boolean(error)} {...select}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <small className="hrms-field-error">{error}</small>}
    </div>
  );
}

export function TextAreaField({ label, ...area }) {
  const id = useId();
  return (
    <div className="hrms-field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={3} {...area} />
    </div>
  );
}

/** columns: [{key,label,render?(row)}]. When `selected`/`onToggle` are given each row gets a checkbox. */
export function DataTable({ columns, rows, rowKey = 'id', empty, selected, onToggle, caption }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="hrms-table-wrap">
      <table className="hrms-table">
        {caption && <caption className="hrms-sr">{caption}</caption>}
        <thead>
          <tr>
            {onToggle && <th className="hrms-check-col"><span className="hrms-sr">Select</span></th>}
            {columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[rowKey]}>
              {onToggle && (
                <td className="hrms-check-col">
                  <input type="checkbox" aria-label={`Select row ${row[rowKey]}`} checked={selected.has(row[rowKey])} onChange={() => onToggle(row[rowKey])} />
                </td>
              )}
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shows the loading state, the error or the content of a useAsync result. */
export function AsyncBody({ state, children }) {
  if (state.loading) return <Loading />;
  if (state.error) return <Notice>{state.error}</Notice>;
  return children(state.data);
}

export const rowsOf = (res) => (Array.isArray(res?.data) ? res.data : []);

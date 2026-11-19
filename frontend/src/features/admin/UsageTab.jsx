import { useEffect, useState } from 'react';
import { getUsage } from '../../api/admin';
import { count, ROLE_LABEL, when } from './format';

const PERIODS = [
  { value: '', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

/** Tokens used per user. */
export default function UsageTab({ onShowHistory }) {
  const [days, setDays] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    getUsage(days ? Number(days) : undefined)
      .then((data) => { if (current) { setRows(data); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [days]);

  const total = (rows ?? []).reduce((sum, r) => ({ calls: sum.calls + r.calls, tokens: sum.tokens + r.totalTokens }), { calls: 0, tokens: 0 });

  return (
    <>
      <div className="admin-toolbar">
        <label htmlFor="usage-period">Period</label>
        <select id="usage-period" className="form-control admin-select" value={days} onChange={(e) => setDays(e.target.value)}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {rows && <span className="admin-note">{count(total.calls)} AI calls · {count(total.tokens)} tokens in total</span>}
      </div>
      {error && <div className="login-error" role="alert">{error}</div>}
      {rows === null && !error && <p className="admin-note">Loading…</p>}
      {rows && (
        <div className="table-responsive">
          <table className="data-table compact">
            <thead>
              <tr><th>User</th><th>Role</th><th className="num">AI calls</th><th className="num">Input tokens</th><th className="num">Output tokens</th><th className="num">Total tokens</th><th>Last used</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.username}>
                  <td><strong>{r.fullName || r.username}</strong>{r.fullName && <div className="admin-sub">{r.username}</div>}</td>
                  <td>{r.role ? ROLE_LABEL[r.role] : '—'}{r.isActive === false && <span className="admin-sub"> · disabled</span>}</td>
                  <td className="num">{count(r.calls)}</td>
                  <td className="num">{count(r.inputTokens)}</td>
                  <td className="num">{count(r.outputTokens)}</td>
                  <td className="num"><strong>{count(r.totalTokens)}</strong></td>
                  <td>{when(r.lastUsed)}</td>
                  <td><button type="button" className="btn btn-secondary" disabled={!r.calls} onClick={() => onShowHistory(r.username)}>History</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="admin-note">No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

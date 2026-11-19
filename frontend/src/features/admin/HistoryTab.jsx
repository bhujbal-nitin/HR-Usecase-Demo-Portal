import { useEffect, useState } from 'react';
import { getUsage, getUsageHistory } from '../../api/admin';
import { count, when } from './format';

const PAGE = 25;

/** Every AI call, newest first, for everybody or for one user. */
export default function HistoryTab({ initialUser = '' }) {
  const [username, setUsername] = useState(initialUser);
  const [names, setNames] = useState([]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { getUsage().then((rows) => setNames(rows.map((r) => r.username))).catch(() => {}); }, []);

  useEffect(() => {
    let current = true;
    getUsageHistory({ username, limit: PAGE, offset: page * PAGE })
      .then((result) => { if (current) { setData(result); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [username, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <>
      <div className="admin-toolbar">
        <label htmlFor="history-user">User</label>
        <select id="history-user" className="form-control admin-select" value={username} onChange={(e) => { setUsername(e.target.value); setPage(0); }}>
          <option value="">Everybody</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {data && <span className="admin-note">{count(data.total)} AI calls</span>}
      </div>
      {error && <div className="login-error" role="alert">{error}</div>}
      {data === null && !error && <p className="admin-note">Loading…</p>}
      {data && (
        <>
          <div className="table-responsive">
            <table className="data-table compact">
              <thead>
                <tr><th>When</th><th>User</th><th>Used for</th><th>Model</th><th className="num">Input</th><th className="num">Output</th><th className="num">Total</th></tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td>{when(i.at)}</td><td>{i.username}</td><td>{i.feature}</td><td>{i.model}</td>
                    <td className="num">{count(i.inputTokens)}</td><td className="num">{count(i.outputTokens)}</td><td className="num"><strong>{count(i.totalTokens)}</strong></td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={7} className="admin-note">No AI calls recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="admin-toolbar">
              <button type="button" className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="admin-note">Page {page + 1} of {pages}</span>
              <button type="button" className="btn btn-secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

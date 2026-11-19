import { useEffect, useState } from 'react';
import { getDemoRuns, getUsage } from '../../api/admin';
import { AGENTS, AGENT_BY_ID } from '../agents/data/agentRegistry';
import { count, when } from './format';

const PAGE = 25;
const OUTCOME = { completed: 'Finished', stopped: 'Stopped', failed: 'Failed' };

/** How long a run took, e.g. "3 min 12 s". */
const length = (seconds) => {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const modeLabel = (run) => `${run.manual ? 'Manual' : 'Auto-play'} · ${run.mode === 'live' ? 'Live' : 'Simulated Environment'}`;

/** Which demo each user ran, when, in which mode and how it ended. Newest first, for everybody or for one user and one demo. */
export default function DemoRunsTab() {
  const [username, setUsername] = useState('');
  const [agent, setAgent] = useState('');
  const [names, setNames] = useState([]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { getUsage().then((rows) => setNames(rows.map((r) => r.username))).catch(() => {}); }, []);

  useEffect(() => {
    let current = true;
    getDemoRuns({ username, agent, limit: PAGE, offset: page * PAGE })
      .then((result) => { if (current) { setData(result); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [username, agent, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <>
      <div className="admin-toolbar">
        <label htmlFor="runs-user">User</label>
        <select id="runs-user" className="form-control admin-select" value={username} onChange={(e) => { setUsername(e.target.value); setPage(0); }}>
          <option value="">Everybody</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <label htmlFor="runs-demo">Demo</label>
        <select id="runs-demo" className="form-control admin-select" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(0); }}>
          <option value="">All demos</option>
          {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.catalogName ?? a.name}</option>)}
        </select>
        {data && <span className="admin-note">{count(data.total)} demo runs</span>}
      </div>
      {error && <div className="login-error" role="alert">{error}</div>}
      {data === null && !error && <p className="admin-note">Loading…</p>}
      {data && (
        <>
          <div className="table-responsive">
            <table className="data-table compact">
              <thead>
                <tr><th>Started</th><th>User</th><th>Demo</th><th>Mode</th><th>Ended</th><th>Took</th><th>Result</th></tr>
              </thead>
              <tbody>
                {data.items.map((run) => (
                  <tr key={run.id}>
                    <td>{when(run.startedAt)}</td>
                    <td>{run.username}</td>
                    <td>{AGENT_BY_ID[run.agent]?.catalogName ?? AGENT_BY_ID[run.agent]?.name ?? run.agent}</td>
                    <td>{modeLabel(run)}</td>
                    <td>{when(run.endedAt)}</td>
                    <td>{length(run.seconds)}</td>
                    <td title={run.detail || undefined}>
                      {run.outcome ? <strong>{OUTCOME[run.outcome] ?? run.outcome}</strong> : <span className="admin-note">Not closed</span>}
                      {run.detail && <span className="admin-note"> · {run.detail}</span>}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={7} className="admin-note">No demo runs recorded yet.</td></tr>}
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

import { useCallback, useEffect, useState } from 'react';
import { changeUser, createUser, listUsers } from '../../api/admin';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ROLE_LABEL, formatAccess, when } from './format';

const EMPTY = {
  username: '',
  fullName: '',
  password: '',
  role: 'user',
  accessType: 'days', // 'days' | 'date' | 'lifetime'
  accessDays: 10,
  expiresAt: '',
};

export default function UsersTab() {
  const { username: me } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false); // the Add a user form is shown only after the button is clicked
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(null); // { username, password }
  const [editingAccess, setEditingAccess] = useState(null); // { username, accessType, accessDays, expiresAt }

  const load = useCallback(() => listUsers().then(setUsers).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const add = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        username: form.username.trim(),
        fullName: form.fullName.trim(),
        password: form.password,
        role: form.role,
        accessType: form.accessType,
      };

      if (form.accessType === 'days') {
        payload.accessDays = Math.max(1, parseInt(form.accessDays, 10) || 10);
        payload.expiresAt = null;
      } else if (form.accessType === 'date') {
        if (!form.expiresAt) throw new Error('Please select an expiration date.');
        payload.accessDays = null;
        payload.expiresAt = new Date(`${form.expiresAt}T23:59:59`).toISOString();
      } else {
        payload.accessDays = null;
        payload.expiresAt = null;
      }

      await createUser(payload);
      showToast(`User ${form.username.trim()} added.`, 'success');
      setForm(EMPTY);
      setAdding(false);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const change = async (username, changes, message) => {
    try {
      await changeUser(username, changes);
      showToast(message, 'success');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    await change(resetting.username, { password: resetting.password }, `Password changed for ${resetting.username}.`);
    setResetting(null);
  };

  const saveAccess = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        accessType: editingAccess.accessType,
      };
      if (editingAccess.accessType === 'days') {
        payload.accessDays = Math.max(1, parseInt(editingAccess.accessDays, 10) || 10);
        payload.expiresAt = null;
      } else if (editingAccess.accessType === 'date') {
        if (!editingAccess.expiresAt) throw new Error('Please select an expiration date.');
        payload.accessDays = null;
        payload.expiresAt = new Date(`${editingAccess.expiresAt}T23:59:59`).toISOString();
      } else {
        payload.accessDays = null;
        payload.expiresAt = null;
      }
      await change(editingAccess.username, payload, `Login access updated for ${editingAccess.username}.`);
      setEditingAccess(null);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <>
      {!adding && (
        <div className="admin-toolbar">
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <i className="fa-solid fa-user-plus"></i> Add a user
          </button>
        </div>
      )}
      {adding && (
      <form className="admin-card" onSubmit={add}>
        <h3><i className="fa-solid fa-user-plus"></i> Add a user</h3>
        <div className="admin-add-grid">
          <div className="form-group">
            <label htmlFor="nu-username">User name</label>
            <input
              id="nu-username"
              className="form-control"
              value={form.username}
              onChange={set('username')}
              autoComplete="off"
              required
              minLength={3}
              placeholder="e.g. alice.rao"
            />
          </div>
          <div className="form-group">
            <label htmlFor="nu-name">Full name</label>
            <input
              id="nu-name"
              className="form-control"
              value={form.fullName}
              onChange={set('fullName')}
              autoComplete="off"
              placeholder="Shown after sign-in"
            />
          </div>
          <div className="form-group">
            <label htmlFor="nu-password">Password</label>
            <input
              id="nu-password"
              className="form-control"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="form-group">
            <label htmlFor="nu-role">Role</label>
            <select id="nu-role" className="form-control" value={form.role} onChange={set('role')}>
              <option value="user">Normal user</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        {/* Login Access Duration Configuration */}
        <div style={{ marginTop: '0.75rem', marginBottom: '1.25rem', padding: '0.85rem 1rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
            <i className="fa-solid fa-clock-rotate-left" style={{ color: 'var(--accent-primary)' }}></i>
            Login Access Duration
          </label>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.65rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="nu-accessType"
                checked={form.accessType === 'days'}
                onChange={() => setForm((f) => ({ ...f, accessType: 'days', accessDays: f.accessDays || 10 }))}
              />
              <span>Days from first login (Default)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="nu-accessType"
                checked={form.accessType === 'date'}
                onChange={() => setForm((f) => ({ ...f, accessType: 'date' }))}
              />
              <span>Fixed expiration date</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="nu-accessType"
                checked={form.accessType === 'lifetime'}
                onChange={() => setForm((f) => ({ ...f, accessType: 'lifetime' }))}
              />
              <span>Lifetime access</span>
            </label>
          </div>

          {form.accessType === 'days' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span className="admin-sub" style={{ fontWeight: 600 }}>Presets:</span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {[10, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`btn btn-sm ${form.accessDays === d ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setForm((f) => ({ ...f, accessDays: d }))}
                  >
                    {d} Days {d === 10 ? '(10 days default)' : ''}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                <span className="admin-sub">Custom:</span>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  className="form-control"
                  style={{ width: '85px', padding: '0.3rem 0.5rem', height: '32px' }}
                  value={form.accessDays}
                  onChange={(e) => setForm((f) => ({ ...f, accessDays: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                />
                <span className="admin-sub">days</span>
              </div>
              <span className="admin-note" style={{ marginLeft: '0.5rem', marginBlock: 0, fontSize: '0.8rem' }}>
                <i className="fa-solid fa-circle-info"></i> The {form.accessDays}-day access clock starts the first time this user signs in.
              </span>
            </div>
          )}

          {form.accessType === 'date' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="admin-sub" style={{ fontWeight: 600 }}>Expires at end of:</span>
              <input
                type="date"
                className="form-control"
                style={{ width: 'auto', padding: '0.3rem 0.6rem', height: '34px' }}
                required
                min={new Date().toISOString().split('T')[0]}
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
              <span className="admin-note" style={{ marginBlock: 0, fontSize: '0.8rem' }}>
                User access will automatically expire on the selected date.
              </span>
            </div>
          )}

          {form.accessType === 'lifetime' && (
            <p className="admin-note" style={{ margin: 0, color: 'var(--accent-emerald)', fontSize: '0.85rem' }}>
              <i className="fa-solid fa-infinity"></i> User will have continuous, perpetual access until manually deactivated or changed.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <i className="fa-solid fa-plus"></i> {saving ? 'Adding…' : 'Add user'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => { setAdding(false); setForm(EMPTY); }}>Cancel</button>
        </div>
      </form>
      )}

      {error && <div className="login-error" role="alert">{error}</div>}
      {users === null && !error && <p className="admin-note">Loading users…</p>}
      {users && (
        <div className="table-responsive">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>User name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Login Access / Expiry</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const access = formatAccess(u);
                let statusBadge = null;
                if (!u.isActive) {
                  statusBadge = <span className="badge badge-rejected"><i className="fa-solid fa-ban"></i> Disabled</span>;
                } else if (u.isExpired) {
                  statusBadge = <span className="badge badge-rejected" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-rose)' }}><i className="fa-solid fa-clock"></i> Expired</span>;
                } else {
                  statusBadge = <span className="badge badge-approved"><i className="fa-solid fa-circle-check"></i> Active</span>;
                }

                return (
                  <tr key={u.username}>
                    <td>
                      <strong>{u.fullName || '—'}</strong>
                      {u.username.toLowerCase() === me?.toLowerCase() && <span className="admin-you"> (you)</span>}
                    </td>
                    <td>{u.username}</td>
                    <td>
                      <select
                        className="form-control admin-select"
                        value={u.role}
                        aria-label={`Role of ${u.username}`}
                        onChange={(e) => change(u.username, { role: e.target.value }, `${u.username} is now ${ROLE_LABEL[e.target.value].toLowerCase()}.`)}
                      >
                        <option value="user">Normal user</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{statusBadge}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {access.type === 'lifetime' && <i className="fa-solid fa-infinity" style={{ color: 'var(--accent-emerald)' }}></i>}
                          {access.type === 'pending_days' && <i className="fa-solid fa-hourglass-start" style={{ color: 'var(--accent-amber)' }}></i>}
                          {access.type === 'active_days' && <i className="fa-solid fa-clock" style={{ color: 'var(--accent-primary)' }}></i>}
                          {access.type === 'active_date' && <i className="fa-solid fa-calendar-day" style={{ color: 'var(--accent-primary)' }}></i>}
                          {access.type === 'expired' && <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-rose)' }}></i>}
                          <strong style={{ fontSize: '0.85rem', color: access.isExpired ? 'var(--accent-rose)' : 'inherit' }}>
                            {access.label}
                          </strong>
                        </div>
                        {access.sub && <span className="admin-sub" style={{ fontSize: '0.75rem' }}>{access.sub}</span>}
                      </div>
                    </td>
                    <td>{when(u.createdAt)}</td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => change(u.username, { isActive: !u.isActive }, `${u.username} is now ${u.isActive ? 'disabled' : 'active'}.`)}
                      >
                        {u.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setEditingAccess({
                          username: u.username,
                          accessType: u.accessType || 'lifetime',
                          accessDays: u.accessDays || 10,
                          expiresAt: u.expiresAt ? u.expiresAt.split('T')[0] : '',
                          isExpired: u.isExpired,
                          firstLoginAt: u.firstLoginAt,
                        })}
                      >
                        <i className="fa-solid fa-clock"></i> Access
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setResetting({ username: u.username, password: '' })}
                      >
                        Password
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Access Duration Form */}
      {editingAccess && (
        <form className="admin-card" onSubmit={saveAccess} style={{ marginTop: '1.25rem', border: '1px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fa-solid fa-clock" style={{ color: 'var(--accent-primary)' }}></i>
              Manage Login Access for <strong>{editingAccess.username}</strong>
            </h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingAccess(null)}>
              <i className="fa-solid fa-xmark"></i> Cancel
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="edit-accessType"
                checked={editingAccess.accessType === 'days'}
                onChange={() => setEditingAccess((prev) => ({ ...prev, accessType: 'days', accessDays: prev.accessDays || 10 }))}
              />
              <span>Days from login / Extend days</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="edit-accessType"
                checked={editingAccess.accessType === 'date'}
                onChange={() => setEditingAccess((prev) => ({ ...prev, accessType: 'date' }))}
              />
              <span>Fixed expiration date</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="edit-accessType"
                checked={editingAccess.accessType === 'lifetime'}
                onChange={() => setEditingAccess((prev) => ({ ...prev, accessType: 'lifetime' }))}
              />
              <span>Lifetime access (No expiration)</span>
            </label>
          </div>

          {editingAccess.accessType === 'days' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem', background: 'var(--bg-main)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <span className="admin-sub" style={{ fontWeight: 600 }}>Quick Extend:</span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {[10, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`btn btn-sm ${editingAccess.accessDays === d ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditingAccess((prev) => ({ ...prev, accessDays: d }))}
                  >
                    +{d} Days {d === 10 ? '(10 days default)' : ''}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                <span className="admin-sub">Custom:</span>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  className="form-control"
                  style={{ width: '85px', padding: '0.3rem 0.5rem', height: '32px' }}
                  value={editingAccess.accessDays}
                  onChange={(e) => setEditingAccess((prev) => ({ ...prev, accessDays: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                />
                <span className="admin-sub">days</span>
              </div>
              <span className="admin-note" style={{ marginLeft: '0.5rem', marginBlock: 0, fontSize: '0.8rem' }}>
                {editingAccess.firstLoginAt
                  ? `Extends access by ${editingAccess.accessDays} days starting from today.`
                  : `User has not logged in yet. Access will be valid for ${editingAccess.accessDays} days starting upon their first login.`}
              </span>
            </div>
          )}

          {editingAccess.accessType === 'date' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', background: 'var(--bg-main)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <span className="admin-sub" style={{ fontWeight: 600 }}>New Expiration Date:</span>
              <input
                type="date"
                className="form-control"
                style={{ width: 'auto', padding: '0.3rem 0.6rem', height: '34px' }}
                required
                min={new Date().toISOString().split('T')[0]}
                value={editingAccess.expiresAt}
                onChange={(e) => setEditingAccess((prev) => ({ ...prev, expiresAt: e.target.value }))}
              />
            </div>
          )}

          {editingAccess.accessType === 'lifetime' && (
            <div style={{ marginBottom: '1rem', background: 'var(--bg-main)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <p className="admin-note" style={{ margin: 0, color: 'var(--accent-emerald)', fontSize: '0.85rem' }}>
                <i className="fa-solid fa-infinity"></i> Granting lifetime access will clear any expiration limits.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary">
              <i className="fa-solid fa-check"></i> Save Access Duration
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditingAccess(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {resetting && (
        <form className="admin-card admin-reset" onSubmit={savePassword}>
          <label htmlFor="reset-password">New password for <strong>{resetting.username}</strong></label>
          <input
            id="reset-password"
            className="form-control"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
            value={resetting.password}
            onChange={(e) => setResetting({ ...resetting, password: e.target.value })}
            placeholder="At least 8 characters"
          />
          <button type="submit" className="btn btn-primary">Save password</button>
          <button type="button" className="btn btn-secondary" onClick={() => setResetting(null)}>Cancel</button>
        </form>
      )}
    </>
  );
}

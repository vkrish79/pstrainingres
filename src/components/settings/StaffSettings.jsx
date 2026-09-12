import { useMemo, useState } from 'react';
import { useStaff } from '../../hooks/useStaff.js';
import { useVendors } from '../../hooks/useVendors.js';
import { generateTempPassword } from '../../lib/passwords.js';
import { SettingsCard } from './SettingsCard.jsx';
import KebabMenu from '../KebabMenu.jsx';

// Settings → Staff. Was its own page in the rail; same managed-list shape as
// the rest of Settings.
//
// The one that isn't just a list: creating a staff member mints an account and
// hands back a temporary password, which has to be shown somewhere it cannot
// be missed. That is why the credentials box stays a full-width panel rather
// than a row detail.
const ROLE_OPTIONS = [
  { value: 'vendor_manager', label: 'Vendor manager' },
  { value: 'vendor_trainer', label: 'Vendor trainer' },
];

function roleLabel(role) {
  if (role === 'vendor_manager') return 'Manager';
  if (role === 'vendor_trainer' || role === 'trainer') return 'Trainer';
  return role;
}

export default function StaffSettings() {
  const { loading, error, staff, createStaff, updateStaffVendor, resetStaffPassword, deleteStaff } = useStaff();
  const { vendors, loading: vendorsLoading } = useVendors();

  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [role, setRole] = useState('vendor_trainer');
  const [vendorId, setVendorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [lastCreated, setLastCreated] = useState(null);

  const [filterVendorId, setFilterVendorId] = useState('all');

  const [editingId, setEditingId] = useState(null);
  const [editingVendorId, setEditingVendorId] = useState('');
  const [rowError, setRowError] = useState('');
  const [lastReset, setLastReset] = useState(null);

  const filtered = useMemo(() => {
    if (filterVendorId === 'all') return staff;
    if (filterVendorId === 'unassigned') return staff.filter(s => !s.vendor_id);
    return staff.filter(s => s.vendor_id === filterVendorId);
  }, [staff, filterVendorId]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await createStaff({
      email: email.trim(),
      full_name: fullName.trim(),
      temp_password: tempPassword,
      role,
      vendor_id: vendorId,
    });
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setLastCreated({
      email: data.email,
      full_name: data.full_name,
      temp_password: tempPassword,
      role: data.role,
    });
    setEmail(''); setFullName(''); setTempPassword(generateTempPassword());
    setAdding(false);
  }

  function startEdit(s) { setEditingId(s.id); setEditingVendorId(s.vendor_id || ''); setRowError(''); }
  function cancelEdit() { setEditingId(null); setEditingVendorId(''); setRowError(''); }
  async function saveEdit(id) {
    setRowError('');
    if (!editingVendorId) { setRowError('Vendor is required.'); return; }
    const { error: err } = await updateStaffVendor(id, editingVendorId);
    if (err) { setRowError(err.message); return; }
    cancelEdit();
  }

  async function handleResetPassword(s) {
    setRowError('');
    setLastReset(null);
    const who = s.full_name || s.email;
    if (!window.confirm(`Reset password for ${who} (${s.email})?\n\nTheir current password will stop working. You'll get a new temp password to share with them.`)) return;
    const newPassword = generateTempPassword();
    const { data, error: err } = await resetStaffPassword(s.id, newPassword);
    if (err) { setRowError(err.message); return; }
    setLastReset({ email: data.email, full_name: data.full_name, temp_password: newPassword });
  }

  async function handleDelete(s) {
    setRowError('');
    const who = s.full_name || s.email;
    const msg =
      `Permanently delete ${who} (${s.email})?\n\n`
      + 'This deletes both the auth account and the profile. '
      + 'They will no longer be able to log in, and the email is freed up for re-invite. '
      + 'This cannot be undone.';
    if (!window.confirm(msg)) return;
    const { error: err } = await deleteStaff(s.id);
    if (err) setRowError(err.message);
  }

  return (
    <SettingsCard
      title={`Staff (${filtered.length}${filtered.length !== staff.length ? ` of ${staff.length}` : ''})`}
      note="Trainers and vendor managers. Creating one mints their account and a temporary password to hand over; they change it at first login."
      addLabel="+ Add staff member"
      addOpen={adding}
      onToggleAdd={() => { setAdding(a => !a); setFormError(''); }}
      headerExtra={(
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: '11rem' }}
          value={filterVendorId}
          onChange={e => setFilterVendorId(e.target.value)}
          aria-label="Filter staff by vendor"
        >
          <option value="all">All vendors</option>
          <option value="unassigned">Unassigned</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      addForm={(
        <form onSubmit={handleCreate} className="settings-add-form">
          <div className="form-grid">
            <div>
              <label className="form-label" htmlFor="staff-vendor">Vendor</label>
              <select
                id="staff-vendor"
                className="form-input"
                required
                value={vendorId}
                onChange={e => setVendorId(e.target.value)}
                disabled={vendorsLoading}
              >
                <option value="">{vendorsLoading ? 'Loading…' : 'Select a vendor…'}</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
              </select>
            </div>
            <div>
              <span className="form-label">Role</span>
              <div className="staff-roles">
                {ROLE_OPTIONS.map(opt => (
                  <label key={opt.value} className="staff-role-opt">
                    <input
                      type="radio"
                      name="role"
                      value={opt.value}
                      checked={role === opt.value}
                      onChange={() => setRole(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="staff-email">Email</label>
              <input id="staff-email" className="form-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="staff-name">Full name</label>
              <input id="staff-name" className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="form-label" htmlFor="staff-pw">Temporary password</label>
              <div className="password-row">
                <input id="staff-pw" className="form-input" required value={tempPassword} onChange={e => setTempPassword(e.target.value)} />
                <button type="button" className="ghost" onClick={() => setTempPassword(generateTempPassword())}>Generate</button>
              </div>
              <p className="hint">Share this with the new staff member — they'll change it on first login.</p>
            </div>
          </div>
          {formError && <p className="error">{formError}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy || !email || !vendorId || tempPassword.length < 8}>
              {busy ? 'Creating…' : 'Create staff member'}
            </button>
          </div>
        </form>
      )}
    >
      {lastCreated && (
        <div className="created-card">
          <strong>Created.</strong> Share these credentials with <em>{lastCreated.full_name}</em> ({roleLabel(lastCreated.role)}):
          <div className="credentials">
            <span>{lastCreated.email}</span>
            <span className="st-mono">{lastCreated.temp_password}</span>
          </div>
          <button type="button" className="ghost" onClick={() => setLastCreated(null)} style={{ marginTop: '0.5rem' }}>Dismiss</button>
        </div>
      )}

      {loading && <div className="loading">Loading…</div>}
      {error && <p className="error">{error}</p>}
      {!loading && filtered.length === 0 && (
        <p className="muted">{staff.length === 0 ? 'No staff yet. Add the first one above.' : 'No staff match this filter.'}</p>
      )}
      {!loading && filtered.length > 0 && (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th className="st-vendor">Vendor</th>
              <th className="st-status">Role</th>
              <th className="st-state">Status</th>
              <th className="st-status">Created</th>
              <th className="st-actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id}>
                <td>{s.full_name || '—'}</td>
                <td>{s.email || '—'}</td>
                <td className="st-vendor">
                  {editingId === s.id ? (
                    <span className="settings-edit">
                      <select
                        className="form-input"
                        value={editingVendorId}
                        onChange={e => setEditingVendorId(e.target.value)}
                        autoFocus
                      >
                        <option value="">Select…</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                      <button type="button" className="btn-xs" onClick={() => saveEdit(s.id)} disabled={!editingVendorId}>Save</button>
                      <button type="button" className="ghost btn-xs" onClick={cancelEdit}>Cancel</button>
                    </span>
                  ) : (s.vendors?.name || <span className="muted">Unassigned</span>)}
                </td>
                <td className="st-status">{roleLabel(s.role)}</td>
                <td className="st-state">
                  {s.must_change_password
                    ? <span className="status-pill warn">Awaiting first login</span>
                    : <span className="status-pill ok">Active</span>}
                </td>
                <td className="st-status">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="st-actions">
                  {editingId !== s.id && (
                    <KebabMenu
                      label={`Actions for ${s.full_name || s.email}`}
                      items={[
                        { label: 'Change vendor…', glyph: '⇄', onClick: () => startEdit(s) },
                        { label: 'Reset password', glyph: '⟲', onClick: () => handleResetPassword(s) },
                        { separator: true },
                        { label: 'Delete staff member', glyph: '✕', danger: true, onClick: () => handleDelete(s) },
                      ]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rowError && <p className="error" style={{ marginTop: '0.75rem' }}>{rowError}</p>}
      {lastReset && (
        <div className="created-card" style={{ marginTop: '0.75rem' }}>
          <strong>Password reset.</strong> Share these new credentials with <em>{lastReset.full_name}</em>:
          <div className="credentials">
            <span>{lastReset.email}</span>
            <span className="st-mono">{lastReset.temp_password}</span>
          </div>
          <button type="button" className="ghost" onClick={() => setLastReset(null)} style={{ marginTop: '0.5rem' }}>Dismiss</button>
        </div>
      )}
    </SettingsCard>
  );
}

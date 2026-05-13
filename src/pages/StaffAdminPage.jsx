import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStaff } from '../hooks/useStaff.js';
import { useVendors } from '../hooks/useVendors.js';
import { generateTempPassword } from '../hooks/useParticipants.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

const ROLE_OPTIONS = [
  { value: 'vendor_manager', label: 'Vendor manager' },
  { value: 'vendor_trainer', label: 'Vendor trainer' },
];

function roleLabel(role) {
  if (role === 'vendor_manager') return 'Manager';
  if (role === 'vendor_trainer' || role === 'trainer') return 'Trainer';
  return role;
}

export default function StaffAdminPage() {
  const { loading, error, staff, createStaff, updateStaffVendor, deleteStaff } = useStaff();
  const { vendors, loading: vendorsLoading } = useVendors();

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
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditingVendorId(s.vendor_id || '');
    setRowError('');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingVendorId('');
    setRowError('');
  }
  async function saveEdit(id) {
    setRowError('');
    if (!editingVendorId) { setRowError('Vendor is required.'); return; }
    const { error: err } = await updateStaffVendor(id, editingVendorId);
    if (err) { setRowError(err.message); return; }
    cancelEdit();
  }

  async function handleDelete(s) {
    setRowError('');
    const who = s.full_name || s.email;
    const msg =
      `Permanently delete ${who} (${s.email})?\n\n` +
      `This deletes both the auth account and the profile. ` +
      `They will no longer be able to log in, and the email is freed up for re-invite. ` +
      `This cannot be undone.`;
    if (!window.confirm(msg)) return;
    const { error: err } = await deleteStaff(s.id);
    if (err) setRowError(err.message);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Staff</h1>
            <p>Add vendor managers and vendor trainers, reassign them between vendors, or remove them.</p>
          </div>
        </section>

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Add a staff member</h2>
          <form onSubmit={handleCreate} className="add-person-form">
            <div className="form-grid">
              <div>
                <label className="form-label">Vendor</label>
                <select
                  className="form-input"
                  required
                  value={vendorId}
                  onChange={e => setVendorId(e.target.value)}
                  disabled={vendorsLoading}
                >
                  <option value="">{vendorsLoading ? 'Loading…' : 'Select a vendor…'}</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Role</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', paddingTop: '0.4rem' }}>
                  {ROLE_OPTIONS.map(opt => (
                    <label key={opt.value} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
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
                <label className="form-label">Email</label>
                <input className="form-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Full name</label>
                <input className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="form-label">Temporary password</label>
                <div className="password-row">
                  <input className="form-input" required value={tempPassword} onChange={e => setTempPassword(e.target.value)} />
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

          {lastCreated && (
            <div className="created-card">
              <strong>Created.</strong> Share these credentials with <em>{lastCreated.full_name}</em> ({roleLabel(lastCreated.role)}):
              <div className="credentials">
                <span>{lastCreated.email}</span>
                <span className="mono">{lastCreated.temp_password}</span>
              </div>
            </div>
          )}
        </section>

        <section className="editor-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>Staff ({filtered.length}{filtered.length !== staff.length ? ` of ${staff.length}` : ''})</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Vendor:</label>
              <select
                className="form-input"
                value={filterVendorId}
                onChange={e => setFilterVendorId(e.target.value)}
                style={{ width: 'auto', minWidth: '12rem' }}
              >
                <option value="all">All vendors</option>
                <option value="unassigned">Unassigned</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          </div>
          {loading && <div className="loading">Loading…</div>}
          {error && <p className="error">{error}</p>}
          {!loading && filtered.length === 0 && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              {staff.length === 0 ? 'No staff yet. Add the first one above.' : 'No staff match this filter.'}
            </p>
          )}
          {!loading && filtered.length > 0 && (
            <table className="participants-table" style={{ marginTop: '0.75rem' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th style={{ width: '10rem' }}>Vendor</th>
                  <th style={{ width: '6rem' }}>Role</th>
                  <th style={{ width: '10rem' }}>Status</th>
                  <th style={{ width: '8rem' }}>Created</th>
                  <th style={{ width: '14rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td>{s.full_name || '—'}</td>
                    <td>{s.email || '—'}</td>
                    <td>
                      {editingId === s.id ? (
                        <select
                          className="form-input"
                          value={editingVendorId}
                          onChange={e => setEditingVendorId(e.target.value)}
                          autoFocus
                        >
                          <option value="">Select…</option>
                          {vendors.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      ) : (
                        s.vendors?.name || <span className="muted">Unassigned</span>
                      )}
                    </td>
                    <td>{roleLabel(s.role)}</td>
                    <td>
                      {s.must_change_password
                        ? <span className="status-pill warn">Awaiting first login</span>
                        : <span className="status-pill ok">Active</span>}
                    </td>
                    <td>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td>
                      {editingId === s.id ? (
                        <>
                          <button type="button" onClick={() => saveEdit(s.id)} disabled={!editingVendorId}>Save</button>
                          <button type="button" className="ghost" onClick={cancelEdit} style={{ marginLeft: '0.5rem' }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="ghost" onClick={() => startEdit(s)}>Edit</button>
                          <button type="button" className="ghost" onClick={() => handleDelete(s)} style={{ marginLeft: '0.5rem' }}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rowError && <p className="error" style={{ marginTop: '0.75rem' }}>{rowError}</p>}
        </section>
      </main>
    </>
  );
}

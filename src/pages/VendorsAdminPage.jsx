import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useVendors, VENDOR_CODE_PATTERN } from '../hooks/useVendors.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function VendorsAdminPage() {
  const { loading, error, vendors, createVendor, renameVendor, deleteVendor } = useVendors();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [rowError, setRowError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { error: err } = await createVendor({ code: code.trim().toUpperCase(), name });
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setCode(''); setName('');
  }

  function startEdit(v) {
    setEditingId(v.id);
    setEditingName(v.name);
    setRowError('');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
    setRowError('');
  }
  async function saveEdit(id) {
    setRowError('');
    const { error: err } = await renameVendor(id, editingName);
    if (err) { setRowError(err.message); return; }
    cancelEdit();
  }

  async function handleDelete(v) {
    setRowError('');
    if (v.trainer_count > 0 || v.session_count > 0) {
      const parts = [];
      if (v.trainer_count > 0) parts.push(`${v.trainer_count} trainer${v.trainer_count === 1 ? '' : 's'}`);
      if (v.session_count > 0) parts.push(`${v.session_count} session${v.session_count === 1 ? '' : 's'}`);
      setRowError(`${v.name} has ${parts.join(' and ')}. Reassign or remove them before deleting this vendor.`);
      return;
    }
    if (!window.confirm(`Delete vendor "${v.name}" (${v.code})? This cannot be undone.`)) return;
    const { error: err } = await deleteVendor(v.id);
    if (err) setRowError(err.message);
  }

  const codeValid = !code || VENDOR_CODE_PATTERN.test(code.trim().toUpperCase());

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Vendors</h1>
            <p>Add vendors, rename them, or remove ones that aren't in use.</p>
          </div>
        </section>

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Add a vendor</h2>
          <form onSubmit={handleCreate} className="add-person-form">
            <div className="form-grid">
              <div>
                <label className="form-label">Code</label>
                <input
                  className="form-input"
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="ETIHAD"
                  maxLength={12}
                  style={{ fontFamily: 'monospace', textTransform: 'uppercase' }}
                />
                <p className="hint">
                  2–12 characters: uppercase letters, digits, underscores. Locked after creation.
                </p>
                {code && !codeValid && (
                  <p className="error" style={{ marginTop: '0.25rem' }}>
                    Use 2–12 chars, A–Z / 0–9 / _ only.
                  </p>
                )}
              </div>
              <div>
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Etihad Airways"
                />
              </div>
            </div>
            {formError && <p className="error">{formError}</p>}
            <div className="form-actions">
              <button type="submit" disabled={busy || !code || !name || !codeValid}>
                {busy ? 'Creating…' : 'Create vendor'}
              </button>
            </div>
          </form>
        </section>

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Vendors ({vendors.length})</h2>
          {loading && <div className="loading">Loading…</div>}
          {error && <p className="error">{error}</p>}
          {!loading && vendors.length === 0 && (
            <p className="muted">No vendors yet. Add the first one above.</p>
          )}
          {!loading && vendors.length > 0 && (
            <table className="participants-table">
              <thead>
                <tr>
                  <th style={{ width: '8rem' }}>Code</th>
                  <th>Name</th>
                  <th style={{ width: '6rem' }}>Trainers</th>
                  <th style={{ width: '6rem' }}>Sessions</th>
                  <th style={{ width: '8rem' }}>Created</th>
                  <th style={{ width: '12rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontFamily: 'monospace' }}>{v.code}</td>
                    <td>
                      {editingId === v.id ? (
                        <input
                          className="form-input"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          autoFocus
                        />
                      ) : (
                        v.name
                      )}
                    </td>
                    <td>{v.trainer_count}</td>
                    <td>{v.session_count}</td>
                    <td>{new Date(v.created_at).toLocaleDateString()}</td>
                    <td>
                      {editingId === v.id ? (
                        <>
                          <button type="button" onClick={() => saveEdit(v.id)} disabled={!editingName.trim()}>
                            Save
                          </button>
                          <button type="button" className="ghost" onClick={cancelEdit} style={{ marginLeft: '0.5rem' }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="ghost" onClick={() => startEdit(v)}>Edit</button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleDelete(v)}
                            style={{ marginLeft: '0.5rem' }}
                          >
                            Delete
                          </button>
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

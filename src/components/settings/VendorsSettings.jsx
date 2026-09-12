import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useVendors, VENDOR_CODE_PATTERN } from '../../hooks/useVendors.js';
import { SettingsCard, NameEditor } from './SettingsCard.jsx';
import KebabMenu from '../KebabMenu.jsx';

// Settings → Vendors. Was its own page in the rail; the same managed-list
// shape as Program types and Cities, so it belongs with them.
//
// Vendors have no order and no active flag: they are deleted, and only when
// nothing points at them — hence Delete rather than Deactivate.
export default function VendorsSettings() {
  const { loading, error, vendors, createVendor, renameVendor, deleteVendor } = useVendors();

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [rowError, setRowError] = useState('');

  const codeValid = !code || VENDOR_CODE_PATTERN.test(code.trim().toUpperCase());

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { error: err } = await createVendor({ code: code.trim().toUpperCase(), name });
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setCode(''); setName('');
    setAdding(false);
  }

  function startEdit(v) { setEditingId(v.id); setEditingName(v.name); setRowError(''); }
  function cancelEdit() { setEditingId(null); setEditingName(''); setRowError(''); }
  async function saveEdit(id) {
    setRowError('');
    const { error: err } = await renameVendor(id, editingName);
    if (err) { setRowError(err.message); return; }
    cancelEdit();
  }

  // Refused rather than cascaded: deleting a vendor that still has trainers or
  // sessions would orphan them.
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

  return (
    <SettingsCard
      title={`Vendors (${vendors.length})`}
      note="Training providers that deliver sessions. A vendor's code is locked after creation; a vendor can only be deleted once no staff or sessions belong to it."
      addLabel="+ Add vendor"
      addOpen={adding}
      onToggleAdd={() => { setAdding(a => !a); setFormError(''); }}
      addForm={(
        <form onSubmit={handleCreate} className="settings-add-form">
          <div className="settings-add-row">
            <label className="form-label" htmlFor="new-vendor-code">Code</label>
            <input
              id="new-vendor-code"
              className="form-input st-mono st-code-input"
              required
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="ETIHAD"
              maxLength={12}
              autoFocus
            />
            <label className="form-label" htmlFor="new-vendor-name">Name</label>
            <input
              id="new-vendor-name"
              className="form-input"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Etihad Airways"
            />
            <button type="submit" disabled={busy || !code || !name || !codeValid}>
              {busy ? 'Creating…' : 'Create vendor'}
            </button>
          </div>
          <p className="hint">2–12 characters: uppercase letters, digits, underscores. Locked after creation.</p>
          {code && !codeValid && <p className="error">Use 2–12 chars, A–Z / 0–9 / _ only.</p>}
          {formError && <p className="error">{formError}</p>}
        </form>
      )}
    >
      {loading && <div className="loading">Loading…</div>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && vendors.length === 0 && (
        <p className="muted">No vendors yet. Add the first one above.</p>
      )}
      {!loading && vendors.length > 0 && (
        <table className="settings-table">
          <thead>
            <tr>
              <th className="st-code">Code</th>
              <th>Name</th>
              <th className="st-num">Trainers</th>
              <th className="st-num">Sessions</th>
              <th className="st-status">Created</th>
              <th className="st-actions" />
            </tr>
          </thead>
          <tbody>
            {vendors.map(v => (
              <tr key={v.id}>
                <td className="st-code st-mono">{v.code}</td>
                <td>
                  {editingId === v.id ? (
                    <NameEditor
                      value={editingName}
                      onChange={setEditingName}
                      onSave={() => saveEdit(v.id)}
                      onCancel={cancelEdit}
                    />
                  ) : v.name}
                </td>
                <td className="st-num">{v.trainer_count}</td>
                {/* The count is also the way in to this vendor's sessions —
                    otherwise that page is reachable only through search. */}
                <td className="st-num">
                  {v.session_count > 0
                    ? <Link to={`/trainer/vendors/${v.id}/sessions`}>{v.session_count}</Link>
                    : v.session_count}
                </td>
                <td className="st-status">{new Date(v.created_at).toLocaleDateString()}</td>
                <td className="st-actions">
                  {editingId !== v.id && (
                    <KebabMenu
                      label={`Actions for ${v.name}`}
                      items={[
                        { label: 'Rename…', glyph: '✎', onClick: () => startEdit(v) },
                        { separator: true },
                        { label: 'Delete vendor', glyph: '✕', danger: true, onClick: () => handleDelete(v) },
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
    </SettingsCard>
  );
}

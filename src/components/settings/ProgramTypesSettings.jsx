import { useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import { useProgramTypes } from '../../hooks/useProgramTypes.js';
import { SettingsCard, OrderButtons, RowActions, NameEditor } from './SettingsCard.jsx';

// Settings → Program types. The list a program is created against and that
// Analytics groups by. Lifted out of SettingsPage so it sits alongside Cities
// and Data retention as one tab among equals.
export default function ProgramTypesSettings() {
  const { loading, error, types, createType, renameType, setActive, moveType } =
    useProgramTypes({ includeInactive: true });

  const [adding, setAdding] = useState(false);
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
    const { error: err } = await createType(name);
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setName('');
    setAdding(false);
  }

  function startEdit(t) { setEditingId(t.id); setEditingName(t.name); setRowError(''); }
  function cancelEdit() { setEditingId(null); setEditingName(''); setRowError(''); }
  async function saveEdit(id) {
    setRowError('');
    const { error: err } = await renameType(id, editingName);
    if (err) { setRowError(err.message); return; }
    cancelEdit();
  }
  async function rowAction(fn) {
    setRowError('');
    const { error: err } = await fn();
    if (err) setRowError(err.message);
  }

  return (
    <SettingsCard
      title="Program types"
      note="Chosen when a program is created, and grouped by in Analytics. Deactivating a type hides it from the picker while keeping it on the programs and sessions that already use it."
      addLabel="+ Add type"
      addOpen={adding}
      onToggleAdd={() => { setAdding(a => !a); setFormError(''); }}
      addForm={(
        <form onSubmit={handleCreate} className="settings-add-form">
          <label className="form-label" htmlFor="new-type">Name</label>
          <div className="settings-add-row">
            <input
              id="new-type"
              className="form-input"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. New joiner"
              maxLength={60}
              autoFocus
            />
            <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add type'}</button>
          </div>
          {formError && <p className="error">{formError}</p>}
        </form>
      )}
    >
      {loading && <SkeletonTable rows={4} label="Loading…" />}
      {error && <p className="error">{error}</p>}
      {!loading && !error && types.length === 0 && (
        <p className="muted">No program types yet. Add the first one above.</p>
      )}
      {!loading && types.length > 0 && (
        <table className="settings-table">
          <thead>
            <tr>
              <th className="st-order">Order</th>
              <th>Name</th>
              <th className="st-status">Status</th>
              <th className="st-actions" />
            </tr>
          </thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={t.id} className={t.is_active ? '' : 'st-inactive'}>
                <td className="st-order">
                  <OrderButtons index={i} count={types.length} onMove={dir => rowAction(() => moveType(t.id, dir))} />
                </td>
                <td>
                  {editingId === t.id ? (
                    <NameEditor
                      value={editingName}
                      onChange={setEditingName}
                      onSave={() => saveEdit(t.id)}
                      onCancel={cancelEdit}
                    />
                  ) : t.name}
                </td>
                <td className="st-status">{t.is_active ? 'Active' : 'Inactive'}</td>
                <td className="st-actions">
                  {editingId !== t.id && (
                    <RowActions
                      label={`Actions for ${t.name}`}
                      isActive={t.is_active}
                      onEdit={() => startEdit(t)}
                      onToggleActive={() => rowAction(() => setActive(t.id, !t.is_active))}
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

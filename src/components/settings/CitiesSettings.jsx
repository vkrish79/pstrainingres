import { useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import { useCities, CITY_CODE_PATTERN } from '../../hooks/useCities.js';
import { SettingsCard, OrderButtons, RowActions, NameEditor } from './SettingsCard.jsx';

// Settings → Cities / venues. Mirrors Program types exactly, but carries an
// immutable `code` — the value stored on every session, which is why it can be
// set once and never renamed.
export default function CitiesSettings() {
  const { loading, error, cities, createCity, renameCity, setActive, moveCity } =
    useCities({ includeInactive: true });

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [rowError, setRowError] = useState('');

  const codeValid = !code || CITY_CODE_PATTERN.test(code.trim().toUpperCase());

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { error: err } = await createCity(code, name);
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setCode(''); setName('');
    setAdding(false);
  }

  function startEdit(c) { setEditingId(c.id); setEditingName(c.name); setRowError(''); }
  function cancelEdit() { setEditingId(null); setEditingName(''); setRowError(''); }
  async function saveEdit(id) {
    setRowError('');
    const { error: err } = await renameCity(id, editingName);
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
      title="Cities / venues"
      note="Picked when a session is created, and grouped by in Analytics. The code is stored on the session and can't change once added; deactivating a city hides it from the picker while keeping it on past sessions."
      addLabel="+ Add city"
      addOpen={adding}
      onToggleAdd={() => { setAdding(a => !a); setFormError(''); }}
      addForm={(
        <form onSubmit={handleCreate} className="settings-add-form">
          <div className="settings-add-row">
            <label className="form-label" htmlFor="new-city-code">Code</label>
            <input
              id="new-city-code"
              className="form-input st-mono st-code-input"
              required
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="AUH"
              maxLength={6}
              autoFocus
            />
            <label className="form-label" htmlFor="new-city-name">Name</label>
            <input
              id="new-city-name"
              className="form-input"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Abu Dhabi"
            />
            <button type="submit" disabled={busy || !code || !name.trim() || !codeValid}>
              {busy ? 'Adding…' : 'Add city'}
            </button>
          </div>
          {code && !codeValid && <p className="error">2–6 characters, A–Z / 0–9 only.</p>}
          {formError && <p className="error">{formError}</p>}
        </form>
      )}
    >
      {loading && <SkeletonTable rows={4} label="Loading…" />}
      {error && <p className="error">{error}</p>}
      {!loading && !error && cities.length === 0 && (
        <p className="muted">No cities yet. Add the first one above.</p>
      )}
      {!loading && cities.length > 0 && (
        <table className="settings-table">
          <thead>
            <tr>
              <th className="st-order">Order</th>
              <th className="st-code">Code</th>
              <th>Name</th>
              <th className="st-status">Status</th>
              <th className="st-actions" />
            </tr>
          </thead>
          <tbody>
            {cities.map((c, i) => (
              <tr key={c.id} className={c.is_active ? '' : 'st-inactive'}>
                <td className="st-order">
                  <OrderButtons index={i} count={cities.length} onMove={dir => rowAction(() => moveCity(c.id, dir))} />
                </td>
                <td className="st-code st-mono">{c.code}</td>
                <td>
                  {editingId === c.id ? (
                    <NameEditor
                      value={editingName}
                      onChange={setEditingName}
                      onSave={() => saveEdit(c.id)}
                      onCancel={cancelEdit}
                    />
                  ) : c.name}
                </td>
                <td className="st-status">{c.is_active ? 'Active' : 'Inactive'}</td>
                <td className="st-actions">
                  {editingId !== c.id && (
                    <RowActions
                      label={`Actions for ${c.name || c.code}`}
                      isActive={c.is_active}
                      onEdit={() => startEdit(c)}
                      onToggleActive={() => rowAction(() => setActive(c.id, !c.is_active))}
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

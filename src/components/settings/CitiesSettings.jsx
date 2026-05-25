import { useState } from 'react';
import { useCities, CITY_CODE_PATTERN } from '../../hooks/useCities.js';

// City/venue managed list for the Settings page. Mirrors the Session Types
// section but carries an immutable `code` (the value stored on sessions).
export default function CitiesSettings() {
  const { loading, error, cities, createCity, renameCity, setActive, moveCity } =
    useCities({ includeInactive: true });

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
    <section className="editor-card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Cities / venues</h2>
      <p className="muted" style={{ marginTop: '-0.25rem' }}>
        Picked when a session is created and reported on in Analytics. The code is stored on the
        session and can't change once added; deactivate to hide a city from the picker while keeping
        it on past sessions.
      </p>

      <form onSubmit={handleCreate} className="add-person-form" style={{ marginTop: '1rem' }}>
        <div className="form-grid">
          <div>
            <label className="form-label">Code</label>
            <input
              className="form-input"
              required
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="AUH"
              maxLength={6}
              style={{ fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase' }}
            />
            {code && !codeValid && (
              <p className="error" style={{ marginTop: '0.25rem' }}>2–6 chars, A–Z / 0–9 only.</p>
            )}
          </div>
          <div>
            <label className="form-label">Name</label>
            <input
              className="form-input"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Abu Dhabi"
            />
          </div>
        </div>
        {formError && <p className="error">{formError}</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy || !code || !name.trim() || !codeValid}>
            {busy ? 'Adding…' : 'Add city'}
          </button>
        </div>
      </form>

      {loading && <div className="loading">Loading…</div>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && cities.length === 0 && (
        <p className="muted">No cities yet. Add the first one above.</p>
      )}
      {!loading && cities.length > 0 && (
        <table className="participants-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th style={{ width: '5rem' }}>Order</th>
              <th style={{ width: '7rem' }}>Code</th>
              <th>Name</th>
              <th style={{ width: '7rem' }}>Status</th>
              <th style={{ width: '16rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cities.map((c, i) => (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.55 }}>
                <td>
                  <button type="button" className="ghost" title="Move up" disabled={i === 0}
                    onClick={() => rowAction(() => moveCity(c.id, 'up'))}>↑</button>
                  <button type="button" className="ghost" title="Move down" disabled={i === cities.length - 1}
                    onClick={() => rowAction(() => moveCity(c.id, 'down'))} style={{ marginLeft: '0.25rem' }}>↓</button>
                </td>
                <td style={{ fontFamily: 'ui-monospace, monospace' }}>{c.code}</td>
                <td>
                  {editingId === c.id ? (
                    <input className="form-input" value={editingName} onChange={e => setEditingName(e.target.value)} autoFocus />
                  ) : c.name}
                </td>
                <td>{c.is_active ? 'Active' : 'Inactive'}</td>
                <td>
                  {editingId === c.id ? (
                    <>
                      <button type="button" onClick={() => saveEdit(c.id)} disabled={!editingName.trim()}>Save</button>
                      <button type="button" className="ghost" onClick={cancelEdit} style={{ marginLeft: '0.5rem' }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ghost" onClick={() => startEdit(c)}>Edit</button>
                      <button type="button" className="ghost" onClick={() => rowAction(() => setActive(c.id, !c.is_active))} style={{ marginLeft: '0.5rem' }}>
                        {c.is_active ? 'Deactivate' : 'Activate'}
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
  );
}

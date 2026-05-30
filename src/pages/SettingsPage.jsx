import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProgramTypes } from '../hooks/useProgramTypes.js';
import CitiesSettings from '../components/settings/CitiesSettings.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

// Super-tier settings hub. Today it holds the Session Types managed list; more
// app-level settings sections can be added here as plain <section> cards.
export default function SettingsPage() {
  const { loading, error, types, createType, renameType, setActive, moveType } =
    useProgramTypes({ includeInactive: true });

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
  }

  function startEdit(t) {
    setEditingId(t.id);
    setEditingName(t.name);
    setRowError('');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
    setRowError('');
  }
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
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Settings</h1>
            <p>App-level configuration. Changes here apply across all vendors and trainers.</p>
          </div>
        </section>

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Program types</h2>
          <p className="muted" style={{ marginTop: '-0.25rem' }}>
            Chosen when a program is created and reported on in Analytics. Deactivate a type to
            hide it from the picker while keeping it on the programs and sessions that already used it.
          </p>

          <form onSubmit={handleCreate} className="add-person-form" style={{ marginTop: '1rem' }}>
            <label className="form-label">Add a program type</label>
            <div className="form-grid">
              <input
                className="form-input"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. New joiner"
                maxLength={60}
              />
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={busy || !name.trim()}>
                  {busy ? 'Adding…' : 'Add type'}
                </button>
              </div>
            </div>
            {formError && <p className="error">{formError}</p>}
          </form>

          {loading && <div className="loading">Loading…</div>}
          {error && <p className="error">{error}</p>}
          {!loading && !error && types.length === 0 && (
            <p className="muted">No program types yet. Add the first one above.</p>
          )}
          {!loading && types.length > 0 && (
            <table className="participants-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th style={{ width: '5rem' }}>Order</th>
                  <th>Name</th>
                  <th style={{ width: '7rem' }}>Status</th>
                  <th style={{ width: '16rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t, i) => (
                  <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <button
                        type="button"
                        className="ghost"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => rowAction(() => moveType(t.id, 'up'))}
                      >↑</button>
                      <button
                        type="button"
                        className="ghost"
                        title="Move down"
                        disabled={i === types.length - 1}
                        onClick={() => rowAction(() => moveType(t.id, 'down'))}
                        style={{ marginLeft: '0.25rem' }}
                      >↓</button>
                    </td>
                    <td>
                      {editingId === t.id ? (
                        <input
                          className="form-input"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          autoFocus
                        />
                      ) : (
                        t.name
                      )}
                    </td>
                    <td>{t.is_active ? 'Active' : 'Inactive'}</td>
                    <td>
                      {editingId === t.id ? (
                        <>
                          <button type="button" onClick={() => saveEdit(t.id)} disabled={!editingName.trim()}>
                            Save
                          </button>
                          <button type="button" className="ghost" onClick={cancelEdit} style={{ marginLeft: '0.5rem' }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="ghost" onClick={() => startEdit(t)}>Edit</button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => rowAction(() => setActive(t.id, !t.is_active))}
                            style={{ marginLeft: '0.5rem' }}
                          >
                            {t.is_active ? 'Deactivate' : 'Activate'}
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

        <CitiesSettings />
      </main>
    </>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { usePrograms } from '../hooks/usePrograms.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function ProgramsListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, programs, createProgram } = usePrograms();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await runBusy(
      'Creating program…',
      () => createProgram({ title, created_by: authSession?.user.id })
    );
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setTitle('');
    if (data?.id) navigate(`/trainer/programs/${data.id}`);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Programs</h1>
            <p>
              A program bundles a workbook, an assessment, and reference materials (handouts, quick-ref
              guides). Sessions are created from a published program — but that flow lands in a later release.
            </p>
          </div>
        </section>

        <section className="editor-card">
          <form onSubmit={handleCreate} className="add-person-form">
            <label className="form-label">Create a program</label>
            <div className="form-grid">
              <input
                className="form-input"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. New joiner — Foundation"
                maxLength={120}
              />
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={busy || !title.trim()}>
                  {busy ? 'Creating…' : 'Create program'}
                </button>
              </div>
            </div>
            {formError && <p className="error">{formError}</p>}
          </form>
        </section>

        {loading && <div className="loading">Loading…</div>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && programs.length === 0 && (
          <p className="muted">No programs yet. Create the first one above.</p>
        )}
        {!loading && programs.length > 0 && (
          <div className="session-grid">
            {programs.map(p => (
              <Link key={p.id} to={`/trainer/programs/${p.id}`} className="session-card" style={{ display: 'block' }}>
                <div className="session-card-head">
                  <h3>{p.title}</h3>
                  <span className="city-tag">{p.status === 'published' ? 'Published' : 'Draft'}</span>
                </div>
                {p.description && <p className="session-card-workbook">{p.description}</p>}
                <p className="session-card-meta">
                  {p.program_type?.name || 'No type'} · Updated {new Date(p.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

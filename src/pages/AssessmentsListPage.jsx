import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAssessments } from '../hooks/useAssessments.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function AssessmentsListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, assessments, createAssessment } = useAssessments();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await runBusy(
      'Creating assessment…',
      () => createAssessment({ title, created_by: authSession?.user.id }),
    );
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setTitle('');
    if (data?.id) navigate(`/trainer/assessments/${data.id}`);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Assessments</h1>
            <p>
              An assessment is the post-program test: same block model as a workbook (prose, fields, tables),
              attached to one program at a time. Program-internal — vendors and participants don't see assessments here.
            </p>
          </div>
          <div className="page-hero-actions">
            <Link to="/trainer/assessments/import" className="ghost-link">↑ Import .docx</Link>
          </div>
        </section>

        <section className="editor-card">
          <form onSubmit={handleCreate} className="add-person-form">
            <label className="form-label">Create an assessment</label>
            <div className="form-grid">
              <input
                className="form-input"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. New joiner — Foundation assessment"
                maxLength={120}
              />
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={busy || !title.trim()}>
                  {busy ? 'Creating…' : 'Create assessment'}
                </button>
              </div>
            </div>
            {formError && <p className="error">{formError}</p>}
          </form>
        </section>

        {loading && <div className="loading">Loading…</div>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && assessments.length === 0 && (
          <p className="muted">No assessments yet. Create the first one above.</p>
        )}
        {!loading && assessments.length > 0 && (
          <div className="session-grid">
            {assessments.map(a => (
              <Link key={a.id} to={`/trainer/assessments/${a.id}`} className="session-card" style={{ display: 'block' }}>
                <div className="session-card-head">
                  <h3>{a.title}</h3>
                  <span className="city-tag">
                    {a.program ? `Attached: ${a.program.title}` : 'Unattached'}
                  </span>
                </div>
                {a.description && <p className="session-card-workbook">{a.description}</p>}
                <p className="session-card-meta">
                  Updated {new Date(a.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

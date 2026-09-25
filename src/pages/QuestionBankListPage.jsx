import { useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAssessments } from '../hooks/useAssessments.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

// The question bank library. A bank is an assessments row with kind='bank', so
// this is the assessments list page with one filter changed — which is the point
// of storing it that way.
export default function QuestionBankListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, assessments: banks, createAssessment } = useAssessments({ kind: 'bank' });

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await runBusy(
      'Creating question bank…',
      () => createAssessment({ title, created_by: authSession?.user.id }),
    );
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setTitle('');
    if (data?.id) navigate(`/trainer/question-bank/${data.id}`);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="editor-card">
          <form onSubmit={handleCreate} className="add-person-form">
            <label className="form-label">Create a question bank</label>
            <p className="hint" style={{ marginTop: 0 }}>
              A pool of questions to build assessments from. Write a question once here, then pick it
              into as many assessments as you like — its marking scheme travels with it.
            </p>
            <div className="form-grid">
              <input
                className="form-input"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Reservations & Ticketing — question bank"
                maxLength={120}
              />
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={busy || !title.trim()}>
                  {busy ? 'Creating…' : 'Create question bank'}
                </button>
              </div>
            </div>
            {formError && <p className="error">{formError}</p>}
          </form>
        </section>

        {loading && <SkeletonCards count={4} label="Loading question banks…" />}
        {error && <p className="error">{error}</p>}
        {!loading && !error && banks.length === 0 && (
          <p className="muted">No question banks yet. Create the first one above.</p>
        )}
        {!loading && banks.length > 0 && (
          <div className="session-grid">
            {banks.map(b => (
              <Link
                key={b.id}
                to={`/trainer/question-bank/${b.id}`}
                className="session-card"
                style={{ display: 'block' }}
              >
                <div className="session-card-head">
                  <h3>{b.title}</h3>
                </div>
                {b.description && <p className="session-card-workbook">{b.description}</p>}
                <p className="session-card-meta">
                  Updated {new Date(b.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

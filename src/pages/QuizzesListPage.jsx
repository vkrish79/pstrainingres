import { useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useQuizzes } from '../hooks/useQuizzes.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/quiz.css';

export default function QuizzesListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, quizzes, createQuiz } = useQuizzes();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await runBusy(
      'Creating quiz…',
      () => createQuiz({ title, created_by: authSession?.user.id }),
    );
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setTitle('');
    // Straight into the editor: a quiz with no questions is not a thing anyone
    // wants to look at in a list.
    if (data?.id) navigate(`/trainer/quizzes/${data.id}`);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        {/* No hero — the app bar and the rail both say Quizzes. */}
        <section className="editor-card">
          <form onSubmit={handleCreate} className="add-person-form">
            <label className="form-label">Create a quiz</label>
            <div className="form-grid">
              <input
                className="form-input"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Day 1 — fares recap"
                maxLength={120}
              />
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={busy || !title.trim()}>
                  {busy ? 'Creating…' : 'Create quiz'}
                </button>
              </div>
            </div>
            {formError && <p className="error">{formError}</p>}
          </form>
        </section>

        {loading && <SkeletonCards count={6} label="Loading quizzes…" />}
        {error && <p className="error">{error}</p>}
        {!loading && !error && quizzes.length === 0 && (
          <p className="muted">No quizzes yet. Create the first one above.</p>
        )}
        {!loading && quizzes.length > 0 && (
          <div className="session-grid">
            {quizzes.map(q => (
              <Link key={q.id} to={`/trainer/quizzes/${q.id}`} className="session-card" style={{ display: 'block' }}>
                <div className="session-card-head">
                  <h3>{q.title}</h3>
                  <span className="city-tag">{q.vendor ? q.vendor.name : 'All trainers'}</span>
                </div>
                <p className="session-card-workbook">
                  {q.question_count === 0
                    ? 'No questions yet'
                    : `${q.question_count} question${q.question_count === 1 ? '' : 's'}`}
                </p>
                <p className="session-card-meta">
                  Updated {new Date(q.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

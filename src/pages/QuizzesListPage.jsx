import { useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useQuizzes } from '../hooks/useQuizzes.js';
import { useStandaloneRun } from '../hooks/useStandaloneRun.js';
import QuizProjector from '../components/quiz/QuizProjector.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/quiz.css';

export default function QuizzesListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, quizzes, createQuiz } = useQuizzes();
  const { live, start, end } = useStandaloneRun();
  // The projector, opened over this page. Not a route: a run is not a place
  // you can navigate back to, and a browser Back button that drops a trainer
  // out of a live room mid-question is not a thing worth having.
  const [running, setRunning] = useState(null);

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Straight to the screen: the lobby has its own Start button, so a click
  // here commits to nothing except putting a code on a wall.
  async function runNow(quizId) {
    setFormError('');
    const { data, error: err } = await runBusy('Opening the room…', () => start(quizId));
    if (err) { setFormError(err.message); return; }
    setRunning({ runId: data.runId, joinCode: data.joinCode });
  }

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

  if (running) {
    return (
      <QuizProjector
        runId={running.runId}
        joinCode={running.joinCode}
        guestRun
        /* Closing the projector does NOT end the run — the projector asks
           about that itself, and a trainer who steps away to look something
           up comes back through the bar below. */
        onExit={() => setRunning(null)}
      />
    );
  }

  return (
    <>
      <TopBar />
      <main className="page">
        {/* No hero — the app bar and the rail both say Quizzes. */}

        {/* A RUN YOU LEFT OPEN. Closing the tab ends nothing: the code still
            works and a room full of phones is still in it. This is the only
            place that says so, and it carries the only two things anyone
            wants — back to it, or end it. */}
        {live && (
          <div className="quiz-live-bar">
            <span className="quiz-live-dot" aria-hidden="true" />
            <span className="quiz-live-title">{live.quiz_title} is running</span>
            <span className="quiz-live-meta">
              {live.players} joined · {live.phase === 'lobby' ? 'waiting to start' : 'under way'} · code {live.join_code}
            </span>
            <span className="quiz-live-actions">
              <button
                type="button"
                onClick={() => setRunning({ runId: live.run_id, joinCode: live.join_code })}
              >
                Back to the screen
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => runBusy('Ending the quiz…', () => end(live.run_id))}
              >
                End it
              </button>
            </span>
          </div>
        )}
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
              <div key={q.id} className="session-card quiz-card">
                {/* The card is no longer one big link: a button inside an anchor
                    is a button you cannot reliably click, and Run now has to be
                    clickable. The title is the link instead. */}
                <div className="session-card-head">
                  <h3><Link to={`/trainer/quizzes/${q.id}`}>{q.title}</Link></h3>
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
                <div className="quiz-card-actions">
                  {/* Nothing to run until there is a question to ask. */}
                  <button
                    type="button"
                    disabled={q.question_count === 0}
                    onClick={() => runNow(q.id)}
                    title={q.question_count === 0
                      ? 'Add a question first'
                      : 'Open a room for this quiz — people join by scanning a code'}
                  >
                    Run now
                  </button>
                  <Link to={`/trainer/quizzes/${q.id}`} className="ghost-link">Edit</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

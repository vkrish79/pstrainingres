import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useSessionQuizzes } from '../../hooks/useSessionQuizzes.js';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import QuizProjector from '../quiz/QuizProjector.jsx';
import '../../styles/quiz.css';

// The Quiz tab on a session. Add a quiz from the library, edit this session's
// own copy, remove it. Running it lands next.
export default function SessionQuizzes({ sessionId }) {
  const { loading, error, attached, library, attach, remove } = useSessionQuizzes(sessionId);
  const { run: runBusy } = useBusyOverlay();
  const [pick, setPick] = useState('');
  const [rowError, setRowError] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [runId, setRunId] = useState(null);

  // quiz_start_run returns the new run's id. It also snapshots the roster and
  // closes any run still open on this session, in one transaction — see
  // 20260916000006_quiz_run.sql.
  async function handleRun(quizId) {
    setRowError('');
    const { data, error: err } = await runBusy('Starting the quiz…', () =>
      supabase.rpc('quiz_start_run', { p_quiz_id: quizId, p_session_id: sessionId }));
    if (err) { setRowError(err.message); return; }
    if (!data) { setRowError('The quiz did not start.'); return; }
    setRunId(data);
  }

  async function handleAttach(e) {
    e.preventDefault();
    setRowError('');
    if (!pick) return;
    const { error: err } = await runBusy('Adding the quiz…', () => attach(pick));
    if (err) { setRowError(err.message); return; }
    setPick('');
  }

  async function handleRemove(id) {
    setRowError('');
    setConfirming(null);
    const { error: err } = await runBusy('Removing…', () => remove(id));
    if (err) setRowError(err.message);
  }

  // Already-added titles, so the picker can say so rather than letting someone
  // add the same quiz twice and wonder which is which on the day.
  const addedTitles = new Set(attached.map(q => q.title));

  // The projector takes the whole screen. Rendered here rather than routed to
  // so that closing it returns the trainer to the tab they launched from, with
  // the session still loaded behind it.
  if (runId) return <QuizProjector runId={runId} onExit={() => setRunId(null)} />;

  return (
    <section className="quiz-tab">
      {loading && <div className="loading">Loading…</div>}
      {error && <p className="error">{error}</p>}
      {rowError && <p className="error">{rowError}</p>}

      {!loading && (
        <>
          {attached.length === 0 ? (
            <p className="muted">
              No quiz on this session yet. Add one from the library below — you get your
              own copy, so you can reword it for this room without changing the original.
            </p>
          ) : (
            <ul className="quiz-attached">
              {attached.map(q => (
                <li key={q.id} className="quiz-attached-row">
                  <div className="quiz-attached-main">
                    <span className="quiz-attached-title">{q.title}</span>
                    <span className="muted">
                      {q.question_count === 0
                        ? 'No questions'
                        : `${q.question_count} question${q.question_count === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="quiz-attached-tools">
                    {/* Running an empty quiz would open a blank projector in
                        front of the room; the database refuses it too. */}
                    <button
                      type="button"
                      className="quiz-run-btn"
                      disabled={q.question_count === 0}
                      title={q.question_count === 0 ? 'Add a question first' : 'Show this on the projector'}
                      onClick={() => handleRun(q.id)}
                    >
                      ▶ Run
                    </button>
                    <Link to={`/trainer/quizzes/${q.id}`} className="ghost-link">Edit</Link>
                    {confirming === q.id ? (
                      <>
                        <span className="muted">Remove it?</span>
                        <button type="button" onClick={() => handleRemove(q.id)}>Yes, remove</button>
                        <button type="button" className="ghost" onClick={() => setConfirming(null)}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className="ghost" onClick={() => setConfirming(q.id)}>Remove</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAttach} className="quiz-attach-form">
            <label className="form-label" htmlFor="quiz-pick">Add a quiz from the library</label>
            <div className="quiz-attach-row">
              <select
                id="quiz-pick"
                className="form-input"
                value={pick}
                onChange={e => setPick(e.target.value)}
              >
                <option value="">Choose a quiz…</option>
                {library.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                    {q.question_count ? ` — ${q.question_count} question${q.question_count === 1 ? '' : 's'}` : ' — no questions yet'}
                    {addedTitles.has(q.title) ? ' (already added)' : ''}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!pick}>Add to session</button>
            </div>
            {library.length === 0 && (
              <p className="muted">
                The library is empty. <Link to="/trainer/quizzes">Build a quiz</Link> first.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}

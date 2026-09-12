import { useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { usePolls, padOptions, filledAnswers, pollIsReady, POLL_SLOTS } from '../hooks/usePolls.js';
import QuizShape from '../components/quiz/QuizShape.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/poll.css';

// The poll library — write them here, ask them from a session.
//
// EDITED IN PLACE, with no second route. A quiz earns its own editor page
// because it is many questions with a key, an image and a timer each. A poll is
// one question and four short answers; sending the trainer to another screen to
// type five boxes would be ceremony, not structure.
export default function PollsListPage() {
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, polls, createPoll, savePoll, deletePoll } = usePolls();

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(null);   // poll id being edited
  const [draft, setDraft] = useState(null);       // { question, options[4] }
  const [rowError, setRowError] = useState('');
  const [confirming, setConfirming] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await runBusy('Creating poll…', () =>
      createPoll({ question, created_by: authSession?.user.id }));
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setQuestion('');
    // Straight into editing it: a poll with no answers cannot be asked, so
    // there is exactly one useful next action and this is it.
    if (data?.id) openEditor({ id: data.id, question: question.trim(), options: padOptions([]) });
  }

  function openEditor(p) {
    setRowError('');
    setEditing(p.id);
    setDraft({ question: p.question ?? '', options: padOptions(p.options) });
  }

  function setAnswer(i, value) {
    setDraft(d => {
      const options = [...d.options];
      options[i] = value;
      return { ...d, options };
    });
  }

  async function handleSave(id) {
    setRowError('');
    const { error: err } = await runBusy('Saving…', () => savePoll(id, draft));
    if (err) { setRowError(err.message); return; }
    setEditing(null);
    setDraft(null);
  }

  async function handleDelete(id) {
    setRowError('');
    setConfirming(null);
    const { error: err } = await runBusy('Deleting…', () => deletePoll(id));
    if (err) setRowError(err.message);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="editor-card">
          <form onSubmit={handleCreate} className="add-person-form">
            <label className="form-label">Write a poll</label>
            <div className="form-grid">
              <input
                className="form-input"
                required
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. How confident are you creating a PNR with pricing?"
                maxLength={200}
              />
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={busy || !question.trim()}>
                  {busy ? 'Creating…' : 'Create poll'}
                </button>
              </div>
            </div>
            <p className="muted">
              One question, no right answer, up to four answers. You ask it from inside a
              session — the room votes on their phones and the result goes up on the wall.
            </p>
            {formError && <p className="error">{formError}</p>}
          </form>
        </section>

        {loading && <SkeletonCards count={3} label="Loading polls…" />}
        {error && <p className="error">{error}</p>}
        {rowError && <p className="error">{rowError}</p>}

        {!loading && polls.length === 0 && (
          <p className="muted">No polls yet.</p>
        )}

        <ul className="poll-cards">
          {polls.map((p) => {
            const isEditing = editing === p.id;
            const answers = filledAnswers(p.options);
            const ready = pollIsReady(p);
            return (
              <li key={p.id} className={`poll-card${ready ? '' : ' is-unfinished'}`}>
                {!isEditing ? (
                  <>
                    <div className="poll-card-head">
                      <span className="poll-card-q">
                        {p.question || <em className="muted">No question yet</em>}
                      </span>
                      {/* CASE 06: unfinished is visible in the list, not only
                          discovered when the trainer tries to ask it. */}
                      {!ready && <span className="poll-flag">Unfinished</span>}
                    </div>
                    {answers.length > 0 ? (
                      <ol className="poll-card-answers">
                        {answers.map((a, i) => (
                          <li key={i}>
                            <span className={`poll-badge poll-opt-${i}`}><QuizShape index={i} title={a} /></span>
                            {a}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="muted">No answers written yet.</p>
                    )}
                    <div className="poll-card-tools">
                      <button type="button" onClick={() => openEditor(p)}>Edit</button>
                      {confirming === p.id ? (
                        <>
                          <span className="muted">Delete it?</span>
                          <button type="button" onClick={() => handleDelete(p.id)}>Yes, delete</button>
                          <button type="button" className="ghost" onClick={() => setConfirming(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="ghost" onClick={() => setConfirming(p.id)}>Delete</button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="poll-edit">
                    <label className="form-label" htmlFor={`q-${p.id}`}>Question</label>
                    <input
                      id={`q-${p.id}`}
                      className="form-input"
                      value={draft.question}
                      maxLength={200}
                      onChange={e => setDraft(d => ({ ...d, question: e.target.value }))}
                    />

                    <label className="form-label">Answers</label>
                    {/* Four slots always. Blanks are stripped when the poll is
                        fired, so leaving two empty gives the room two shapes. */}
                    {Array.from({ length: POLL_SLOTS }, (_, i) => (
                      <div className="poll-edit-answer" key={i}>
                        <span className={`poll-badge poll-opt-${i}`}><QuizShape index={i} /></span>
                        <input
                          className="form-input"
                          value={draft.options[i]}
                          maxLength={80}
                          placeholder={i < 2 ? 'Required' : 'Optional'}
                          onChange={e => setAnswer(i, e.target.value)}
                        />
                      </div>
                    ))}

                    <p className="muted">
                      {filledAnswers(draft.options).length < 2
                        ? 'A poll needs at least two answers before it can be asked.'
                        : 'Leave the rest blank and only the written answers appear in the room.'}
                    </p>

                    <div className="poll-card-tools">
                      <button type="button" onClick={() => handleSave(p.id)}>Save</button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => { setEditing(null); setDraft(null); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

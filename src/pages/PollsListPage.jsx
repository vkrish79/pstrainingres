import { useMemo, useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { usePolls, padOptions, filledAnswers, pollIsReady, POLL_SLOTS } from '../hooks/usePolls.js';
import QuizShape from '../components/quiz/QuizShape.jsx';
import CreateDialog from '../components/library/CreateDialog.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/poll.css';

// The poll library — write them here, ask them from a session.
//
// EDITED IN PLACE, with no second route. A quiz earns its own editor page
// because it is many questions with a key, an image and a timer each. A poll is
// one question and six short answers; sending the trainer to another screen to
// type seven boxes would be ceremony, not structure.
//
// IN THE COCKPIT, like Workbooks, Assessments, Programs, Quizzes and the
// question bank. Same classes, not a sixth visual language: a compact hero
// carrying counted tabs and the actions, then the grid. This page was the last
// one still on the old shape — no hero, no counts, no search, and a full-width
// "Write a poll" band that owned the top of the screen whether or not anybody
// was writing one.
//
// BUT NO GAUGE STRIP. The other five earn one because they have facts worth a
// tile — sections to review, prep running out, classes running today. A poll
// has none of that. The only fact that changes what you can do with one is
// whether it has two answers yet, and that is already on a tab and on the
// card; four tiles restating it would be cards for the sake of cards.
//
// THE CARD SAYS NOTHING ABOUT ANSWERS, and that is a decision rather than an
// omission. The library is a list of questions you might ask; which shapes are
// on the wall and how many of them there are is a property of the run, not of
// the question, and it is not what you are scanning for when you are looking
// for a poll. The answers are one click away in the editor, and "Unfinished" —
// which is the only fact about them that changes what you can DO — is still on
// the card.
export default function PollsListPage() {
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, polls, createPoll, savePoll, deletePoll } = usePolls();

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(null);   // poll id being edited
  const [draft, setDraft] = useState(null);       // { question, options[6] }
  const [rowError, setRowError] = useState('');
  const [confirming, setConfirming] = useState(null);
  // The write box is BEHIND THE BUTTON now. It used to be a permanent band
  // about 150px deep at the top of the page — a form that was open all day for
  // the few minutes a month anybody types in it.
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('all');    // all | ready | unfinished
  const [find, setFind] = useState('');

  // Just the two tab counts. This used to also find the most recently edited
  // poll for a "Last edited" gauge; the gauges are gone, so that work is gone
  // with them rather than left computing a number nothing reads.
  const stats = useMemo(() => {
    let ready = 0;
    for (const p of polls) if (pollIsReady(p)) ready += 1;
    return { ready, unfinished: polls.length - ready };
  }, [polls]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return polls.filter(p => {
      // NEVER HIDE WHAT IS OPEN IN A FORM. The editor renders inside the poll's
      // own <li>, so a filter that excludes the row unmounts the form the
      // trainer is typing in. Two ways in, both easy to hit:
      //   • "Ready to ask" is on, you create a poll — a new poll has no answers,
      //     so it is not ready, so the row it would have been edited in never
      //     renders and the poll looks like it vanished.
      //   • You are mid-edit and you type in the search box.
      // The state survives either way, but a form disappearing under you reads
      // as a crash, so it stays on screen until it is saved or cancelled.
      if (p.id === editing) return true;
      const ready = pollIsReady(p);
      if (filter === 'ready' && !ready) return false;
      if (filter === 'unfinished' && ready) return false;
      // Searching the ANSWERS as well as the question, even though the card
      // does not show them: "the one with 'Completely' in it" is a real way to
      // remember a poll, and hiding a field is not a reason to stop finding by
      // it.
      if (!q) return true;
      return [p.question, ...filledAnswers(p.options)]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [polls, filter, find, editing]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    const { data, error: err } = await runBusy('Creating poll…', () =>
      createPoll({ question, created_by: authSession?.user.id }));
    setBusy(false);
    if (err) { setFormError(err.message); return; }
    setQuestion('');
    setAdding(false);
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
      <main className="page dashboard library-page">
        {/* NO PAGE HEADING. The rail says Polls and so does the app bar — which
            it did not until the route was added to TopBar's SECTIONS; this page
            used to fall through to the catch-all and announce itself as
            Sessions. The hero carries controls only. */}
        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show polls">
              {[
                ['all', 'All', polls.length],
                ['ready', 'Ready to ask', stats.ready],
                ['unfinished', 'Unfinished', stats.unfinished],
              ].map(([k, label, count]) => (
                <button
                  key={k}
                  type="button"
                  className={`view-tab${filter === k ? ' active' : ''}${k === 'unfinished' && count > 0 ? ' is-warn' : ''}`}
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {label} <em className="view-tab-count">{count}</em>
                </button>
              ))}
            </div>
            <div className="page-hero-actions">
              <input
                type="search"
                className="form-input wb-find"
                placeholder="Find a poll…"
                aria-label="Find a poll"
                value={find}
                onChange={e => setFind(e.target.value)}
              />
              {!adding && (
                <button type="button" className="lib-new-btn" onClick={() => setAdding(true)}>
                  + New poll
                </button>
              )}
            </div>
          </div>
        </section>

        {loading && <SkeletonCards count={3} label="Loading polls…" />}
        {error && <p className="error">{error}</p>}
        {rowError && <p className="error">{rowError}</p>}

        {/* NO GAUGE STRIP, and that is a decision. The other library pages earn
            one because they have facts worth a tile — sections to review, prep
            running out, classes running today. A poll has none of that: the
            only thing that changes what you can do with it is whether it has
            two answers yet, and that is already on the tab and on the card.
            Four tiles saying "1" would be cards for the sake of cards. */}

        {/* The sentence that used to sit under the permanent write band. It is
            worth saying once, to somebody who has never asked a poll — and
            nowhere else, to everybody who has. */}
        {!loading && !error && polls.length === 0 && (
          <p className="cockpit-empty">
            No polls yet. One question, no right answer, up to six answers —
            you ask it from inside a session and the room votes on their phones.
          </p>
        )}

        {!loading && polls.length > 0 && shown.length === 0 && (
          <p className="cockpit-empty">Nothing here with this filter.</p>
        )}

        <ul className="poll-cards">
          {shown.map((p) => {
            const isEditing = editing === p.id;
            const ready = pollIsReady(p);
            return (
              <li key={p.id} className={`poll-card${ready ? '' : ' is-unfinished'}${isEditing ? ' is-editing' : ''}`}>
                {!isEditing ? (
                  <>
                    <div className="poll-card-head">
                      <span className="poll-card-q">
                        {p.question || <em className="muted">No question yet</em>}
                      </span>
                      {/* CASE 06: unfinished is visible in the list, not only
                          discovered when the trainer tries to ask it. With the
                          answers off the card this is the ONLY thing standing
                          between the trainer and a poll that cannot be fired,
                          so it stays. */}
                      {!ready && <span className="poll-flag">Unfinished</span>}
                    </div>
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
                    {/* Six slots always. Blanks are stripped when the poll is
                        fired, so leaving four empty gives the room two shapes.
                        THIS is where the answers live now — the card does not
                        repeat them. */}
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

        {/* THE SAME DOOR AS WORKBOOKS, ASSESSMENTS AND PROGRAMS. Creating used
            to be an inline field here, which is exactly the inconsistency
            CreateDialog was written to end — one shell, one animation, Esc and
            the focus behaviour all handled once. Polls pass no importTo: there
            is no .docx to import a poll from. */}
        {adding && (
          <CreateDialog
            heading="New poll"
            blurb="One question, no right answer, up to six answers. You ask it from inside a session — the room votes on their phones and the result goes up on the wall."
            submitLabel="Create poll"
            busy={busy}
            error={formError}
            canSubmit={!!question.trim()}
            onClose={() => { setAdding(false); setQuestion(''); setFormError(''); }}
            onSubmit={handleCreate}
          >
            <div>
              <label className="form-label" htmlFor="new-poll-q">Question</label>
              <input
                id="new-poll-q"
                className="form-input"
                placeholder="e.g. How confident are you creating a PNR with pricing?"
                value={question}
                maxLength={200}
                onChange={e => setQuestion(e.target.value)}
              />
            </div>
          </CreateDialog>
        )}
      </main>
    </>
  );
}

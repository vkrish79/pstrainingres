import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useQuizzes } from '../hooks/useQuizzes.js';
import { useStandaloneRun } from '../hooks/useStandaloneRun.js';
import { shortDate } from '../lib/programReadiness.js';
import QuizProjector from '../components/quiz/QuizProjector.jsx';
import QuizRehearsal from '../components/quiz/QuizRehearsal.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/quiz.css';

// The quiz library, in the cockpit — the same shell Workbooks, Assessments and
// the Question Bank already share, down to the class names: a compact hero
// carrying the filters and the actions, a gauge strip, a grid of cards that are
// each ONE control, and the details in a slide-over.
//
// WHAT THE GAUGES ANSWER. Not "what quizzes are there" — the titles were never
// in doubt — but "which of these can I actually put in front of a room on
// Monday". So the organising fact is whether a quiz is finished: a question
// with no correct answer set cannot be marked, which makes the quiz carrying
// it unrunnable however good it looks in the grid.
//
// WHAT IS DELIBERATELY ABSENT is anything about when a quiz was last run. A
// session's quiz is a COPY frozen at attach time (project_quiz_attach_snapshot
// _trap), so quiz_runs rows point at copies and not at the template they came
// from — a "never run" badge would be wrong for every quiz that has only ever
// been delivered inside a session, which is most of them. A badge that lies is
// worse than a badge that is missing.
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
  // The rehearsal, same reasoning and one further one — it holds a score and a
  // position in the quiz, and neither survives a navigation.
  const [rehearsing, setRehearsing] = useState(null);

  const [filter, setFilter] = useState('all');   // all | ready | empty | unfinished
  const [find, setFind] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // MOUNT AND OPEN ARE SEPARATE, one pair of frames apart. A CSS transition
  // needs a previous state to travel from, so a panel rendered already open
  // simply appears; and clearing the selection on close would unmount it
  // before it could travel back.
  const [railOpen, setRailOpen] = useState(false);

  // Creating a quiz is a few-times-a-term job, so the form is a button until
  // it is wanted. It used to sit permanently open above the library.
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const stats = useMemo(() => {
    let questions = 0;
    let wagers = 0;
    let unfinished = 0;
    let unfinishedQuizzes = 0;
    let longest = null;
    for (const q of quizzes) {
      questions += q.question_count;
      wagers += q.wager_count;
      if (q.unfinished_count > 0) { unfinished += q.unfinished_count; unfinishedQuizzes += 1; }
      if (q.question_count > 0 && (!longest || q.play_seconds > longest.play_seconds)) longest = q;
    }
    return { questions, wagers, unfinished, unfinishedQuizzes, longest };
  }, [quizzes]);

  const empty = quizzes.filter(q => q.question_count === 0).length;
  const ready = quizzes.filter(q => q.question_count > 0 && q.unfinished_count === 0).length;

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return quizzes.filter(q => {
      if (filter === 'ready' && !(q.question_count > 0 && q.unfinished_count === 0)) return false;
      if (filter === 'empty' && q.question_count !== 0) return false;
      if (filter === 'unfinished' && q.unfinished_count === 0) return false;
      if (!needle) return true;
      return `${q.title} ${q.vendor?.name || ''}`.toLowerCase().includes(needle);
    });
  }, [quizzes, filter, find]);

  // Held on the FULL list, not the filtered one, so the panel still has
  // something to draw while it slides out after a filter hides the card.
  const selected = quizzes.find(q => q.id === selectedId) || null;

  function openRail(id) {
    setSelectedId(id);
    // Two frames: the first paints the panel off-screen, the second sends it
    // in. One is enough in most browsers and not in all of them.
    requestAnimationFrame(() => requestAnimationFrame(() => setRailOpen(true)));
  }
  function closeRail() { setRailOpen(false); }

  useEffect(() => {
    if (!railOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') closeRail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

  // A filter that hides the chosen quiz must not leave its details open over a
  // list it is not in.
  useEffect(() => {
    if (railOpen && selectedId && !shown.some(q => q.id === selectedId)) closeRail();
  }, [railOpen, selectedId, shown]);

  // Straight to the screen: the lobby has its own Start button, so a click
  // here commits to nothing except putting a code on a wall.
  async function runNow(quizId) {
    setFormError('');
    const { data, error: err } = await runBusy('Opening the room…', () => start(quizId));
    if (err) { setFormError(err.message); return; }
    closeRail();
    setRunning({ runId: data.runId, joinCode: data.joinCode });
  }

  // NO BUSY OVERLAY. Rehearsal reads its own questions and shows its own
  // "Reading the quiz…" on the surface that is about to use them, so an
  // overlay here would be a second spinner over the first.
  function rehearse(quiz) {
    closeRail();
    setRehearsing({ id: quiz.id, title: quiz.title });
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
    setAdding(false);
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

  if (rehearsing) {
    return (
      <QuizRehearsal
        quizId={rehearsing.id}
        title={rehearsing.title}
        onExit={() => setRehearsing(null)}
      />
    );
  }

  return (
    <>
      <TopBar />
      <main className="page dashboard library-page">
        {/* NO PAGE HEADING. The rail says Quizzes and so does the app bar; a
            third one saying it again was a band of the page that told a
            returning trainer nothing. The hero carries controls only. */}
        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show quizzes">
              {[
                ['all', `All · ${quizzes.length}`],
                ['ready', `Ready to run · ${ready}`],
                ['unfinished', `Unfinished · ${stats.unfinishedQuizzes}`],
                ['empty', `Empty · ${empty}`],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`view-tab ${filter === k ? 'active' : ''}`}
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="page-hero-actions">
              <input
                type="search"
                className="form-input wb-find"
                placeholder="Find a quiz…"
                aria-label="Find a quiz"
                value={find}
                onChange={e => setFind(e.target.value)}
              />
              {!adding && (
                <button type="button" className="lib-new-btn" onClick={() => setAdding(true)}>
                  + New quiz
                </button>
              )}
              {adding && (
                <form onSubmit={handleCreate} className="lib-new-form">
                  <input
                    className="form-input"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Day 1 — fares recap"
                    aria-label="New quiz title"
                    maxLength={120}
                  />
                  <button type="submit" className="lib-new-btn" disabled={busy || !title.trim()}>
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => { setAdding(false); setTitle(''); setFormError(''); }}
                  >
                    Cancel
                  </button>
                  {formError && <p className="error">{formError}</p>}
                </form>
              )}
            </div>
          </div>
        </section>

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

        {loading && <SkeletonCards count={6} label="Loading quizzes…" />}
        {error && <p className="error">{error}</p>}
        {!adding && formError && <p className="error">{formError}</p>}

        {!loading && !error && quizzes.length > 0 && (
          <section className="cockpit-gauges wb-gauges" aria-label="Quizzes at a glance">
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Quizzes</div>
                <div className="cockpit-gauge-value">{quizzes.length}</div>
                <div className="cockpit-gauge-hint">templates you can run</div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Questions</div>
                <div className="cockpit-gauge-value">{stats.questions}</div>
                <div className="cockpit-gauge-hint">
                  {empty === 0 ? 'across every quiz' : `${empty} quiz${empty === 1 ? '' : 'zes'} still empty`}
                </div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Longest</div>
                <div className="cockpit-gauge-value">
                  {stats.longest ? minutes(stats.longest.play_seconds) : '—'}
                </div>
                <div className="cockpit-gauge-hint">{stats.longest?.title || 'nothing to play yet'}</div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Wager rounds</div>
                <div className={`cockpit-gauge-value${stats.wagers ? '' : ' is-muted'}`}>{stats.wagers}</div>
                <div className="cockpit-gauge-hint">
                  {stats.wagers ? 'questions that take a stake' : 'nobody is betting anything'}
                </div>
              </div>
            </div>
            {/* The only gauge that ever asks for anything, so the only one
                allowed to carry an edge. */}
            <div className={`cockpit-gauge ${stats.unfinished > 0 ? 'is-warn' : ''}`}>
              <div>
                <div className="cockpit-gauge-label">Unfinished</div>
                <div className="cockpit-gauge-value">{stats.unfinished}</div>
                <div className="cockpit-gauge-hint">
                  {stats.unfinished === 0
                    ? 'every question can be marked'
                    : `question${stats.unfinished === 1 ? '' : 's'} with no answer set, in ${stats.unfinishedQuizzes} quiz${stats.unfinishedQuizzes === 1 ? '' : 'zes'}`}
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !error && quizzes.length === 0 && (
          <p className="cockpit-empty">No quizzes yet. Create the first one above.</p>
        )}

        {!loading && quizzes.length > 0 && (
          <div className="wb-room">
            <section className="wb-pane">
              {shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}
              {shown.length > 0 && (
                <div className="wb-grid">
                  {/* The card is a single control that opens the details, so it
                      carries no links or buttons of its own — which also settles
                      the button-inside-an-anchor problem that stopped it being
                      one big <Link> in the first place. */}
                  {shown.map(q => {
                    const on = selected?.id === q.id;
                    return (
                      <article
                        key={q.id}
                        className={`wb-card${on ? ' is-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={on && railOpen}
                        onClick={() => (on && railOpen ? closeRail() : openRail(q.id))}
                        onKeyDown={e => {
                          // A div that behaves like a button has to answer to
                          // the keyboard like one.
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          if (on && railOpen) closeRail(); else openRail(q.id);
                        }}
                      >
                        <div className="wb-card-body">
                          <div className="wb-card-top">
                            <h3 className="wb-card-title">{q.title}</h3>
                            {q.unfinished_count > 0 && (
                              <span className="wb-pill is-bad">
                                {q.unfinished_count} unfinished
                              </span>
                            )}
                            {q.question_count === 0 && <span className="wb-pill is-idle">empty</span>}
                          </div>
                          {/* Where a workbook card carries its description.
                              A quiz has none, and the gap it left was the one
                              thing that stopped these reading as the same
                              card — so the types go here, which is the fact a
                              title and a count cannot give you. */}
                          {q.kind_summary && <p className="wb-card-desc">{q.kind_summary}</p>}
                          <p className="wb-card-facts">
                            <span>
                              {q.question_count === 0
                                ? <span className="wb-stale">no questions yet</span>
                                : <><b>{q.question_count}</b> question{q.question_count === 1 ? '' : 's'}</>}
                            </span>
                            {q.question_count > 0 && <span><b>{minutes(q.play_seconds)}</b> to play</span>}
                            {q.wager_count > 0 && (
                              <span><b>{q.wager_count}</b> wager round{q.wager_count === 1 ? '' : 's'}</span>
                            )}
                            <span>{q.vendor ? q.vendor.name : 'All trainers'}</span>
                            <span>Updated <b>{shortDate(q.updated_at)}</b></span>
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* THE DETAILS ARRIVE OVER THE PAGE, not beside it. Same slide-over
            idiom as the workbook library and the new-session drawer, down to
            the duration variable, so there is one way a panel enters this app. */}
        {selectedId && (
          <>
            <div
              className={`wb-rail-backdrop${railOpen ? ' visible' : ''}`}
              onClick={closeRail}
              aria-hidden="true"
            />
            <aside
              className={`wb-rail-panel${railOpen ? ' open' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="Quiz details"
              aria-hidden={railOpen ? undefined : 'true'}
              onTransitionEnd={e => {
                // Only when the slide OUT has landed, and only for the slide
                // itself — visibility and opacity fire here too.
                if (e.propertyName === 'transform' && !railOpen) setSelectedId(null);
              }}
            >
              {selected && (
                <div className="wb-rail-card">
                  <div className="wb-rail-head">
                    <h2>{selected.title}</h2>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Close details"
                      onClick={closeRail}
                    >
                      ×
                    </button>
                  </div>

                  <dl className="wb-rail-facts">
                    <div><dt>Questions</dt><dd>
                      {selected.question_count === 0
                        ? <span className="wb-stale">none yet</span>
                        : `${selected.question_count} · about ${minutes(selected.play_seconds)} to play`}
                    </dd></div>
                    <div><dt>Wager</dt><dd>
                      {selected.wager_count === 0
                        ? 'no rounds take a stake'
                        : `${selected.wager_count} round${selected.wager_count === 1 ? '' : 's'} take a stake`}
                    </dd></div>
                    <div><dt>Unfinished</dt><dd>
                      {selected.unfinished_count === 0
                        ? 'every question can be marked'
                        : <span className="wb-unkeyed">
                            {selected.unfinished_count} question{selected.unfinished_count === 1 ? '' : 's'} with no answer set
                          </span>}
                    </dd></div>
                    <div><dt>Who sees it</dt><dd>{selected.vendor ? selected.vendor.name : 'All trainers'}</dd></div>
                    <div><dt>Updated</dt><dd>{shortDate(selected.updated_at)}</dd></div>
                  </dl>

                  <div className="wb-rail-actions quiz-rail-actions">
                    {/* NOTHING TO PLAY IS SAID, NOT GREYED OUT. A disabled
                        button cannot carry a tooltip — it emits no pointer
                        events, so data-tip on one is a hint nobody ever sees —
                        and "why is this grey" is exactly the question a trainer
                        would have. So the two play buttons are absent and a
                        sentence takes their place. */}
                    {selected.question_count === 0 ? (
                      <p className="quiz-rail-none">
                        Nothing to play yet — this quiz has no questions. Add one in the editor
                        and both Rehearse and Run now appear here.
                      </p>
                    ) : (
                      <>
                        {/* REHEARSE SITS ABOVE RUN NOW, and the ordering is the
                            recommendation: one of these opens a room and puts a
                            code on a wall, the other cannot be seen by anybody.
                            The one with no consequences goes first. */}
                        <button
                          type="button"
                          className="primary-link quiz-rail-go"
                          data-tip="Play it through yourself — nobody joins, nothing is recorded"
                          onClick={() => rehearse(selected)}
                        >
                          ▶ Rehearse
                          <small>Play it through yourself. Nobody joins.</small>
                        </button>
                        <button
                          type="button"
                          className="ghost quiz-rail-run"
                          data-tip="Open a room for this quiz — people join by scanning a code"
                          onClick={() => runNow(selected.id)}
                        >
                          ▶ Run now
                          <small>Opens a room and puts a code on the wall.</small>
                        </button>
                      </>
                    )}
                    <Link to={`/trainer/quizzes/${selected.id}`} className="ghost-link quiz-rail-edit">
                      Edit
                      <small>Questions, answers, pictures, timing</small>
                    </Link>
                  </div>
                </div>
              )}
            </aside>
          </>
        )}
      </main>
    </>
  );
}

// How long a quiz takes to play, as a trainer budgets it. Whole minutes,
// because "about 5 min" is the useful reading and "4 min 40 s" invites an
// accuracy the question timings do not have — a room spends time between
// questions too.
function minutes(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

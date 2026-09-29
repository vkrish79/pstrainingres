import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonCards } from '../Skeleton.jsx';
import { supabase } from '../../lib/supabase.js';
import { usePolls, filledAnswers, pollIsReady, POLL_SLOTS } from '../../hooks/usePolls.js';
import QuizShape from '../quiz/QuizShape.jsx';
import CreateDialog from '../library/CreateDialog.jsx';
import { useActivePoll } from '../../hooks/useActivePoll.js';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import PollProjector from '../poll/PollProjector.jsx';
import '../../styles/poll.css';

// When a past poll was asked, in the SAME shape as the session's own dates
// two inches up the page — "13 Sept 2026, 16:42", day first.
//
// en-GB and 24h are pinned rather than left to the browser. ChangeEntry's
// formatWhen passes `undefined` for the locale, which on this machine renders
// "Sep 13, 2026, 04:42 PM" — correct, and jarringly not what the session header
// directly above it says. sessionDates.js exists because there were seven
// disagreeing copies of a date formatter in here; this is not becoming the
// eighth disagreement.
function formatAskedAt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// How long a poll stays open, picked when it is asked. '' is No timer — the
// trainer closes it, as polls always worked. The length is all the browser
// sends; poll_fire turns it into a deadline on the server's own clock.
const TIMER_CHOICES = [
  { value: '', label: 'No timer' },
  { value: '20', label: '20s' },
  { value: '30', label: '30s' },
  { value: '60', label: '60s' },
  { value: '90', label: '90s' },
];
const DEFAULT_TIMER = '30';

// How long an earlier run was open for, to ask it again the same way.
//
// null means it had no timer and gets none. Both timestamps come from the
// server, so this is a difference of two server clocks and never involves the
// browser's — which is the only reason it can be worked out here.
//
// Clamped to what poll_open_run will accept (5s..10min). A run whose ends_at
// was edited, or one from before timers existed, should re-ask as a poll with
// no timer rather than be refused by the database for a length nobody chose.
function reaskSeconds(r) {
  if (!r?.ends_at || !r?.opened_at) return null;
  const secs = Math.round((new Date(r.ends_at).getTime() - new Date(r.opened_at).getTime()) / 1000);
  if (!Number.isFinite(secs) || secs < 5 || secs > 600) return null;
  return secs;
}

// The Polls tab on a session.
//
// There is NO attach step, deliberately unlike the quiz. A session reads the
// library live and the snapshot happens when the poll is fired, so fixing a
// typo reaches the next firing without anyone having to remember to re-attach.
// (The quiz's frozen session copy is a known trap — right thumbnail, empty
// projector.)
export default function SessionPolls({ sessionId }) {
  const { loading, error, polls } = usePolls();
  const { run, refresh: refreshRun, secondsLeft } = useActivePoll(sessionId);
  const { run: runBusy } = useBusyOverlay();
  const [rowError, setRowError] = useState('');
  // Whether the projector is filling the screen. Separate from "a poll is
  // live", so the trainer can step back to the session without taking the poll
  // off the room's handsets — and walk back in to it (case 10).
  const [showing, setShowing] = useState(false);
  const [past, setPast] = useState([]);
  // The two doors. Picking one you have written before, or writing one here
  // and now — a different act, because this one is thrown away with the
  // session.
  const [picking, setPicking] = useState(false);
  const [writing, setWriting] = useState(false);

  // Past results for THIS session. Counts, never voters — the tally is the
  // jsonb poll_close wrote, and it is all that is needed to put the result back
  // on screen after the votes themselves have been purged.
  const loadPast = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await supabase
      .from('poll_runs')
      .select('id, question, options, tally, opened_at, ends_at')
      .eq('session_id', sessionId)
      .not('dismissed_at', 'is', null)
      .order('opened_at', { ascending: false })
      .limit(20);
    setPast(data || []);
  }, [sessionId]);

  useEffect(() => { loadPast(); }, [loadPast, run?.run_id]);

  // A POLL WRITTEN IN THE ROOM, which belongs to nothing.
  //
  // It is a poll_runs row with poll_id NULL — no library row is created, so
  // "it does not survive the session" is true by construction rather than by a
  // cleanup job somebody has to remember to write. The run already carries its
  // own question and answers (that is how the library ones are snapshotted at
  // fire time), so nothing downstream can tell the difference: the projector,
  // the handsets and the result all read the run.
  async function handleFireAdhoc(question, options, seconds) {
    setRowError('');
    const { data, error: err } = await runBusy('Asking the room…', () =>
      supabase.rpc('poll_fire_adhoc', {
        p_session_id: sessionId,
        p_question: question,
        p_options: options,
        p_seconds: seconds ? Number(seconds) : null,
      }));
    if (err) { setRowError(err.message); return false; }
    if (!data) { setRowError('The poll did not open.'); return false; }
    await refreshRun();
    await loadPast();
    setShowing(true);
    return true;
  }

  // Ask an earlier one again. Opens a NEW run from the old one's stored
  // question and answers, so the first tally stays where it is and the two can
  // be read against each other — before the break and after it. Works for a
  // library poll and a session-written one alike, because by this point they
  // are the same kind of row.
  async function handleReask(r) {
    setRowError('');
    // THE LENGTH IT WAS ASKED WITH, not a default. Re-asking a poll that ran
    // with No timer should not quietly give it 30 seconds, and one that ran for
    // 90 should not be cut to 30 — the per-row timer pills exist because that
    // choice matters, and "ask this again" ought to mean it.
    //
    // Both stamps are the SERVER's, so their difference is clean: no browser
    // clock is involved, which is what makes this safe to compute here at all.
    const seconds = reaskSeconds(r);
    const { data, error: err } = await runBusy('Asking the room…', () =>
      supabase.rpc('poll_reask', { p_run_id: r.id, p_seconds: seconds }));
    if (err) { setRowError(err.message); return; }
    if (!data) { setRowError('The poll did not open.'); return; }
    await refreshRun();
    await loadPast();
    setShowing(true);
  }

  // The length now comes from the picker rather than from a pill on a row,
  // because there are no rows on this page any more.
  async function handleFire(pollId, seconds) {
    setRowError('');
    const { data, error: err } = await runBusy('Asking the room…', () =>
      supabase.rpc('poll_fire', {
        p_poll_id: pollId,
        p_session_id: sessionId,
        p_seconds: seconds ? Number(seconds) : null,
      }));
    // The database refuses a poll with too few answers, a blank question, and a
    // poll fired over a running quiz (case 12). Those messages are written to
    // be read by a trainer, so show them as they are.
    if (err) { setRowError(err.message); return false; }
    if (!data) { setRowError('The poll did not open.'); return false; }
    await refreshRun();
    await loadPast();
    setShowing(true);
    return true;
  }

  async function handleClose() {
    setRowError('');
    const { error: err } = await runBusy('Closing the vote…', () =>
      supabase.rpc('poll_close', { p_run_id: run.run_id }));
    if (err) { setRowError(err.message); return; }
    await refreshRun();
  }

  // AT ZERO, WRITE THE TALLY. The server already refuses votes past the
  // deadline, so this is not what shuts voting — it is what records the result
  // promptly and turns the wall to "Voting closed" without a click. Quiet (no
  // busy overlay) because nobody asked for it, and once per run. If this tab is
  // not open when the clock runs out, poll_dismiss closes it later with the
  // same counts.
  const autoClosed = useRef(null);
  useEffect(() => {
    if (!run?.run_id || !run.ends_at || secondsLeft !== 0) return;
    if (autoClosed.current === run.run_id) return;
    autoClosed.current = run.run_id;
    supabase.rpc('poll_close', { p_run_id: run.run_id }).then(() => refreshRun());
  }, [run?.run_id, run?.ends_at, secondsLeft, refreshRun]);

  async function handleDismiss() {
    setRowError('');
    const { error: err } = await runBusy('Taking it down…', () =>
      supabase.rpc('poll_dismiss', { p_run_id: run.run_id }));
    if (err) { setRowError(err.message); return; }
    setShowing(false);
    await refreshRun();
    await loadPast();
  }

  // The projector takes the whole screen, rendered here rather than routed to,
  // so closing it returns the trainer to this tab with the session still
  // loaded behind it. Same pattern as the quiz.
  if (showing && run) {
    return (
      <PollProjector
        run={run}
        secondsLeft={secondsLeft}
        onCloseVoting={handleClose}
        onDismiss={handleDismiss}
        onExit={() => setShowing(false)}
      />
    );
  }

  return (
    <section className="poll-tab">
      {rowError && <p className="error">{rowError}</p>}
      {error && <p className="error">{error}</p>}

      {run && (
        <div className="poll-live-banner">
          <div>
            <span className="poll-live-dot" aria-hidden="true" />
            <strong>{run.is_open ? 'A poll is open' : 'A poll is on the wall'}</strong>
            <span className="muted"> — {run.question}</span>
          </div>
          <div className="poll-live-tools">
            <button type="button" onClick={() => setShowing(true)}>Show it</button>
            {run.is_open && <button type="button" className="ghost" onClick={handleClose}>Close voting</button>}
            <button type="button" className="ghost" onClick={handleDismiss}>Take it down</button>
          </div>
        </div>
      )}

      {loading && <SkeletonCards count={3} label="Loading polls…" />}

      {/* TWO DOORS, AND NEITHER OF THEM IS A LIST. The library used to be laid
          out here in full, so the tab opened as a catalogue you scrolled past
          before you could do anything — and it put every poll ever written in
          front of a trainer who wanted to ask one question about pace. Both
          ways in are a button now; the library opens in a picker. */}
      {!loading && (
        <div className="poll-doors">
          <div className="poll-doors-text">
            <strong>Ask the room something</strong>
            {/* "Pick one" is not an instruction you can follow with an empty
                library, and the first thing a new trainer sees should not be a
                choice between two things when there is only one. */}
            <span className="muted">
              {polls.length > 0
                ? 'Pick one you have written before, or write one now for this class only.'
                : 'Write one now, just for this class — nothing is kept afterwards.'}
            </span>
          </div>
          <div className="poll-doors-actions">
            {/* One filled button, not two. Two solid buttons side by side would
                each be claiming to be the thing you came here to do. */}
            <button
              type="button"
              className="poll-door-btn"
              disabled={polls.length === 0}
              data-tip={polls.length === 0 ? 'Nothing in the library yet' : 'Pick one you have written before'}
              onClick={() => setPicking(true)}
            >
              Select from library{polls.length > 0 ? ` · ${polls.length}` : ''}
            </button>
            <button type="button" className="lib-new-btn" onClick={() => setWriting(true)}>
              + Write one for this session
            </button>
          </div>
        </div>
      )}

      {!loading && polls.length === 0 && (
        <p className="muted">
          Nothing in the library yet. <Link to="/trainer/polls">Write one there</Link> to keep it
          for other classes — or write one above, just for this one.
        </p>
      )}

      {past.length > 0 && (
        <>
          <div className="cockpit-card session-poll-card">
          <h3 className="cockpit-card-title poll-section-head">Earlier in this session</h3>
          <ul className="poll-past-list">
            {past.map((r) => {
              const opts = Array.isArray(r.options) ? r.options : [];
              const tally = r.tally && typeof r.tally === 'object' ? r.tally : {};
              return (
                <li key={r.id} className="poll-past-row">
                  <div className="poll-past-head">
                    <span className="poll-past-q">{r.question}</span>
                    {/* WHEN it was asked, not when it was taken down. A result
                        without a time is just a number; with one it can be put
                        against what was being taught at that point in the day,
                        which is the only reason to keep looking at it after the
                        room has moved on. A session can run over several days,
                        so the date is as load-bearing as the clock. */}
                    {r.opened_at && (
                      <time className="poll-past-when" dateTime={r.opened_at}>
                        {formatAskedAt(r.opened_at)}
                      </time>
                    )}
                    {/* A SECOND RUN, not a reopened one. The tally beside it
                        stays exactly where it is, so "before the break" and
                        "after it" sit on the page together — which is the only
                        reason to ask the same question twice. It is also the
                        only way back to a poll written in this session, since
                        that one was never saved anywhere else. */}
                    <button
                      type="button"
                      className="poll-past-reask"
                      onClick={() => handleReask(r)}
                      data-tip="Ask this again, the same length — the result above is kept"
                    >
                      Ask again
                    </button>
                  </div>
                  {/* The same bars the projector showed, scaled to the biggest
                      answer, so which way the room leaned reads without adding
                      numbers up. */}
                  {(() => {
                    const most = Math.max(1, ...opts.map((_, i) => tally[String(i)] ?? 0));
                    const votes = opts.reduce((n, _, i) => n + (tally[String(i)] ?? 0), 0);
                    return (
                      <span className="poll-past-counts">
                        {opts.map((label, i) => {
                          const n = tally[String(i)] ?? 0;
                          return (
                            <span className="poll-past-chip" key={i}>
                              <span className="poll-past-label">{label}</span>
                              <span className="poll-past-track" aria-hidden="true">
                                <span className={`poll-past-fill poll-opt-${i}`} style={{ width: `${(n / most) * 100}%` }} />
                              </span>
                              <strong>{n}</strong>
                            </span>
                          );
                        })}
                        <span className="poll-past-total">{votes} vote{votes === 1 ? '' : 's'}</span>
                      </span>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
          </div>
        </>
      )}

      {picking && (
        <LibraryPollDialog
          polls={polls}
          onClose={() => setPicking(false)}
          onAsk={handleFire}
        />
      )}

      {writing && (
        <AdhocPollDialog
          onClose={() => setWriting(false)}
          onAsk={handleFireAdhoc}
        />
      )}
    </section>
  );
}

// Picking one you have written before.
//
// A MODAL, not the page. Laid out on the tab, the library was a catalogue
// standing between the trainer and the one thing they came to do; in here it
// is a list you open, choose from, and close. It also puts the choice and the
// length in one place — the length used to be a row of pills on every row,
// which meant five identical controls on screen and only one of them mattering.
//
// The answers ARE shown here, unlike on the library page's tiles: on that page
// you are looking for a poll to edit and the question identifies it, but here
// you are about to put it on a wall, and what the room will be asked to choose
// between is the thing worth checking first.
function LibraryPollDialog({ polls, onClose, onAsk }) {
  const [chosen, setChosen] = useState(null);
  const [seconds, setSeconds] = useState(DEFAULT_TIMER);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);

  const q = find.trim().toLowerCase();
  const shown = polls.filter(p => !q
    || [p.question, ...filledAnswers(p.options)].some(v => (v || '').toLowerCase().includes(q)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const ok = await onAsk(chosen, seconds);
    setBusy(false);
    // A refusal is shown on the page behind, where the other poll errors are.
    // Closing regardless would hide it behind a dialog that had just vanished.
    if (ok) onClose();
  }

  return (
    <CreateDialog
      heading="Ask a poll from the library"
      blurb="It stays in the library afterwards — editing it there reaches every session that asks it next."
      submitLabel="Ask the room"
      busy={busy}
      canSubmit={!!chosen}
      onClose={onClose}
      onSubmit={submit}
    >
      {polls.length > 4 && (
        <input
          type="search"
          className="form-input"
          placeholder="Find a poll…"
          aria-label="Find a poll"
          value={find}
          onChange={e => setFind(e.target.value)}
        />
      )}

      <div className="poll-pick-list" role="radiogroup" aria-label="Polls in the library">
        {shown.length === 0 && <p className="muted">Nothing matches that.</p>}
        {shown.map(p => {
          const answers = filledAnswers(p.options);
          const ready = pollIsReady(p);
          const on = chosen === p.id;
          return (
            <label key={p.id} className={`poll-pick${on ? ' is-on' : ''}${ready ? '' : ' is-unfinished'}`}>
              <input
                type="radio"
                name="poll-pick"
                value={p.id}
                checked={on}
                /* CASE 06 again: an unfinished poll cannot be fired, so it is
                   here but not choosable, rather than missing and wondered about. */
                disabled={!ready}
                onChange={() => setChosen(p.id)}
              />
              <span className="poll-pick-body">
                <span className="poll-pick-q">{p.question || <em className="muted">No question yet</em>}</span>
                <span className="poll-pick-answers">
                  {ready
                    ? answers.map((a, i) => (
                      <span className="poll-pick-answer" key={i}>
                        <span className={`poll-badge poll-opt-${i}`}><QuizShape index={i} title={a} /></span>
                        {a}
                      </span>
                    ))
                    : <em className="muted">Unfinished — needs a question and at least two answers</em>}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div>
        <label className="form-label" htmlFor="pick-poll-secs">How long voting stays open</label>
        <select
          id="pick-poll-secs"
          className="form-input"
          value={seconds}
          onChange={e => setSeconds(e.target.value)}
        >
          {TIMER_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </CreateDialog>
  );
}

// Writing a poll in the room.
//
// THE SAME DOOR AS THE LIBRARY'S, on purpose — CreateDialog is the shell every
// "make one of these" uses now, so this is not a sixth kind of form. What is
// different is what happens at the end: there is no Create, only Ask. The poll
// is not saved anywhere first; it goes straight onto the wall as a run, and
// when the session is over there is nothing left of it.
function AdhocPollDialog({ onClose, onAsk }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(() => Array(POLL_SLOTS).fill(''));
  const [seconds, setSeconds] = useState(DEFAULT_TIMER);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const filled = options.map(o => o.trim()).filter(Boolean);
  const canAsk = !!question.trim() && filled.length >= 2;

  function setAnswer(i, v) {
    setOptions(prev => prev.map((o, idx) => (idx === i ? v : o)));
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    // The blanks go with it: the server strips them too, but sending six slots
    // with four empty would put the shapes in the wrong order if it did not.
    const ok = await onAsk(question.trim(), filled, seconds);
    setBusy(false);
    if (ok) onClose();
    // A failure leaves the dialog open with what was typed still in it — the
    // database's refusals are written to be read, and they are shown on the
    // page behind this one.
    else setErr('The room did not get it — see the message on the page behind.');
  }

  return (
    <CreateDialog
      heading="Write a poll for this session"
      blurb="It goes straight to the room and is not kept in the library — when this session is over, it is gone."
      submitLabel="Ask the room"
      busy={busy}
      error={err}
      canSubmit={canAsk}
      onClose={onClose}
      onSubmit={submit}
    >
      <div>
        <label className="form-label" htmlFor="adhoc-poll-q">Question</label>
        <input
          id="adhoc-poll-q"
          className="form-input"
          placeholder="e.g. How are we doing on pace?"
          value={question}
          maxLength={200}
          onChange={e => setQuestion(e.target.value)}
        />
      </div>

      <div>
        <label className="form-label">Answers</label>
        {Array.from({ length: POLL_SLOTS }, (_, i) => (
          <div className="poll-edit-answer" key={i}>
            <span className={`poll-badge poll-opt-${i}`}><QuizShape index={i} /></span>
            <input
              className="form-input"
              value={options[i]}
              maxLength={80}
              placeholder={i < 2 ? 'Required' : 'Optional'}
              onChange={e => setAnswer(i, e.target.value)}
            />
          </div>
        ))}
        <p className="muted">
          {filled.length < 2
            ? 'A poll needs at least two answers before it can be asked.'
            : 'Leave the rest blank and only the written answers appear in the room.'}
        </p>
      </div>

      <div>
        <label className="form-label" htmlFor="adhoc-poll-secs">How long voting stays open</label>
        <select
          id="adhoc-poll-secs"
          className="form-input"
          value={seconds}
          onChange={e => setSeconds(e.target.value)}
        >
          {TIMER_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </CreateDialog>
  );
}

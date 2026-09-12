import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonCards } from '../Skeleton.jsx';
import { supabase } from '../../lib/supabase.js';
import { usePolls, filledAnswers, pollIsReady } from '../../hooks/usePolls.js';
import { useActivePoll } from '../../hooks/useActivePoll.js';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import PollProjector from '../poll/PollProjector.jsx';
import '../../styles/poll.css';

// The Polls tab on a session.
//
// There is NO attach step, deliberately unlike the quiz. A session reads the
// library live and the snapshot happens when the poll is fired, so fixing a
// typo reaches the next firing without anyone having to remember to re-attach.
// (The quiz's frozen session copy is a known trap — right thumbnail, empty
// projector.)
export default function SessionPolls({ sessionId }) {
  const { loading, error, polls } = usePolls();
  const { run, refresh: refreshRun } = useActivePoll(sessionId);
  const { run: runBusy } = useBusyOverlay();
  const [rowError, setRowError] = useState('');
  // Whether the projector is filling the screen. Separate from "a poll is
  // live", so the trainer can step back to the session without taking the poll
  // off the room's handsets — and walk back in to it (case 10).
  const [showing, setShowing] = useState(false);
  const [past, setPast] = useState([]);

  // Past results for THIS session. Counts, never voters — the tally is the
  // jsonb poll_close wrote, and it is all that is needed to put the result back
  // on screen after the votes themselves have been purged.
  const loadPast = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await supabase
      .from('poll_runs')
      .select('id, question, options, tally, opened_at')
      .eq('session_id', sessionId)
      .not('dismissed_at', 'is', null)
      .order('opened_at', { ascending: false })
      .limit(20);
    setPast(data || []);
  }, [sessionId]);

  useEffect(() => { loadPast(); }, [loadPast, run?.run_id]);

  async function handleFire(pollId) {
    setRowError('');
    const { data, error: err } = await runBusy('Asking the room…', () =>
      supabase.rpc('poll_fire', { p_poll_id: pollId, p_session_id: sessionId }));
    // The database refuses a poll with too few answers, a blank question, and a
    // poll fired over a running quiz (case 12). Those messages are written to
    // be read by a trainer, so show them as they are.
    if (err) { setRowError(err.message); return; }
    if (!data) { setRowError('The poll did not open.'); return; }
    await refreshRun();
    setShowing(true);
  }

  async function handleClose() {
    setRowError('');
    const { error: err } = await runBusy('Closing the vote…', () =>
      supabase.rpc('poll_close', { p_run_id: run.run_id }));
    if (err) { setRowError(err.message); return; }
    await refreshRun();
  }

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

      {!loading && polls.length === 0 && (
        <p className="muted">
          No polls yet. <Link to="/trainer/polls">Write one</Link> and it will be here,
          ready to ask any session.
        </p>
      )}

      {!loading && polls.length > 0 && (
        <>
          <h3 className="poll-section-head">Ask the room</h3>
          <ul className="poll-fire-list">
            {polls.map((p) => {
              const answers = filledAnswers(p.options);
              const ready = pollIsReady(p);
              return (
                <li key={p.id} className="poll-fire-row">
                  <div className="poll-fire-main">
                    <span className="poll-fire-q">{p.question || <em className="muted">No question yet</em>}</span>
                    <span className="muted">
                      {/* CASE 06, said out loud before they try. */}
                      {ready
                        ? answers.join(' · ')
                        : 'Unfinished — needs a question and at least two answers'}
                    </span>
                  </div>
                  <div className="poll-fire-tools">
                    <button
                      type="button"
                      className="poll-fire-btn"
                      disabled={!ready}
                      title={ready ? 'Put this on the projector' : 'Finish this poll first'}
                      onClick={() => handleFire(p.id)}
                    >
                      Ask the room
                    </button>
                    <Link to="/trainer/polls" className="ghost-link">Edit</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <>
          <h3 className="poll-section-head">Earlier in this session</h3>
          <ul className="poll-past-list">
            {past.map((r) => {
              const opts = Array.isArray(r.options) ? r.options : [];
              const tally = r.tally && typeof r.tally === 'object' ? r.tally : {};
              return (
                <li key={r.id} className="poll-past-row">
                  <span className="poll-past-q">{r.question}</span>
                  <span className="poll-past-counts">
                    {opts.map((label, i) => (
                      <span className="poll-past-chip" key={i}>
                        <span className={`poll-chip-dot poll-opt-${i}`} aria-hidden="true" />
                        {label} <strong>{tally[String(i)] ?? 0}</strong>
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

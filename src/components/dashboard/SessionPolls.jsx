import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import KebabMenu from '../KebabMenu.jsx';
import { SkeletonCards } from '../Skeleton.jsx';
import { supabase } from '../../lib/supabase.js';
import { usePolls, filledAnswers, pollIsReady } from '../../hooks/usePolls.js';
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
  // The length chosen on each row, by poll id.
  const [timers, setTimers] = useState({});
  const { run: runBusy } = useBusyOverlay();
  const navigate = useNavigate();
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
    const seconds = timers[pollId] ?? DEFAULT_TIMER;
    const { data, error: err } = await runBusy('Asking the room…', () =>
      supabase.rpc('poll_fire', {
        p_poll_id: pollId,
        p_session_id: sessionId,
        p_seconds: seconds ? Number(seconds) : null,
      }));
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

      {!loading && polls.length === 0 && (
        <p className="muted">
          No polls yet. <Link to="/trainer/polls">Write one</Link> and it will be here,
          ready to ask any session.
        </p>
      )}

      {!loading && polls.length > 0 && (
        <>
          <div className="cockpit-card session-poll-card">
          <h3 className="cockpit-card-title poll-section-head">Ask the room</h3>
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
                    {/* One tap each, rather than a small dropdown that was easy
                        to leave on the wrong length before pressing Ask. */}
                    <div className="poll-fire-timer" role="radiogroup" aria-label="How long voting stays open">
                      {TIMER_CHOICES.map((c) => {
                        const on = (timers[p.id] ?? DEFAULT_TIMER) === c.value;
                        return (
                          <button
                            key={c.value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={!ready}
                            data-value={c.value}
                            onClick={() => setTimers((t) => ({ ...t, [p.id]: c.value }))}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="poll-fire-btn"
                      disabled={!ready}
                      title={ready ? 'Put this on the projector' : 'Finish this poll first'}
                      onClick={() => handleFire(p.id)}
                    >
                      Ask the room
                    </button>
                    <KebabMenu
                      label={`Actions for ${p.question || 'this poll'}`}
                      items={[{ label: 'Edit in the library', glyph: '✎', onClick: () => navigate('/trainer/polls') }]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
        </>
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
    </section>
  );
}

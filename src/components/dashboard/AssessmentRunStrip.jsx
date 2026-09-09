import { useState } from 'react';
import { useCountdown, assessmentState, STATE_LABEL } from '../../lib/assessmentTimer.js';

// Running the assessment: unlock it, time it, extend it, lock it again.
//
// This is the whole of what used to be AssessmentLockControl, moved out of the
// session header. It was never a header action — it is how you RUN the
// assessment, and there is already a tab for that. In the header it had five
// render states and one of them was a form, so the toolbar's height was a
// function of the control's state: 215px to 341px of movement from clicking a
// single button. Here it has a row of its own and can be any size it likes.
//
// PRESETS FIRST, CUSTOM ALWAYS AVAILABLE. Nobody wants to type a number to
// start an exam, and the old control asked for one twice — once to unlock,
// once to extend. But a preset list is a guess about what people need, so
// "Other…" sits beside every set of presets rather than only the first: the
// same input serves unlocking, extending and reopening, and what it does
// depends on the state it is used from.
const DURATIONS = [30, 60, 90];
const EXTENSIONS = [5, 15, 30];

export default function AssessmentRunStrip({ unlockedAt, deadlineAt, onUnlock, onLock, onExtend }) {
  const { label, expired, urgent } = useCountdown(deadlineAt);
  const state = assessmentState(unlockedAt, expired);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError('');
    const res = await fn();
    setBusy(false);
    if (res?.error) { setError(res.error.message || 'That did not work.'); return false; }
    return true;
  }

  function closeCustom() {
    setShowCustom(false);
    setCustom('');
  }

  async function preset(mins) {
    if (await run(() => (state === 'locked' ? onUnlock(mins) : onExtend(mins)))) closeCustom();
  }

  // One input, three jobs. From locked it opens the assessment for N minutes;
  // from open or expired it adds N minutes to the deadline.
  async function commitCustom() {
    const n = Number(custom);
    if (!Number.isFinite(n) || n <= 0) return;
    if (await run(() => (state === 'locked' ? onUnlock(n) : onExtend(n)))) closeCustom();
  }

  const customVerb = state === 'locked' ? 'Open' : expired ? 'Reopen' : 'Add';
  // Adding time to an assessment that has no deadline is meaningless, so the
  // custom box is offered only where a number would actually do something.
  const canSetTime = state === 'locked' || !!deadlineAt;

  return (
    <div className={`assessment-run is-${state}`}>
      <div className="assessment-run-main">
        <span className="assessment-run-label">Assessment</span>

        <span className={`assessment-run-state is-${state}`}>
          <span className="assessment-status-dot" aria-hidden />
          {STATE_LABEL[state]}
        </span>

        {state === 'open' && label && (
          <span className={`assessment-run-timer${urgent ? ' is-urgent' : ''}`}>⏱ {label} left</span>
        )}
        {state === 'open' && !deadlineAt && (
          <span className="assessment-run-note">No time limit</span>
        )}

        <span className="assessment-run-actions">
          {state === 'locked' && (
            <>
              <span className="assessment-run-hint">Open it for</span>
              {DURATIONS.map(m => (
                <button key={m} type="button" className="ghost" disabled={busy} onClick={() => preset(m)}>
                  {m}m
                </button>
              ))}
              <button type="button" className="ghost" disabled={busy} onClick={() => preset(null)}>
                Untimed
              </button>
            </>
          )}

          {state !== 'locked' && deadlineAt && (
            <>
              <span className="assessment-run-hint">{expired ? 'Reopen for' : 'Add'}</span>
              {EXTENSIONS.map(m => (
                <button key={m} type="button" className="ghost" disabled={busy} onClick={() => preset(m)}>
                  +{m}m
                </button>
              ))}
            </>
          )}

          {canSetTime && (showCustom ? (
            <span className="assessment-run-custom">
              <input
                type="number"
                min="1"
                className="form-input"
                value={custom}
                placeholder="45"
                disabled={busy}
                autoFocus
                aria-label={`${customVerb} for a custom number of minutes`}
                onChange={e => setCustom(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitCustom();
                  if (e.key === 'Escape') closeCustom();
                }}
              />
              <span>min</span>
              <button type="button" className="primary" disabled={busy || !custom.trim()} onClick={commitCustom}>
                {customVerb}
              </button>
              <button type="button" className="ghost-link" disabled={busy} onClick={closeCustom}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="ghost-link" disabled={busy} onClick={() => setShowCustom(true)}>
              Other…
            </button>
          ))}

          {state !== 'locked' && (
            <button type="button" className="ghost" disabled={busy} onClick={() => run(onLock)}>
              <span className="btn-glyph" aria-hidden>⊘</span> Lock
            </button>
          )}
        </span>
      </div>

      {error && <p className="assessment-run-error">{error}</p>}

      {state === 'locked' && (
        <p className="assessment-run-help">
          Participants cannot open the assessment until you unlock it. A time limit is
          session-wide and starts the moment you do.
        </p>
      )}
      {expired && (
        <p className="assessment-run-help">
          The time is up and participants can no longer answer. Reopening adds time from now,
          not from when it ran out.
        </p>
      )}
    </div>
  );
}

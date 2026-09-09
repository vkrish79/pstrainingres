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
// PRESETS, NOT A TEXT FIELD. Nobody wants to type a number to start an exam,
// and the old control asked for one twice — once to unlock, once to extend.
// A custom box is still there for the session that genuinely needs 47 minutes.
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

  async function unlock(mins) {
    if (await run(() => onUnlock(mins))) { setCustom(''); setShowCustom(false); }
  }

  async function unlockCustom() {
    const n = Number(custom);
    if (!Number.isFinite(n) || n <= 0) return;
    await unlock(n);
  }

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
          {state === 'locked' ? (
            <>
              <span className="assessment-run-hint">Open it for</span>
              {DURATIONS.map(m => (
                <button key={m} type="button" className="ghost" disabled={busy} onClick={() => unlock(m)}>
                  {m}m
                </button>
              ))}
              <button type="button" className="ghost" disabled={busy} onClick={() => unlock(null)}>
                Untimed
              </button>
              {showCustom ? (
                <span className="assessment-run-custom">
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    value={custom}
                    placeholder="45"
                    disabled={busy}
                    autoFocus
                    onChange={e => setCustom(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') unlockCustom();
                      if (e.key === 'Escape') { setShowCustom(false); setCustom(''); }
                    }}
                  />
                  <span>min</span>
                  <button type="button" className="primary" disabled={busy || !custom.trim()} onClick={unlockCustom}>
                    Open
                  </button>
                </span>
              ) : (
                <button type="button" className="ghost-link" disabled={busy} onClick={() => setShowCustom(true)}>
                  Other…
                </button>
              )}
            </>
          ) : (
            <>
              {/* Extending is buttons, not a field: +15 is one click, and the
                  old control made you type it. */}
              {deadlineAt && (
                <>
                  <span className="assessment-run-hint">{expired ? 'Reopen for' : 'Add'}</span>
                  {EXTENSIONS.map(m => (
                    <button key={m} type="button" className="ghost" disabled={busy}
                      onClick={() => run(() => onExtend(m))}>
                      +{m}m
                    </button>
                  ))}
                </>
              )}
              <button type="button" className="ghost" disabled={busy} onClick={() => run(onLock)}>
                <span className="btn-glyph" aria-hidden>⊘</span> Lock
              </button>
            </>
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
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';

// Session-header control for the assessment lock. Locked → reveals an optional
// "minutes" field then unlocks (blank = untimed, a positive number stamps a
// session-wide deadline). Unlocked → a re-lock button plus a live countdown
// chip when a deadline is set. The actual write + auth check happen in the
// set_assessment_unlocked RPC, reached via onUnlock / onLock.
export default function AssessmentLockControl({ unlockedAt, deadlineAt, onUnlock, onLock, onExtend }) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendMins, setExtendMins] = useState('');
  const [error, setError] = useState('');

  const deadlineMs = deadlineAt ? new Date(deadlineAt).getTime() : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineMs == null) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const remainingLabel = useMemo(() => {
    if (deadlineMs == null) return null;
    const total = Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }, [deadlineMs, nowMs]);
  const expired = deadlineMs != null && nowMs >= deadlineMs;

  async function doUnlock() {
    setBusy(true);
    setError('');
    const mins = minutes.trim() === '' ? null : Number(minutes);
    const res = await onUnlock(Number.isFinite(mins) && mins > 0 ? mins : null);
    setBusy(false);
    if (res?.error) { setError(res.error.message || 'Unlock failed'); return; }
    setEditing(false);
    setMinutes('');
  }

  async function doLock() {
    setBusy(true);
    setError('');
    const res = await onLock();
    setBusy(false);
    if (res?.error) setError(res.error.message || 'Lock failed');
  }

  async function doExtend() {
    const mins = Number(extendMins);
    if (!Number.isFinite(mins) || mins <= 0) return;
    setBusy(true);
    setError('');
    const res = await onExtend(mins);
    setBusy(false);
    if (res?.error) { setError(res.error.message || 'Could not add time'); return; }
    setExtending(false);
    setExtendMins('');
  }

  if (unlockedAt) {
    return (
      <span className="assessment-lock-control">
        {remainingLabel != null && (
          <span className={`assessment-timer ${expired ? 'expired' : ''}`}>
            {expired ? '⏱ Time’s up' : `⏱ ${remainingLabel}`}
          </span>
        )}
        {deadlineMs != null && (extending ? (
          <>
            <input
              type="number"
              min="1"
              className="form-input assessment-minutes-input"
              placeholder="Add minutes"
              value={extendMins}
              onChange={e => setExtendMins(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') doExtend(); if (e.key === 'Escape') setExtending(false); }}
              autoFocus
            />
            <button className="ghost-link" onClick={doExtend} disabled={busy || extendMins.trim() === ''}>
              {expired ? 'Reopen' : 'Add'}{extendMins.trim() === '' ? '' : ` · ${extendMins}m`}
            </button>
            <button className="ghost-link" onClick={() => { setExtending(false); setExtendMins(''); }} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className="ghost-link"
            onClick={() => setExtending(true)}
            disabled={busy}
            title={expired ? 'Reopen the assessment for more time' : 'Add more time to the running timer'}
          >
            {expired ? '⏱ Reopen / add time' : '⏱ Extend time'}
          </button>
        ))}
        <button
          className="ghost-link"
          onClick={doLock}
          disabled={busy}
          title="Re-lock so participants can't access the assessment"
        >
          🔓 Lock assessment
        </button>
        {error && <span className="assessment-lock-error">{error}</span>}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        className="ghost-link"
        onClick={() => setEditing(true)}
        title="Unlock the assessment for all enrolled participants"
      >
        🔒 Unlock assessment
      </button>
    );
  }

  return (
    <span className="assessment-lock-control">
      <input
        type="number"
        min="1"
        className="form-input assessment-minutes-input"
        placeholder="Minutes (optional)"
        value={minutes}
        onChange={e => setMinutes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') doUnlock(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      <button className="ghost-link" onClick={doUnlock} disabled={busy}>
        {minutes.trim() === '' ? 'Unlock (untimed)' : `Unlock · ${minutes}m`}
      </button>
      <button className="ghost-link" onClick={() => { setEditing(false); setMinutes(''); }} disabled={busy}>
        Cancel
      </button>
      {error && <span className="assessment-lock-error">{error}</span>}
    </span>
  );
}

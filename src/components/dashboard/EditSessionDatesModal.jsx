import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import { formatRange, toDateInput } from '../../lib/sessionDates.js';

// Change when a session runs.
//
// Until now the dates could only be set at creation. A session booked for the
// wrong week had to be deleted and rebuilt — taking its participants, answers
// and prep with it — or left wrong, which put it on the wrong page of the
// calendar for everybody.
//
// The two rules here are the same two the database enforces in a trigger
// (20260914000000_session_dates_required): both dates are required, and the
// end cannot precede the start. Checking them here as well is not duplication
// for its own sake — it means the reader is told before a round trip, and the
// Save button can say so. The trigger stays the authority, and its message is
// surfaced verbatim if anything gets past this.
export default function EditSessionDatesModal({ session, onSave, onClose }) {
  useBodyScrollLock();

  const [startsAt, setStartsAt] = useState(() => toDateInput(session?.starts_at));
  const [endsAt, setEndsAt] = useState(() => toDateInput(session?.ends_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Both are yyyy-mm-dd, which sorts lexicographically — so a string compare is
  // a date compare, with no parsing and no timezone in the way.
  const problem =
    !startsAt && !endsAt ? 'Give this session a start and end date.'
    : !startsAt ? 'Give this session a start date.'
    : !endsAt ? 'Give this session an end date.'
    : endsAt < startsAt ? 'End date cannot be before start date.'
    : '';

  const unchanged =
    startsAt === toDateInput(session?.starts_at) &&
    endsAt === toDateInput(session?.ends_at);

  async function submit() {
    if (problem) { setErr(problem); return; }
    setBusy(true);
    setErr('');
    const { error } = await onSave(startsAt, endsAt);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onClose();
  }

  return (
    <div className="modal-backdrop visible" onClick={() => !busy && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Edit session dates</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </header>

        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            {session?.starts_at || session?.ends_at
              ? <>Currently <strong>{formatRange(session.starts_at, session.ends_at)}</strong>.</>
              : <>This session has no dates yet, so it does not appear on the calendar.</>}
          </p>

          {/* Same markup as the new-session form's date pair, so the two read
              as the same control rather than as two takes on one. */}
          <div className="form-grid">
            <div>
              <label className="form-label">From date</label>
              <input
                className="form-input"
                type="date"
                value={startsAt}
                onChange={e => { setStartsAt(e.target.value); setErr(''); }}
                autoFocus
              />
            </div>
            <div>
              <label className="form-label">To date</label>
              {/* min, not min+1: a one-day session is normal, so the end may
                  equal the start. Stops the invalid range being expressible in
                  the picker rather than only catching it afterwards. */}
              <input
                className="form-input"
                type="date"
                value={endsAt}
                min={startsAt || undefined}
                onChange={e => { setEndsAt(e.target.value); setErr(''); }}
              />
            </div>
          </div>

          {/* A one-day session is a normal thing to book, so say what will be
              saved rather than leaving two identical dates looking like a
              mistake. */}
          {!problem && (
            <p className="muted">
              Will read as <strong>{formatRange(startsAt, endsAt)}</strong>.
            </p>
          )}

          {err && <p className="error">{err}</p>}
        </div>

        <footer className="modal-foot">
          <button type="button" onClick={submit} disabled={busy || !!problem || unchanged}>
            {busy ? 'Saving…' : 'Save dates'}
          </button>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}

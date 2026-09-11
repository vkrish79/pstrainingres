import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';

// Record that a participant dropped out mid-session.
//
// Offered instead of "Remove from session" once someone has started: removing
// hard-deletes the account and every answer with it, which is the wrong
// outcome for a person who took part and then left. Deactivating keeps all of
// it, takes them out of the close-session progress check, and puts the reason
// on the session record. It is reversible, and it does not stop them logging in.
export default function DeactivateParticipantModal({ participant, progressLabel, startedSinceLoad, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useBodyScrollLock(true);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function submit(e) {
    e.preventDefault();
    const text = reason.trim();
    if (!text) { setError('Enter a reason.'); return; }
    setBusy(true);
    setError('');
    const { error: err } = await onConfirm(text);
    setBusy(false);
    if (err) setError(err.message);
  }

  const name = participant?.full_name || 'this participant';

  return (
    <div className="modal-backdrop visible" onClick={() => { if (!busy) onCancel(); }}>
      <form className="modal-card" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-head">
          <h2>Deactivate {name}?</h2>
          <button type="button" className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          {startedSinceLoad && (
            <p className="close-check-warn">
              {name} has started since this page loaded, so they can’t be removed — their answers would be deleted.
            </p>
          )}
          <p>
            Use this when someone drops out part-way through.
            {progressLabel ? <> They’re at <strong>{progressLabel}</strong> on the workbook.</> : null}
          </p>
          <ul className="confirm-list">
            <li>Their answers are <strong>kept</strong> and appear in the session record.</li>
            <li>They’re left out of the 50% progress check when the session closes.</li>
            <li>You can reactivate them later. Their login still works.</li>
          </ul>
          <label htmlFor="deactivate-reason" className="form-label">Reason for deactivation</label>
          <textarea
            id="deactivate-reason"
            className="form-input"
            rows={3}
            maxLength={2000}
            autoFocus
            placeholder="e.g. Called back to operations on day 2"
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={busy}
          />
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="danger" disabled={busy || !reason.trim()}>
            {busy ? 'Deactivating…' : 'Deactivate'}
          </button>
        </footer>
      </form>
    </div>
  );
}

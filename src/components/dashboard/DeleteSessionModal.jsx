// Shared confirm modal for permanently deleting a session. Used on both the
// live dashboard and the closed-snapshot view — the wording adapts to
// whichever the trainer is staring at, but the action (and irreversibility)
// is the same: every session-scoped row + the clone workbook + remaining
// participant accounts are wiped.
export default function DeleteSessionModal({ sessionName, participantCount, isClosed, error, busy, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop visible" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <header className="modal-head">
          <h2>Delete this session?</h2>
          <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p>Permanently deleting <strong>{sessionName}</strong> will:</p>
          <ul className="confirm-list">
            {isClosed ? (
              <li><strong>Discard the saved summary</strong> of this session — answers, notes, and analytics are gone forever.</li>
            ) : (
              <>
                <li><strong>Permanently delete</strong> all {participantCount} participant{participantCount === 1 ? '' : 's'} and their accounts.</li>
                <li><strong>Wipe</strong> every answer, note, and prep entry for this session.</li>
              </>
            )}
            <li>Remove the session’s workbook copy.</li>
          </ul>
          <p className="muted"><strong>This cannot be undone.</strong> The session will not appear in any list afterwards.</p>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : 'Yes, delete session'}</button>
        </footer>
      </div>
    </div>
  );
}

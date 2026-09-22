import { useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';

// Sending a changed scorecard to sessions that have already started.
//
// Nothing is ticked when this opens, deliberately: the safe outcome is the one
// that happens if the dialog is dismissed. A session where anyone has answered
// or been marked cannot be ticked at all — it is listed with the reason, so the
// trainer can see WHY rather than hunt for a disabled checkbox.
export default function CriteriaPushModal({ eligible, blocked, pushing, onPush, onClose }) {
  useBodyScrollLock(true);
  const [picked, setPicked] = useState(() => new Set());
  const [done, setDone] = useState(null);

  function toggle(id) {
    setPicked(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function confirm() {
    const { data, error } = await onPush([...picked]);
    if (error) return;
    setDone(data || []);
  }

  const n = picked.size;

  return (
    <div className="modal-backdrop visible" onClick={() => { if (!pushing) onClose(); }}>
      <div className="modal-card criteria-push-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{done ? 'Scorecard sent' : 'Send this scorecard to sessions already running?'}</h2>
          <button className="icon-btn" onClick={onClose} disabled={pushing} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {done ? (
            <>
              <p>
                {done.length === 0
                  ? 'No sessions were updated.'
                  : `${done.length} session${done.length === 1 ? '' : 's'} took the change.`}
              </p>
              {done.some(d => d.questions_updated === 0) && (
                <p className="muted">
                  Some took nothing: their questions have no criteria on the
                  programme yet, so there was nothing to copy.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="muted">
                Sessions that haven’t started already have this — they read the
                programme’s scorecard directly. These are the ones that have begun.
              </p>

              {eligible.length > 0 && (
                <>
                  <h3 className="cp-h">Can take the change</h3>
                  <ul className="cp-list">
                    {eligible.map(r => (
                      <li key={r.id} className={`cp-item ${picked.has(r.id) ? 'picked' : ''}`}>
                        <input
                          type="checkbox"
                          id={`cp-${r.id}`}
                          checked={picked.has(r.id)}
                          disabled={pushing}
                          onChange={() => toggle(r.id)}
                        />
                        <label htmlFor={`cp-${r.id}`}>
                          <span className="cp-name">{r.session?.name || 'Untitled session'}</span>
                          <span className="cp-meta">{dateLabel(r.session)}</span>
                          <span className="cp-why">Nobody has answered or been marked yet.</span>
                        </label>
                        <span className="cp-state ok">Ready</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {blocked.length > 0 && (
                <>
                  <h3 className="cp-h">Can’t take it</h3>
                  <ul className="cp-list">
                    {blocked.map(r => (
                      <li key={r.id} className="cp-item off">
                        <input type="checkbox" disabled aria-label={`${r.session?.name || 'Session'} cannot take this change`} />
                        <span>
                          <span className="cp-name">{r.session?.name || 'Untitled session'}</span>
                          <span className="cp-meta">{dateLabel(r.session)}</span>
                          <span className="cp-why stop">{whyBlocked(r)}</span>
                        </span>
                        <span className="cp-state no">{r.marks > 0 ? 'Marking started' : 'Answers exist'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {eligible.length === 0 && blocked.length === 0 && (
                <p>No sessions have started with this assessment yet, so there is nothing to send.</p>
              )}

              <p className="cp-note">
                Changing a scorecard under marks already given would move scores
                nobody re-checked — so a session with any answer or mark refuses
                it rather than warning about it.
              </p>
            </>
          )}
        </div>

        <footer className="modal-foot">
          {done ? (
            <button type="button" className="primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={pushing}>Not now</button>
              <button type="button" className="primary" onClick={confirm} disabled={pushing || n === 0}>
                {pushing ? 'Sending…' : `Update ${n} session${n === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function whyBlocked(r) {
  if (r.marks > 0) {
    return `${r.marks} mark${r.marks === 1 ? ' has' : 's have'} been given. A changed scorecard would move scores nobody re-checked.`;
  }
  return `${r.answers} answer${r.answers === 1 ? ' has' : 's have'} been submitted, so this paper is being sat.`;
}

function dateLabel(session) {
  if (!session?.starts_at) return 'No dates set';
  const fmt = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return session.ends_at && session.ends_at !== session.starts_at
    ? `${fmt(session.starts_at)} – ${fmt(session.ends_at)}`
    : fmt(session.starts_at);
}

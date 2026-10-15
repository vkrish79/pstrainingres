import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { useActivePoll } from '../../hooks/useActivePoll.js';
import SessionFeaturesList from '../sessions/SessionFeaturesList.jsx';
import '../../styles/session-drawer.css';

// Cockpit ⋮ → Session features…: change what this class uses while it runs.
// The same slide-over and the same tick list as the New session drawer.
//
// Changes reach participants over realtime (useSessionFeatures). Off hides,
// never deletes. A quiz or poll that is live right now can't be switched off
// until it is stopped — pulling it from under a room mid-question would leave
// sixteen phones on a screen that no longer exists.
//
//   features — the page's useSessionFeatures(): { off, save }
//   facts, kept — passed straight to SessionFeaturesList.
export default function SessionFeaturesPanel({ open, onClose, sessionId, features, facts, kept }) {
  const [draft, setDraft] = useState(features.off);
  const [error, setError] = useState('');
  const { run: runBusy } = useBusyOverlay();
  useBodyScrollLock(open);
  // Only asked while the panel is open. The poll hook just polls; the quiz is
  // read once on open rather than through useActiveQuizRun, whose realtime
  // channel is named per session — the Quiz tab behind this panel already
  // holds it, and realtime-js hands back the SAME channel for the same name,
  // so a second subscriber would break the first.
  const poll = useActivePoll(open ? sessionId : null);
  const [quizLive, setQuizLive] = useState(false);
  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let cancelled = false;
    // Same test as useActiveQuizRun: not ended, started in the last 12 hours.
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    supabase.from('quiz_runs').select('id').eq('session_id', sessionId)
      .is('ended_at', null).gt('started_at', cutoff).limit(1)
      .then(({ data }) => { if (!cancelled) setQuizLive(!!data?.length); });
    return () => { cancelled = true; };
  }, [open, sessionId]);

  // Start from what is saved each time it opens.
  useEffect(() => {
    if (open) { setDraft(features.off); setError(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const locked = {};
  if (quizLive) locked.quiz = 'Running now, stop it first';
  if (poll.run) locked.polls = 'Running now, stop it first';

  const changed = [...draft].sort().join(',') !== [...features.off].sort().join(',');
  const workbookGoingOff = draft.includes('workbook') && !features.off.includes('workbook');

  async function save() {
    setError('');
    const { error: e } = await runBusy('Saving session features…', () => features.save(draft));
    if (e) { setError(e.message); return; }
    onClose();
  }

  return (
    <>
      <div className={`session-drawer-backdrop${open ? ' visible' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`session-drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Session features"
        aria-hidden={open ? undefined : 'true'}
      >
        <header className="session-drawer-head">
          <div>
            <h2>Session features</h2>
            <p className="session-drawer-sub">
              Changes reach participants' screens straight away. Turning something off hides it.
              Nothing already collected is deleted, and it all comes back if you turn the feature on again.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="session-drawer-body">
          {open && (
            <SessionFeaturesList
              off={draft}
              onChange={setDraft}
              facts={facts}
              locked={locked}
              kept={kept}
              idPrefix="cockpit-feat"
              warning={workbookGoingOff && kept.workbook ? (
                <p className="sf-warn">
                  People in this class have started the workbook. Their answers are kept and come
                  back if you switch it on again. The heat board and stuck radar stop.
                </p>
              ) : null}
            />
          )}
          {error && <p className="error sf-panel-error">{error}</p>}
        </div>
        <footer className="session-drawer-foot">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" onClick={save} disabled={!changed}>Save</button>
        </footer>
      </aside>
    </>
  );
}

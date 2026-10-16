import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useSessionPrep } from '../hooks/useSessionPrep.js';
import SessionPrepGrid from '../components/dashboard/SessionPrepGrid.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import LoadFailed from '../components/LoadFailed.jsx';

// Full-page, session-scoped editable prep sheet (reached from the Session
// Dashboard). Fixes bad/expired prep for already-allocated participants without
// re-issuing a whole kit — edits land in participant_prep, live to the drawer.
export default function SessionPrepPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session, sections, blocks, answers, participants, prepEnabled, loading, error, reload } = useSessionDashboard(id);
  // Prep's own `loading` is not waited on: it goes true again on every realtime
  // refresh, so gating on it would blank the grid each time anyone saved a cell.
  const { prep, saveOne, error: prepError, refresh: refreshPrep } = useSessionPrep(id);
  const [dirty, setDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState(null); // where an interrupted link was going

  // Unsaved edits live only in the sheet, so leaving loses them. The app runs
  // on a plain BrowserRouter (no data router, so no useBlocker): catch in-app
  // link clicks here instead, and let the browser ask on reload or tab close.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e) { e.preventDefault(); e.returnValue = ''; }
    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank') return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search + url.hash);
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const failed = error || prepError;
  function retry() {
    if (error) reload();
    if (prepError) refreshPrep();
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to={`/trainer/sessions/${id}`} className="back-link">← Back to session</Link>
            <h1>Manage prep{session?.name ? ` — ${session.name}` : ''}</h1>
            <p>Edit any participant's prep right in the sheet, then save. Saved changes show in their prep drawer straight away.</p>
            {leaveTo && (
              <div className="prep-edit-confirm" role="alertdialog" aria-label="Unsaved changes">
                <p className="prep-edit-confirm-text"><strong>You have unsaved changes.</strong> Leave and lose them?</p>
                <div className="prep-edit-confirm-actions">
                  <button type="button" className="ghost" onClick={() => setLeaveTo(null)}>Stay</button>
                  <button type="button" onClick={() => { const to = leaveTo; setDirty(false); setLeaveTo(null); navigate(to); }}>
                    Discard and leave
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="editor-card">
          {loading && !failed ? (
            <SkeletonTable rows={6} cols={5} label="Loading prep…" />
          ) : failed ? (
            <LoadFailed what="this session's prep" error={failed} onRetry={retry} />
          ) : !prepEnabled ? (
            <p className="muted">Prep isn't enabled for this session.</p>
          ) : (
            <SessionPrepGrid
              participants={participants}
              sections={sections}
              prep={prep}
              blocks={blocks}
              answers={answers}
              onSave={saveOne}
              onReload={refreshPrep}
              onDirtyChange={setDirty}
            />
          )}
        </section>
      </main>
    </>
  );
}

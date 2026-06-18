import { useParams, Link } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useSessionPrep } from '../hooks/useSessionPrep.js';
import SessionPrepGrid from '../components/dashboard/SessionPrepGrid.jsx';

// Full-page, session-scoped editable prep grid (reached from the Session
// Dashboard). Fixes bad/expired prep for already-allocated participants without
// re-issuing a whole kit — edits land in participant_prep, live to the drawer.
export default function SessionPrepPage() {
  const { id } = useParams();
  const { session, sections, participants, prepEnabled, loading } = useSessionDashboard(id);
  const { prep, saveOne } = useSessionPrep(id);

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to={`/trainer/sessions/${id}`} className="back-link">← Back to session</Link>
            <h1>Manage prep{session?.name ? ` — ${session.name}` : ''}</h1>
            <p>Click an exercise heading to replace its prep for every participant. Changes show in their prep drawer instantly.</p>
          </div>
        </section>
        <section className="editor-card">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : !prepEnabled ? (
            <p className="muted">Prep isn't enabled for this session.</p>
          ) : (
            <SessionPrepGrid participants={participants} sections={sections} prep={prep} onSave={saveOne} />
          )}
        </section>
      </main>
    </>
  );
}

import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerWorkbooks } from '../hooks/useTrainerWorkbooks.js';
import { useEditHeatTotals } from '../hooks/useWorkbookEditHeat.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import { heatLevel } from '../lib/configDiff.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/edit-heat.css';

// The template library, lifted out of the bottom of the sessions page.
//
// It was never a session. It sat there because it had nowhere else to live, and
// the cost was two workbook buttons in the action bar of a page about sessions
// and a library that only existed below the fold.
//
// OPEN TO EVERY TRAINER, not super-only like Programs and Assessments beside it
// in the rail. That distinction is load-bearing: this page is a vendor
// trainer's only route to the templates they deliver from, and
// useTrainerWorkbooks already narrows non-super roles to vendor_visible rows.
// What IS super-only is authoring — the two buttons below.
export default function WorkbooksPage() {
  const { profile, session: authSession } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { loading, workbooks } = useTrainerWorkbooks(authSession?.user.id, profile?.role);
  const heatTotals = useEditHeatTotals(isSuper);

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <h1>Workbooks</h1>
            <p className="muted">
              {loading
                ? 'Loading…'
                : `${workbooks.length} template${workbooks.length === 1 ? '' : 's'}.`}
              {' '}Sessions are built from these.
            </p>
          </div>
          {isSuper && (
            <div className="page-hero-actions">
              <Link to="/trainer/workbooks/import" className="ghost-link">↑ Import .docx</Link>
              <Link to="/trainer/workbooks/new" className="primary-link">+ New workbook</Link>
            </div>
          )}
        </section>

        {loading && <div className="loading">Loading…</div>}

        {!loading && workbooks.length === 0 && (
          <p className="muted">
            No workbooks yet.
            {isSuper && <> Create one, or import a .docx.</>}
          </p>
        )}

        {!loading && workbooks.length > 0 && (
          <div className="session-grid">
            {workbooks.map(w => (
              <Link key={w.id} to={`/trainer/workbooks/${w.id}`} className="session-card">
                <h3>{w.title}</h3>
                {w.description && <p className="session-card-workbook">{w.description}</p>}
                <p className="session-card-meta">
                  Updated {new Date(w.updated_at).toLocaleDateString()}
                </p>
                {heatTotals.get(w.id) && (
                  <p className="wb-card-heat">
                    <span className={`heat-dot heat-l${heatLevel(heatTotals.get(w.id).sessionCount)}`} aria-hidden />
                    {heatTotals.get(w.id).sectionCount} to review
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

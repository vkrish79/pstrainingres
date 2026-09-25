import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonCards } from '../components/Skeleton.jsx';
import WorkbookPreviewModal from '../components/workbook/WorkbookPreviewModal.jsx';
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
  const [preview, setPreview] = useState(null);   // { id, title } | null

  return (
    <>
      <TopBar />
      <main className="page">
        {/* NO HERO. The rail says Workbooks and so does the app bar; a third
            heading saying it again, over a sentence explaining what a workbook
            is, was a band of the page that told a returning user nothing. What
            is left is what you came here to do. */}
        {isSuper && (
          <section className="page-bar">
            <div className="page-bar-actions">
              <Link to="/trainer/workbooks/import" className="ghost-link">↑ Import .docx</Link>
              <Link to="/trainer/workbooks/new" className="primary-link">+ New workbook</Link>
            </div>
          </section>
        )}

        {loading && <SkeletonCards count={6} label="Loading workbooks…" />}

        {!loading && workbooks.length === 0 && (
          <p className="muted">
            No workbooks yet.
            {isSuper && <> Create one, or import a .docx.</>}
          </p>
        )}

        {!loading && workbooks.length > 0 && (
          <div className="session-grid">
            {/* The card was one big <Link>. It cannot stay that way once it has a
                Preview button: a button inside an anchor is invalid markup and a
                click would follow the link as well as open the preview. So the
                title is the link and the actions are buttons — the same shape the
                quizzes list already uses. */}
            {workbooks.map(w => (
              <div key={w.id} className="session-card">
                <h3>
                  <Link to={`/trainer/workbooks/${w.id}`}>{w.title}</Link>
                </h3>
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
                <div className="wb-card-actions">
                  <button
                    type="button"
                    className="ghost"
                    data-tip="Read it as a book, the way a participant meets it"
                    onClick={() => setPreview({ id: w.id, title: w.title })}
                  >
                    📖 Preview
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {preview && (
        <WorkbookPreviewModal
          workbookId={preview.id}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

import { useMemo, useState } from 'react';
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
// What IS super-only is authoring — the two buttons in the hero.
//
// IN THE COCKPIT, like Sessions, Programmes and Analytics. Same classes, not a
// second visual language: cockpit-page-title, a compact hero carrying the
// filters and the actions, a gauge strip, then the library. What this page
// deliberately does NOT have yet is the pane-and-rail split those pages use —
// a detail rail earns its place at twenty workbooks, not at four.
//
// EVERY FIGURE HERE IS FREE. Workbook rows and the edit-heat totals are already
// loaded; the counts below are arithmetic over them. The genuinely useful
// questions — which templates are attached to a programme, which are running in
// a room right now — need a join this page does not make, and are deliberately
// left out rather than guessed at.
const MONTH = 1000 * 60 * 60 * 24 * 30;

export default function WorkbooksPage() {
  const { profile, session: authSession } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { loading, workbooks } = useTrainerWorkbooks(authSession?.user.id, profile?.role);
  const heatTotals = useEditHeatTotals(isSuper);
  const [preview, setPreview] = useState(null);   // { id, title } | null
  const [filter, setFilter] = useState('all');    // 'all' | 'review' | 'stale'
  const [find, setFind] = useState('');

  // Everything the strip and the filters need, in one pass over rows we have.
  const stats = useMemo(() => {
    const now = Date.now();
    let reviewSections = 0;
    let reviewBooks = 0;
    let fresh = 0;
    let oldest = null;
    for (const w of workbooks) {
      const heat = heatTotals.get(w.id);
      if (heat) { reviewSections += heat.sectionCount; reviewBooks += 1; }
      const t = new Date(w.updated_at).getTime();
      if (now - t < MONTH) fresh += 1;
      if (!oldest || t < oldest.t) oldest = { t, title: w.title };
    }
    return { reviewSections, reviewBooks, fresh, oldest };
  }, [workbooks, heatTotals]);

  const isStale = w => Date.now() - new Date(w.updated_at).getTime() >= MONTH * 3;

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return workbooks.filter(w => {
      if (filter === 'review' && !heatTotals.get(w.id)) return false;
      if (filter === 'stale' && !isStale(w)) return false;
      if (!q) return true;
      return `${w.title} ${w.description || ''}`.toLowerCase().includes(q);
    });
  }, [workbooks, filter, find, heatTotals]);

  const staleCount = workbooks.filter(isStale).length;

  return (
    <>
      <TopBar />
      <main className="page dashboard workbooks-page">
        <header className="cockpit-page-title">
          <h1>Workbooks</h1>
        </header>

        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show workbooks">
              {[
                ['all', `All · ${workbooks.length}`],
                ['review', `To review · ${stats.reviewBooks}`],
                ['stale', `Not touched in 3 months · ${staleCount}`],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`view-tab ${filter === k ? 'active' : ''}`}
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="page-hero-text">
              <p className="cockpit-hero-sub">
                Editing a template reaches every class that has not started yet.
              </p>
            </div>
            <div className="page-hero-actions">
              {/* The search box is here rather than over the grid because it
                  filters the same set the tabs do, and two filters in two
                  places read as two unrelated controls. */}
              <input
                type="search"
                className="form-input wb-find"
                placeholder="Find a workbook…"
                aria-label="Find a workbook"
                value={find}
                onChange={e => setFind(e.target.value)}
              />
              {isSuper && <Link to="/trainer/workbooks/import" className="ghost-link">↑ Import .docx</Link>}
              {isSuper && <Link to="/trainer/workbooks/new" className="primary-link">+ New workbook</Link>}
            </div>
          </div>
        </section>

        {loading && <SkeletonCards count={6} label="Loading workbooks…" />}

        {!loading && workbooks.length > 0 && (
          <section className="cockpit-gauges wb-gauges" aria-label="Workbooks at a glance">
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Workbooks</div>
                <div className="cockpit-gauge-value">{workbooks.length}</div>
                <div className="cockpit-gauge-hint">templates you can deliver from</div>
              </div>
            </div>
            {/* The only gauge that ever asks for anything, so the only one that
                is allowed to carry an edge. */}
            <div className={`cockpit-gauge ${stats.reviewSections > 0 ? 'is-warn' : ''}`}>
              <div>
                <div className="cockpit-gauge-label">To review</div>
                <div className="cockpit-gauge-value">
                  {stats.reviewSections}<small> section{stats.reviewSections === 1 ? '' : 's'}</small>
                </div>
                <div className="cockpit-gauge-hint">
                  {stats.reviewBooks === 0
                    ? 'nothing changed in a class'
                    : `in ${stats.reviewBooks} workbook${stats.reviewBooks === 1 ? '' : 's'}, from class edits`}
                </div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Edited recently</div>
                <div className="cockpit-gauge-value">{stats.fresh}<small> / {workbooks.length}</small></div>
                <div className="cockpit-gauge-hint">in the last 30 days</div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Oldest edit</div>
                <div className="cockpit-gauge-value">
                  {stats.oldest ? monthsSince(stats.oldest.t) : '—'}
                </div>
                <div className="cockpit-gauge-hint">{stats.oldest?.title || 'nothing yet'}</div>
              </div>
            </div>
          </section>
        )}

        {!loading && workbooks.length === 0 && (
          <p className="cockpit-empty">
            No workbooks yet.
            {isSuper && <> Create one, or import a .docx.</>}
          </p>
        )}

        {!loading && workbooks.length > 0 && shown.length === 0 && (
          <p className="cockpit-empty">Nothing here with this filter.</p>
        )}

        {!loading && shown.length > 0 && (
          <div className="wb-grid">
            {/* The card was one big <Link>. It cannot stay that way once it has
                buttons: a button inside an anchor is invalid markup and a click
                would follow the link as well. So the title is the link and the
                actions are buttons — the same shape the quizzes list uses. */}
            {shown.map(w => {
              const heat = heatTotals.get(w.id);
              return (
                <article key={w.id} className="wb-card">
                  <div className="wb-card-body">
                    <div className="wb-card-top">
                      <h3 className="wb-card-title">
                        <Link to={`/trainer/workbooks/${w.id}`}>{w.title}</Link>
                      </h3>
                      {/* The one thing on this card that needs somebody to do
                          something, so it reads as a status and not as a
                          sentence in the middle of the card. */}
                      {heat && (
                        <span className="wb-pill is-review">
                          <span className={`heat-dot heat-l${heatLevel(heat.sessionCount)}`} aria-hidden />
                          {heat.sectionCount} to review
                        </span>
                      )}
                    </div>
                    {w.description && <p className="wb-card-desc">{w.description}</p>}
                    {/* Pushed to the bottom by margin-top:auto, so the action
                        bar sits on the same line on every card whether or not
                        there is a description above it. */}
                    <p className="wb-card-facts">
                      <span>Updated <b>{shortDate(w.updated_at)}</b></span>
                      {isStale(w) && <span className="wb-stale">not touched in 3 months</span>}
                    </p>
                  </div>
                  <div className="wb-card-actions">
                    <Link to={`/trainer/workbooks/${w.id}`} className="wb-act">Open</Link>
                    <button
                      type="button"
                      className="wb-act"
                      data-tip="Read it as a book, the way a participant meets it"
                      onClick={() => setPreview({ id: w.id, title: w.title })}
                    >
                      Preview
                    </button>
                  </div>
                </article>
              );
            })}
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

// "19 Jul" for this year, "19 Jul 2025" for any other — the year is noise on a
// library that is mostly edited within one.
function shortDate(iso) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Whole months, floored, because "3 mo" is the useful reading and "94 days"
// is not. Under a month reads as days so it never shows a bare zero.
function monthsSince(t) {
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)} mo`;
}

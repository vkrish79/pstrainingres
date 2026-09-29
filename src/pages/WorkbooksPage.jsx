import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SkeletonCards } from '../components/Skeleton.jsx';
import WorkbookPreviewModal from '../components/workbook/WorkbookPreviewModal.jsx';
import CreateDialog from '../components/library/CreateDialog.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { supabase } from '../lib/supabase.js';
import { useTrainerWorkbooks } from '../hooks/useTrainerWorkbooks.js';
import { useEditHeatTotals } from '../hooks/useWorkbookEditHeat.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import { heatLevel } from '../lib/configDiff.js';
import { shortDate, shortRange } from '../lib/programReadiness.js';
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
// IN THE COCKPIT, like Sessions, Programs and Analytics. Same classes, not a
// second visual language: a compact hero carrying the filters and the actions,
// a gauge strip, then the pane-and-rail split. No page heading and no
// explanatory line — the rail and the app bar both already say Workbooks.
//
// THE QUESTION THIS PAGE EXISTS TO ANSWER is not "what templates are there" —
// the titles were never in doubt — but "which of these matters". So the
// organising fact is the program a template is attached to and the classes
// running on it, and an unattached workbook is called out rather than left
// looking identical to one in daily use.
const MONTH = 1000 * 60 * 60 * 24 * 30;
const STALE = MONTH * 3;

export default function WorkbooksPage() {
  const navigate = useNavigate();
  const { profile, session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { loading, workbooks } = useTrainerWorkbooks(authSession?.user.id, profile?.role);
  const [creating, setCreating] = useState(false);
  const heatTotals = useEditHeatTotals(isSuper);
  const [preview, setPreview] = useState(null);   // { id, title } | null
  const [filter, setFilter] = useState('all');    // 'all' | 'used' | 'unused' | 'review'
  const [find, setFind] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // MOUNT AND OPEN ARE SEPARATE, one pair of frames apart. A CSS transition
  // needs a previous state to travel from, so a panel rendered already open
  // simply appears; and clearing the selection on close would unmount it
  // before it could travel back. selectedId therefore survives the slide out
  // and is cleared when it lands.
  const [railOpen, setRailOpen] = useState(false);

  const isStale = w => Date.now() - new Date(w.updated_at).getTime() >= STALE;

  // Everything the strip and the filters need, in one pass over rows we have.
  const stats = useMemo(() => {
    let reviewSections = 0;
    let reviewBooks = 0;
    let used = 0;
    let running = 0;
    let runningBooks = 0;
    let oldest = null;
    for (const w of workbooks) {
      const heat = heatTotals.get(w.id);
      if (heat) { reviewSections += heat.sectionCount; reviewBooks += 1; }
      if (w.program) used += 1;
      if (w.classes.running.length) { running += w.classes.running.length; runningBooks += 1; }
      const t = new Date(w.updated_at).getTime();
      if (!oldest || t < oldest.t) oldest = { t, title: w.title };
    }
    return { reviewSections, reviewBooks, used, running, runningBooks, oldest };
  }, [workbooks, heatTotals]);

  const unused = workbooks.length - stats.used;

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return workbooks.filter(w => {
      if (filter === 'used' && !w.program) return false;
      if (filter === 'unused' && w.program) return false;
      if (filter === 'review' && !heatTotals.get(w.id)) return false;
      if (!q) return true;
      return `${w.title} ${w.description || ''} ${w.program?.title || ''}`.toLowerCase().includes(q);
    });
  }, [workbooks, filter, find, heatTotals]);

  // Held on the FULL list, not the filtered one, so the panel still has
  // something to draw while it slides out after a filter hides the card.
  const selected = workbooks.find(w => w.id === selectedId) || null;

  function openRail(id) {
    setSelectedId(id);
    // Two frames: the first paints the panel off-screen, the second sends it
    // in. One is enough in most browsers and not in all of them.
    requestAnimationFrame(() => requestAnimationFrame(() => setRailOpen(true)));
  }

  function closeRail() { setRailOpen(false); }

  // Esc closes it, like every other slide-over here.
  useEffect(() => {
    if (!railOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') closeRail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

  // A filter that hides the chosen workbook must not leave its details open
  // over a list it is not in.
  useEffect(() => {
    if (railOpen && selectedId && !shown.some(w => w.id === selectedId)) closeRail();
  }, [railOpen, selectedId, shown]);

  return (
    <>
      <TopBar />
      <main className="page dashboard library-page">
        {/* NO PAGE HEADING, and no line explaining what a workbook is. The rail
            says Workbooks and so does the app bar; a third one saying it again
            over a sentence a returning user has read a hundred times was a band
            of the page that told them nothing. The hero carries controls only. */}
        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show workbooks">
              {[
                ['all', `All · ${workbooks.length}`],
                ['used', `In use · ${stats.used}`],
                ['unused', `Unused · ${unused}`],
                ['review', `To review · ${stats.reviewBooks}`],
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
              {/* Both ways of making a workbook are behind this one button
                  now — the import link used to sit beside it as a second,
                  differently-shaped door, and the blank one was a whole page. */}
              {isSuper && <button type="button" className="lib-new-btn" onClick={() => setCreating(true)}>+ New workbook</button>}
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
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">In use</div>
                <div className="cockpit-gauge-value">{stats.used}<small> / {workbooks.length}</small></div>
                <div className="cockpit-gauge-hint">
                  {unused === 0 ? 'every one attached' : `${unused} on no program`}
                </div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Running now</div>
                <div className={`cockpit-gauge-value${stats.running ? ' state-open' : ' is-muted'}`}>
                  {stats.running}
                </div>
                <div className="cockpit-gauge-hint">
                  {stats.running
                    ? `class${stats.running === 1 ? '' : 'es'} on ${stats.runningBooks} template${stats.runningBooks === 1 ? '' : 's'}`
                    : 'no class in its dates today'}
                </div>
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
                <div className="cockpit-gauge-label">Oldest edit</div>
                <div className="cockpit-gauge-value">{stats.oldest ? monthsSince(stats.oldest.t) : '—'}</div>
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

        {!loading && workbooks.length > 0 && (
          <div className="wb-room">
            <section className="wb-pane">
              {shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}

              {shown.length > 0 && (
                <div className="wb-grid">
                  {/* The card is a single control that opens the details, so it
                      carries no links or buttons of its own — which also settles
                      the button-inside-an-anchor problem that stopped it being
                      one big <Link> in the first place. */}
                  {shown.map(w => {
                    const heat = heatTotals.get(w.id);
                    const on = selected?.id === w.id;
                    return (
                      <article
                        key={w.id}
                        className={`wb-card${on ? ' is-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={on && railOpen}
                        onClick={() => (on && railOpen ? closeRail() : openRail(w.id))}
                        onKeyDown={e => {
                          // A div that behaves like a button has to answer to
                          // the keyboard like one.
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          if (on && railOpen) closeRail(); else openRail(w.id);
                        }}
                      >
                        <div className="wb-card-body">
                          <div className="wb-card-top">
                            <h3 className="wb-card-title">{w.title}</h3>
                            {/* The one thing on this card that needs somebody
                                to do something, so it reads as a status and not
                                as a sentence in the middle of the card. */}
                            {heat && (
                              <span className="wb-pill is-review">
                                <span className={`heat-dot heat-l${heatLevel(heat.sessionCount)}`} aria-hidden />
                                {heat.sectionCount} to review
                              </span>
                            )}
                            {!w.program && <span className="wb-pill is-idle">unused</span>}
                          </div>
                          {w.description && <p className="wb-card-desc">{w.description}</p>}
                          {/* Pushed to the bottom by margin-top:auto, so the
                              action bar sits on the same line on every card
                              whether or not there is a description above it. */}
                          <p className="wb-card-facts">
                            {w.program
                              ? <span className="wb-prog">{w.program.title}</span>
                              : <span className="wb-stale">no program</span>}
                            <span>Updated <b>{shortDate(w.updated_at)}</b></span>
                            {w.classes.total > 0 && (
                              <span>
                                <b>{w.classes.total}</b> class{w.classes.total === 1 ? '' : 'es'}
                                {w.classes.running.length > 0 && (
                                  <span className="wb-running"> · {w.classes.running.length} running</span>
                                )}
                              </span>
                            )}
                            {isStale(w) && <span className="wb-stale">not touched in 3 months</span>}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {creating && (
          <NewWorkbookDialog
            createdBy={authSession?.user.id}
            onClose={() => setCreating(false)}
            onCreate={async row => {
              try {
                const newId = await runBusy('Creating workbook…', async () => {
                  const { data: wb, error: wbErr } = await supabase
                    .from('workbooks')
                    .insert(row)
                    .select()
                    .single();
                  if (wbErr) throw wbErr;
                  // Seed an empty first section so the editor isn't blank —
                  // carried over verbatim from the page this replaced.
                  await supabase.from('sections').insert({ workbook_id: wb.id, title: 'Section 1', order_index: 0 });
                  return wb.id;
                });
                navigate(`/trainer/workbooks/${newId}`);
                return null;
              } catch (e) {
                return e.message;
              }
            }}
          />
        )}

        {/* THE DETAILS ARRIVE OVER THE PAGE, not beside it. Same slide-over
            idiom as the new-session drawer, down to the duration variable, so
            there is one way a panel enters this app and not two. */}
        {selectedId && (
          <>
            <div
              className={`wb-rail-backdrop${railOpen ? ' visible' : ''}`}
              onClick={closeRail}
              aria-hidden="true"
            />
            <aside
              className={`wb-rail-panel${railOpen ? ' open' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="Workbook details"
              aria-hidden={railOpen ? undefined : 'true'}
              onTransitionEnd={e => {
                // Only when the slide OUT has landed, and only for the slide
                // itself -- visibility and opacity fire here too.
                if (e.propertyName === 'transform' && !railOpen) setSelectedId(null);
              }}
            >
              {selected && (
                <div className="wb-rail-card">
                  <div className="wb-rail-head">
                    <h2>{selected.title}</h2>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Close details"
                      onClick={closeRail}
                    >
                      ×
                    </button>
                  </div>
                  {selected.description && <p className="wb-rail-desc">{selected.description}</p>}

                  <dl className="wb-rail-facts">
                    <div><dt>Program</dt><dd>{selected.program
                      ? <Link to={`/trainer/programs/${selected.program.id}`}>{selected.program.title}</Link>
                      : <span className="wb-stale">none — nobody delivers this</span>}</dd></div>
                    <div><dt>Updated</dt><dd>{shortDate(selected.updated_at)}</dd></div>
                    <div><dt>Classes</dt><dd>
                      {selected.classes.total === 0 ? 'none yet' : (
                        <>
                          {selected.classes.total} · {selected.classes.open.length} open
                          {selected.classes.running.length > 0 && `, ${selected.classes.running.length} running`}
                        </>
                      )}
                    </dd></div>
                    <div><dt>To review</dt><dd>
                      {heatTotals.get(selected.id)
                        ? `${heatTotals.get(selected.id).sectionCount} sections changed in class`
                        : 'nothing'}
                    </dd></div>
                  </dl>

                  {/* The classes themselves, newest first. This is the answer to
                      "can I safely edit this?" — an edit reaches every class
                      that has not started, so the ones listed here are who it
                      would reach. */}
                  {selected.classes.list.length > 0 && (
                    <div className="wb-rail-classes">
                      <h3>Classes</h3>
                      <ul>
                        {selected.classes.list.slice(0, 6).map(s => (
                          <li key={s.id}>
                            <Link to={`/trainer/sessions/${s.id}`}>{s.name}</Link>
                            <span className={`wb-class-state is-${s.state.key}`}>{s.state.label}</span>
                            <span className="wb-class-dates">{shortRange(s.starts_at, s.ends_at)}</span>
                          </li>
                        ))}
                      </ul>
                      {selected.classes.list.length > 6 && (
                        <p className="cockpit-empty">+{selected.classes.list.length - 6} more</p>
                      )}
                    </div>
                  )}

                  <div className="wb-rail-actions">
                    <Link to={`/trainer/workbooks/${selected.id}`} className="primary-link">Open editor</Link>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setPreview({ id: selected.id, title: selected.title })}
                    >
                      📖 Preview as a book
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </>
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

// Whole months, floored, because "3 mo" is the useful reading and "94 days"
// is not. Under a month reads as days so it never shows a bare zero.
function monthsSince(t) {
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)} mo`;
}

// A workbook asks the most at birth, and that is why this used to be a whole
// page: the vendor switch is a real access decision and it deserves its
// sentence. It fits in a dialog beside the title and description, which is what
// retired /trainer/workbooks/new.
function NewWorkbookDialog({ createdBy, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vendorVisible, setVendorVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr('');
    const message = await onCreate({
      title: title.trim(),
      description: description.trim() || null,
      vendor_visible: vendorVisible,
      is_template: true,
      created_by: createdBy,
    });
    setBusy(false);
    if (message) setErr(message);
  }

  return (
    <CreateDialog
      heading="New workbook"
      blurb="The material a class is delivered from."
      submitLabel="Create workbook"
      importTo="/trainer/workbooks/import"
      importLabel="Import a .docx"
      busy={busy}
      error={err}
      canSubmit={!!title.trim()}
      onClose={onClose}
      onSubmit={submit}
    >
      <div>
        <label className="form-label" htmlFor="new-workbook-title">Title</label>
        <input
          id="new-workbook-title"
          className="form-input"
          placeholder="e.g. ARD Web Certification – Workbook"
          value={title}
          maxLength={120}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div>
        <label className="form-label" htmlFor="new-workbook-desc">Description <span className="muted">— optional</span></label>
        <input
          id="new-workbook-desc"
          className="form-input"
          placeholder="What this workbook covers"
          value={description}
          maxLength={300}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={vendorVisible} onChange={e => setVendorVisible(e.target.checked)} />
        <span>Make available to vendors <span className="muted">— off for custom or one-off workbooks; on to let vendor trainers run sessions from it</span></span>
      </label>
    </CreateDialog>
  );
}

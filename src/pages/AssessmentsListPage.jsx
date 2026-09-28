import { useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAssessments } from '../hooks/useAssessments.js';
import { useEditHeatTotals } from '../hooks/useWorkbookEditHeat.js';
import { heatLevel } from '../lib/configDiff.js';
import { shortDate, shortRange } from '../lib/programReadiness.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/edit-heat.css';

// The assessment library, in the cockpit — the same shape as Workbooks, which
// is the same shape as Sessions and Programmes. One visual language.
//
// WHAT THIS PAGE IS FOR is not listing titles, which were never in doubt, but
// answering two questions a list of names and dates cannot: is this paper
// FINISHED, and is anyone sitting it. An assessment with no pass mark prints a
// blank Result on every report it ever appears on, and a question with no
// answer key cannot be marked at all — both are invisible until somebody is
// standing in front of a room.
//
// NO PAGE HEADING and no line defining the word: the rail and the app bar both
// already say Assessments.
export default function AssessmentsListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, assessments, createAssessment } = useAssessments({ detail: true });
  // What the field has been changing in a class, per master paper -- the same
  // badge the workbook library carries.
  const heatTotals = useEditHeatTotals(true, 'assessment');

  const [filter, setFilter] = useState('all');   // 'all' | 'used' | 'unused' | 'unfinished' | 'review'
  const [find, setFind] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // Mount and open are one pair of frames apart — a transition needs a previous
  // state to travel from, and clearing the selection on close would unmount the
  // panel before it could travel back. See the workbook library, same pattern.
  const [panelOpen, setPanelOpen] = useState(false);

  // A paper nobody can mark, or nobody can pass. Both are states an author
  // left behind rather than chose.
  const unfinished = a => a.pass_mark == null || a.paper.unkeyed > 0;

  const stats = useMemo(() => {
    let used = 0;
    let running = 0;
    let runningPapers = 0;
    let noPassMark = 0;
    let unkeyed = 0;
    let reviewSections = 0;
    let reviewPapers = 0;
    for (const a of assessments) {
      if (a.program) used += 1;
      if (a.classes.running.length) { running += a.classes.running.length; runningPapers += 1; }
      if (a.pass_mark == null) noPassMark += 1;
      unkeyed += a.paper.unkeyed;
      const heat = heatTotals.get(a.id);
      if (heat) { reviewSections += heat.sectionCount; reviewPapers += 1; }
    }
    return { used, running, runningPapers, noPassMark, unkeyed, reviewSections, reviewPapers };
  }, [assessments, heatTotals]);

  const unusedCount = assessments.length - stats.used;
  const unfinishedCount = assessments.filter(unfinished).length;

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return assessments.filter(a => {
      if (filter === 'used' && !a.program) return false;
      if (filter === 'unused' && a.program) return false;
      if (filter === 'unfinished' && !unfinished(a)) return false;
      if (filter === 'review' && !heatTotals.get(a.id)) return false;
      if (!q) return true;
      return `${a.title} ${a.description || ''} ${a.program?.title || ''}`.toLowerCase().includes(q);
    });
  }, [assessments, filter, find, heatTotals]);

  // Held on the FULL list so the panel still has something to draw while it
  // slides out after a filter hides the card.
  const selected = assessments.find(a => a.id === selectedId) || null;

  function openPanel(id) {
    setSelectedId(id);
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelOpen(true)));
  }
  function closePanel() { setPanelOpen(false); }

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  useEffect(() => {
    if (panelOpen && selectedId && !shown.some(a => a.id === selectedId)) closePanel();
  }, [panelOpen, selectedId, shown]);

  return (
    <>
      <TopBar />
      <main className="page dashboard library-page">
        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show assessments">
              {[
                ['all', `All · ${assessments.length}`],
                ['used', `In use · ${stats.used}`],
                ['unused', `Unused · ${unusedCount}`],
                ['unfinished', `Unfinished · ${unfinishedCount}`],
                ['review', `To review · ${stats.reviewPapers}`],
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
              <input
                type="search"
                className="form-input wb-find"
                placeholder="Find an assessment…"
                aria-label="Find an assessment"
                value={find}
                onChange={e => setFind(e.target.value)}
              />
              <Link to="/trainer/assessments/import" className="ghost-link">↑ Import .docx</Link>
              {/* The create form was a whole card sitting above the library,
                  permanently open for a thing you do occasionally. It is a
                  button that becomes a field, like New programme. */}
              <NewAssessmentControl
                onCreate={async title => {
                  const { data, error: err } = await runBusy(
                    'Creating assessment…',
                    () => createAssessment({ title, created_by: authSession?.user.id }),
                  );
                  if (err) return err.message;
                  if (data?.id) navigate(`/trainer/assessments/${data.id}`);
                  return null;
                }}
              />
            </div>
          </div>
        </section>

        {loading && <SkeletonCards count={6} label="Loading assessments…" />}
        {error && <p className="error">{error}</p>}

        {!loading && !error && assessments.length > 0 && (
          <section className="cockpit-gauges wb-gauges" aria-label="Assessments at a glance">
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Assessments</div>
                <div className="cockpit-gauge-value">{assessments.length}</div>
                <div className="cockpit-gauge-hint">papers in the library</div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">In use</div>
                <div className="cockpit-gauge-value">{stats.used}<small> / {assessments.length}</small></div>
                <div className="cockpit-gauge-hint">
                  {unusedCount === 0 ? 'every one attached' : `${unusedCount} on no programme`}
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
                    ? `class${stats.running === 1 ? '' : 'es'} on ${stats.runningPapers} paper${stats.runningPapers === 1 ? '' : 's'}`
                    : 'no class in its dates today'}
                </div>
              </div>
            </div>
            {/* Two gauges that ask for something, and nothing else carries an
                edge. Both are states an author left behind. */}
            <div className={`cockpit-gauge ${stats.noPassMark > 0 ? 'is-warn' : ''}`}>
              <div>
                <div className="cockpit-gauge-label">No pass mark</div>
                <div className="cockpit-gauge-value">{stats.noPassMark}</div>
                <div className="cockpit-gauge-hint">
                  {stats.noPassMark ? 'Result prints blank without one' : 'every paper has one'}
                </div>
              </div>
            </div>
            <div className={`cockpit-gauge ${stats.reviewSections > 0 ? 'is-warn' : ''}`}>
              <div>
                <div className="cockpit-gauge-label">To review</div>
                <div className="cockpit-gauge-value">
                  {stats.reviewSections}<small> question{stats.reviewSections === 1 ? '' : 's'}</small>
                </div>
                <div className="cockpit-gauge-hint">
                  {stats.reviewPapers === 0
                    ? 'nothing changed in a class'
                    : `in ${stats.reviewPapers} paper${stats.reviewPapers === 1 ? '' : 's'}, from class edits`}
                </div>
              </div>
            </div>
            <div className={`cockpit-gauge ${stats.unkeyed > 0 ? 'is-bad' : ''}`}>
              <div>
                <div className="cockpit-gauge-label">Unkeyed</div>
                <div className="cockpit-gauge-value">{stats.unkeyed}<small> question{stats.unkeyed === 1 ? '' : 's'}</small></div>
                <div className="cockpit-gauge-hint">
                  {stats.unkeyed ? 'cannot be marked at all' : 'every question has a key'}
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !error && assessments.length === 0 && (
          <p className="cockpit-empty">No assessments yet. Use + New assessment to make the first one.</p>
        )}

        {!loading && assessments.length > 0 && (
          <div className="wb-room">
            <section className="wb-pane">
              {shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}

              {shown.length > 0 && (
                <div className="wb-grid">
                  {/* One control per card: it opens the details, and nothing
                      else. Open editor lives in the panel. */}
                  {shown.map(a => {
                    const on = selected?.id === a.id;
                    const heat = heatTotals.get(a.id);
                    return (
                      <article
                        key={a.id}
                        className={`wb-card${on ? ' is-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={on && panelOpen}
                        onClick={() => (on && panelOpen ? closePanel() : openPanel(a.id))}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          if (on && panelOpen) closePanel(); else openPanel(a.id);
                        }}
                      >
                        <div className="wb-card-body">
                          <div className="wb-card-top">
                            <h3 className="wb-card-title">{a.title}</h3>
                            {heat && (
                              <span className="wb-pill is-review">
                                <span className={`heat-dot heat-l${heatLevel(heat.sessionCount)}`} aria-hidden />
                                {heat.sectionCount} to review
                              </span>
                            )}
                            {a.paper.unkeyed > 0 && (
                              <span className="wb-pill is-bad">{a.paper.unkeyed} unkeyed</span>
                            )}
                            {a.pass_mark == null && <span className="wb-pill is-review">no pass mark</span>}
                            {!a.program && <span className="wb-pill is-idle">unused</span>}
                          </div>
                          {a.description && <p className="wb-card-desc">{a.description}</p>}
                          <p className="wb-card-facts">
                            {a.program
                              ? <span className="wb-prog">{a.program.title}</span>
                              : <span className="wb-stale">no programme</span>}
                            <span>
                              <b>{a.paper.questions}</b> question{a.paper.questions === 1 ? '' : 's'}
                              {a.paper.marks > 0 && <> · <b>{a.paper.marks}</b> marks</>}
                            </span>
                            <span>Updated <b>{shortDate(a.updated_at)}</b></span>
                            {a.classes.running.length > 0 && (
                              <span className="wb-running">{a.classes.running.length} running</span>
                            )}
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

        {selectedId && (
          <>
            <div
              className={`wb-rail-backdrop${panelOpen ? ' visible' : ''}`}
              onClick={closePanel}
              aria-hidden="true"
            />
            <aside
              className={`wb-rail-panel${panelOpen ? ' open' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="Assessment details"
              aria-hidden={panelOpen ? undefined : 'true'}
              onTransitionEnd={e => {
                if (e.propertyName === 'transform' && !panelOpen) setSelectedId(null);
              }}
            >
              {selected && (
                <div className="wb-rail-card">
                  <div className="wb-rail-head">
                    <h2>{selected.title}</h2>
                    <button type="button" className="icon-btn" aria-label="Close details" onClick={closePanel}>×</button>
                  </div>
                  {selected.description && <p className="wb-rail-desc">{selected.description}</p>}

                  <dl className="wb-rail-facts">
                    <div><dt>Programme</dt><dd>{selected.program
                      ? <Link to={`/trainer/programs/${selected.program.id}`}>{selected.program.title}</Link>
                      : <span className="wb-stale">none — nobody sits this</span>}</dd></div>
                    <div><dt>Questions</dt><dd>{selected.paper.questions || 'none yet'}</dd></div>
                    <div><dt>Marks</dt><dd>{selected.paper.marks || '—'}</dd></div>
                    <div><dt>Pass mark</dt><dd>{selected.pass_mark == null
                      ? <span className="wb-stale">not set</span>
                      : `${selected.pass_mark}%`}</dd></div>
                    <div><dt>Unkeyed</dt><dd>{selected.paper.unkeyed
                      ? <span className="wb-unkeyed">{selected.paper.unkeyed} cannot be marked</span>
                      : 'none'}</dd></div>
                    <div><dt>To review</dt><dd>
                      {heatTotals.get(selected.id)
                        ? `${heatTotals.get(selected.id).sectionCount} changed in class`
                        : 'nothing'}
                    </dd></div>
                    <div><dt>Updated</dt><dd>{shortDate(selected.updated_at)}</dd></div>
                  </dl>

                  {/* An edit reaches every class that has not started, so these
                      are who it would reach. */}
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
                    <Link to={`/trainer/assessments/${selected.id}`} className="primary-link">Open editor</Link>
                  </div>
                </div>
              )}
            </aside>
          </>
        )}
      </main>
    </>
  );
}

// A button that becomes a field, the same control Programmes uses — so the
// library is not permanently sharing the page with a form for something you
// do a few times a year.
function NewAssessmentControl({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) {
    return <button type="button" className="lib-new-btn" onClick={() => setOpen(true)}>+ New assessment</button>;
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr('');
    const message = await onCreate(title.trim());
    setBusy(false);
    if (message) setErr(message);
  }

  return (
    <form className="lib-new-form" onSubmit={submit}>
      <input
        ref={inputRef}
        id="new-assessment-title"
        className="form-input"
        placeholder="e.g. New joiner — Foundation assessment"
        value={title}
        maxLength={120}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTitle(''); setErr(''); } }}
      />
      <button type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create'}</button>
      <button type="button" className="ghost" onClick={() => { setOpen(false); setTitle(''); setErr(''); }}>Cancel</button>
      {err && <p className="error">{err}</p>}
    </form>
  );
}

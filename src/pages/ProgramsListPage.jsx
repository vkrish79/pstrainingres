import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { usePrograms } from '../hooks/usePrograms.js';
import { useProgramTypes } from '../hooks/useProgramTypes.js';
import CreateDialog from '../components/library/CreateDialog.jsx';
import { programColour } from '../lib/programColour.js';
import { classSummary, isReady, shortDate, shortRange } from '../lib/programReadiness.js';
import { Ring } from '../components/dashboard/SessionCockpit.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/programs.css';

// Programs, laid out like the session cockpit's Room: one bar with the
// filter and the action, a row of gauges, and tiles for the programs across
// the full width. What used to sit in a rail beside them — the selected
// program, and what needs attention — is a slide-over and a gauge now.
//
// A program is a template, not a class, so nothing here is live. The gauges
// answer "is it ready" and "how is it being used" instead.

const VIEW_KEY = 'programs-view';

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'tiles'; } catch { return 'tiles'; }
}

export default function ProgramsListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, programs, freeWorkbooks, createProgram } = usePrograms();
  // Retired types stay off the picker but stay attached to the programs that
  // already carry them.
  const { types } = useProgramTypes();

  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(readView);
  const [selectedId, setSelectedId] = useState(null);
  // MOUNT AND OPEN ARE SEPARATE, one pair of frames apart — the same idiom as
  // Workbooks and Assessments. A CSS transition needs a previous state to
  // travel from, so a panel rendered already open simply appears; and clearing
  // the selection on close would unmount it before it could travel back.
  // selectedId therefore survives the slide out and is cleared when it lands.
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  function pickView(v) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-browser nicety only */ }
  }

  // Each program with its classes summarised, newest class first — the
  // program somebody last ran a class from is the one they are most likely
  // to be looking for. Programs without classes follow, newest edit first.
  const rows = useMemo(() => programs
    .map(p => ({ ...p, classes: classSummary(p.sessions), colour: programColour(p.program_type?.id) }))
    .sort((a, b) => {
      const at = a.classes.lastCreated ? new Date(a.classes.lastCreated).getTime() : 0;
      const bt = b.classes.lastCreated ? new Date(b.classes.lastCreated).getTime() : 0;
      if (at !== bt) return bt - at;
      return new Date(b.updated_at) - new Date(a.updated_at);
    }), [programs]);

  const published = rows.filter(p => p.status === 'published');
  const drafts = rows.filter(p => p.status !== 'published');
  const shown = filter === 'pub' ? published : filter === 'draft' ? drafts : rows;
  const selected = rows.find(p => p.id === selectedId) || null;

  const allClasses = rows.flatMap(p => p.classes.list.map(s => ({ ...s, programTitle: p.title })));
  const running = allClasses.filter(s => s.state.key === 'running');
  const lastClass = [...allClasses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  const draftsNotReady = drafts.filter(p => !isReady(p));
  const publishedNotReady = published.filter(p => !isReady(p));

  function openPanel(id) {
    setSelectedId(id);
    // Two frames: the first paints the panel off-screen, the second sends it
    // in. One is enough in most browsers and not in all of them.
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelOpen(true)));
  }

  function closePanel() { setPanelOpen(false); }

  // Esc closes it, like every other slide-over here.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  // A filter that hides the chosen program must not leave its details open
  // over a list it is not in.
  useEffect(() => {
    if (panelOpen && selectedId && !shown.some(p => p.id === selectedId)) closePanel();
  }, [panelOpen, selectedId, shown]);

  return (
    <>
      <TopBar />
      <main className="page dashboard programs-page">
        {/* NO PAGE HEADING, and no count above the tiles. The nav rail says
            Programs and so does the app bar; the class count is already the
            CLASSES gauge a few pixels below. The bar carries controls only,
            the same as the library. */}
        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show programs">
              {[['all', `All · ${rows.length}`], ['pub', `Published · ${published.length}`], ['draft', `Drafts · ${drafts.length}`]].map(([k, label]) => (
                <button key={k} type="button" className={`view-tab ${filter === k ? 'active' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="page-hero-actions">
              <button type="button" className="program-new-btn" onClick={() => setCreating(true)}>+ New program</button>
            </div>
          </div>
        </section>

        {loading && <SkeletonCards count={6} label="Loading programs…" />}
        {error && <p className="error">{error}</p>}

        {!loading && !error && (
          <>
            <section className="cockpit-gauges" aria-label="Programs at a glance">
              <div className="cockpit-gauge">
                <Ring frac={rows.length ? published.length / rows.length : 0} tone="ok" label={`${published.length}/${rows.length}`} />
                <div>
                  <div className="cockpit-gauge-label">Published</div>
                  <div className="cockpit-gauge-value">{published.length}<small> / {rows.length}</small></div>
                  <div className="cockpit-gauge-hint">offered in New session</div>
                </div>
              </div>
              <div className="cockpit-gauge">
                <div>
                  <div className="cockpit-gauge-label">Running today</div>
                  <div className={`cockpit-gauge-value${running.length ? ' state-open' : ' is-muted'}`}>{running.length}</div>
                  <div className="cockpit-gauge-hint">
                    {running.length ? running.slice(0, 2).map(s => s.name).join(', ') + (running.length > 2 ? ` +${running.length - 2} more` : '') : 'no class in its dates today'}
                  </div>
                </div>
              </div>
              <div className={`cockpit-gauge${publishedNotReady.length ? ' is-bad' : draftsNotReady.length ? ' is-warn' : ''}`}>
                <div>
                  <div className="cockpit-gauge-label">Need a workbook</div>
                  <div className="cockpit-gauge-value">{publishedNotReady.length + draftsNotReady.length}</div>
                  <div className="cockpit-gauge-hint">
                    {publishedNotReady.length + draftsNotReady.length === 0 ? 'every program has one' : `${freeWorkbooks} free workbook${freeWorkbooks === 1 ? '' : 's'} to attach`}
                  </div>
                </div>
              </div>
              <div className="cockpit-gauge">
                <div>
                  <div className="cockpit-gauge-label">Classes</div>
                  <div className="cockpit-gauge-value">{allClasses.length}</div>
                  <div className="cockpit-gauge-hint">{allClasses.filter(s => s.state.key !== 'closed').length} open · {allClasses.filter(s => s.state.key === 'closed').length} closed</div>
                </div>
              </div>
              <div className="cockpit-gauge">
                <div>
                  <div className="cockpit-gauge-label">Last new class</div>
                  <div className={`cockpit-gauge-value${lastClass ? '' : ' is-muted'}`}>{lastClass ? shortDate(lastClass.created_at) : 'None'}</div>
                  <div className="cockpit-gauge-hint">{lastClass ? `from ${lastClass.programTitle}` : 'no classes yet'}</div>
                </div>
              </div>
            </section>

            {/* NO ROOM WRAPPER AND NO RAIL. "Needs you" listed the programs
                with no workbook, which the NEED A WORKBOOK gauge counts and
                every tile already says in its own words. With the rail gone
                the grid had nothing to hold but one pane and a 300px column of
                nothing, so the pane takes the page. */}
            <section className="participants-pane programs-pane">
              <div className="programs-pane-head">
                <h2>Programs <span className="programs-pane-sub">most recent class first</span></h2>
                <div className="room-view-switch" role="group" aria-label="Show programs as">
                  <button type="button" aria-pressed={view === 'tiles'} onClick={() => pickView('tiles')}>Tiles</button>
                  <button type="button" aria-pressed={view === 'table'} onClick={() => pickView('table')}>Table</button>
                </div>
              </div>

              {rows.length === 0 && <p className="cockpit-empty">No programs yet. Use + New program to make the first one.</p>}
              {rows.length > 0 && shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}

              {view === 'tiles' && shown.length > 0 && (
                <ul className="program-tiles" aria-label="Programs">
                  {shown.map(p => (
                    <li key={p.id}>
                      <ProgramTile p={p} selected={p.id === selectedId} onPick={() => openPanel(p.id)} />
                    </li>
                  ))}
                </ul>
              )}

              {view === 'table' && shown.length > 0 && (
                <div className="programs-table-wrap">
                  <table className="programs-table programs-list-table">
                    <thead>
                      <tr><th>Program</th><th>Status</th><th>Workbook</th><th>Assessment</th><th className="num">PDFs</th><th className="num">Classes</th><th>Last class</th></tr>
                    </thead>
                    <tbody>
                      {shown.map(p => (
                        <tr key={p.id} className={p.id === selectedId ? 'is-selected' : ''} onClick={() => openPanel(p.id)}>
                          <td>
                            <span className="program-swatch" style={{ background: p.colour }} aria-hidden="true" />
                            {/* The name no longer swallows the click to
                                navigate. The whole row opens the details,
                                which carry "Open program" — one gesture
                                here, the same one the tiles have. */}
                            <span className="program-name-link">{p.title}</span>
                          </td>
                          <td><StatusChip status={p.status} /></td>
                          <td>{p.workbook ? <span className="piece is-yes">Yes</span> : <span className="piece is-no-bad">None</span>}</td>
                          <td>{p.assessment ? <span className="piece is-yes">Yes</span> : <span className="piece is-no">None</span>}</td>
                          <td className="num">{p.handouts + p.quickRefs}</td>
                          <td className="num">{p.classes.total}{p.classes.running.length > 0 && <span className="programs-running"> · {p.classes.running.length} running</span>}</td>
                          <td>{p.classes.lastCreated ? shortDate(p.classes.lastCreated) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {creating && (
          <NewProgramDialog
            types={types}
            onClose={() => setCreating(false)}
            onCreate={async fields => {
              const { data, error: err } = await runBusy(
                'Creating program…',
                () => createProgram({ ...fields, created_by: authSession?.user.id }),
              );
              if (err) return err.message;
              if (data?.id) navigate(`/trainer/programs/${data.id}`);
              return null;
            }}
          />
        )}

        {/* THE DETAILS ARRIVE OVER THE PAGE, not beside it — the same slide-over
            the library uses, down to the class names, so there is one way a
            panel enters this app and not two. The rail keeps "Needs you",
            which is there whether or not anything is selected. */}
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
              aria-label="Program details"
              aria-hidden={panelOpen ? undefined : 'true'}
              onTransitionEnd={e => {
                // Only when the slide OUT has landed, and only for the slide
                // itself — visibility and opacity fire here too.
                if (e.propertyName === 'transform' && !panelOpen) setSelectedId(null);
              }}
            >
              {selected && (
                <div className="wb-rail-card">
                  <div className="wb-rail-head">
                    <h2>{selected.title}</h2>
                    <button type="button" className="icon-btn" aria-label="Close details" onClick={closePanel}>×</button>
                  </div>
                  <p className="wb-rail-desc">
                    <StatusChip status={selected.status} />{' '}
                    {selected.program_type?.name || 'No type'} · created {shortDate(selected.created_at)}
                  </p>

                  {/* A WORKBOOK IS THE ONLY REQUIRED PIECE — a missing one is
                      why no class can be made, so it is drawn as a problem and
                      a missing assessment never is. */}
                  <dl className="wb-rail-facts">
                    <div><dt>Workbook</dt><dd>{selected.workbook
                      ? <Link to={`/trainer/workbooks/${selected.workbook.id}`}>{selected.workbook.title}</Link>
                      : <span className="wb-unkeyed">none — no class can be made from it</span>}</dd></div>
                    <div><dt>Assessment</dt><dd>{selected.assessment
                      ? <Link to={`/trainer/assessments/${selected.assessment.id}`}>{selected.assessment.title}</Link>
                      : 'none'}</dd></div>
                    <div><dt>PDFs</dt><dd>{selected.handouts + selected.quickRefs || 'none'}</dd></div>
                    <div><dt>Classes</dt><dd>
                      {selected.classes.total === 0 ? 'none yet' : (
                        <>
                          {selected.classes.total} · {selected.classes.open.length} open
                          {selected.classes.running.length > 0 && `, ${selected.classes.running.length} running`}
                        </>
                      )}
                    </dd></div>
                    <div><dt>Updated</dt><dd>{shortDate(selected.updated_at)}</dd></div>
                  </dl>

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
                    <Link to={`/trainer/programs/${selected.id}`} className="primary-link">Open program</Link>
                    {selected.status === 'published' && isReady(selected) && (
                      <Link to={`/trainer?new=1&program=${selected.id}`} className="ghost-link">New session</Link>
                    )}
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

export function StatusChip({ status }) {
  const pub = status === 'published';
  return <span className={`program-status ${pub ? 'is-published' : 'is-draft'}`}>{pub ? 'Published' : 'Draft'}</span>;
}

// ONE CLICK, ONE GESTURE. This used to select on a click and open on a
// double-click; the details now arrive as a slide-over, whose backdrop would
// swallow the second click before dblclick ever fired. So a click opens the
// details and the panel carries "Open program", exactly as in the library.
function ProgramTile({ p, selected, onPick }) {
  const pdfs = p.handouts + p.quickRefs;
  return (
    <button
      type="button"
      className={`program-tile${p.status !== 'published' ? ' is-draft' : ''}`}
      style={{ '--edge': p.colour }}
      aria-pressed={selected}
      onClick={onPick}
    >
      <span className="program-tile-name">{p.title}</span>
      <span className="program-tile-meta">
        <StatusChip status={p.status} />
        <span>{p.program_type?.name || 'No type'}</span>
      </span>
      <span className="program-tile-pieces">
        {p.workbook ? <span className="piece is-yes">Workbook</span> : <span className="piece is-no-bad">No workbook</span>}
        {p.assessment ? <span className="piece is-yes">Assessment</span> : <span className="piece is-no">No assessment</span>}
        {pdfs ? <span className="piece is-yes">{pdfs} PDF{pdfs === 1 ? '' : 's'}</span> : <span className="piece is-no">No PDFs</span>}
      </span>
      <span className="program-tile-foot">
        <span>
          {p.classes.running.length > 0 && <strong>{p.classes.running.length} running · </strong>}
          {p.classes.total} class{p.classes.total === 1 ? '' : 'es'}
        </span>
        <span>{p.classes.lastCreated ? `last ${shortDate(p.classes.lastCreated)}` : `edited ${shortDate(p.updated_at)}`}</span>
      </span>
    </button>
  );
}

// THE TYPE IS ASKED FOR HERE, and that is the point of the change. createProgram
// has always accepted a program_type_id; the old inline field never sent one, so
// every program was born "No type" and somebody set it afterwards in the editor
// — if they remembered. It is a required choice now, with "No type" as an
// explicit option rather than the default nobody picked.
function NewProgramDialog({ types, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [typeId, setTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr('');
    const message = await onCreate({
      title: title.trim(),
      program_type_id: typeId || null,
      description: description.trim() || null,
    });
    setBusy(false);
    if (message) setErr(message);
  }

  return (
    <CreateDialog
      heading="New program"
      blurb="A template you schedule classes from."
      submitLabel="Create program"
      busy={busy}
      error={err}
      canSubmit={!!title.trim()}
      onClose={onClose}
      onSubmit={submit}
    >
      <div>
        <label className="form-label" htmlFor="new-program-title">Title</label>
        <input
          id="new-program-title"
          className="form-input"
          placeholder="e.g. New joiner – Foundation"
          value={title}
          maxLength={120}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div>
        <label className="form-label" htmlFor="new-program-type">Type</label>
        <select
          id="new-program-type"
          className="form-input"
          value={typeId}
          onChange={e => setTypeId(e.target.value)}
        >
          <option value="">No type</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <p className="create-dialog-help">Sets the colour it carries on every tile and calendar.</p>
      </div>

      <div>
        <label className="form-label" htmlFor="new-program-desc">Description <span className="muted">— optional</span></label>
        <input
          id="new-program-desc"
          className="form-input"
          placeholder="What this program is for"
          value={description}
          maxLength={300}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
    </CreateDialog>
  );
}

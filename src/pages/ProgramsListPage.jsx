import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { usePrograms } from '../hooks/usePrograms.js';
import { programColour } from '../lib/programColour.js';
import { classSummary, isReady, shortDate } from '../lib/programReadiness.js';
import { Ring } from '../components/dashboard/SessionCockpit.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/programs.css';

// Programmes, laid out like the session cockpit's Room: a title, one bar with
// the filter and the action, a row of gauges, tiles for the programmes and a
// rail with the selected one and what needs attention.
//
// A programme is a template, not a class, so nothing here is live. The gauges
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

  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(readView);
  const [selectedId, setSelectedId] = useState(null);

  function pickView(v) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-browser nicety only */ }
  }

  // Each programme with its classes summarised, newest class first — the
  // programme somebody last ran a class from is the one they are most likely
  // to be looking for. Programmes without classes follow, newest edit first.
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

  return (
    <>
      <TopBar />
      <main className="page dashboard programs-page">
        <header className="cockpit-page-title">
          <h1>Programmes</h1>
        </header>

        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show programmes">
              {[['all', `All · ${rows.length}`], ['pub', `Published · ${published.length}`], ['draft', `Drafts · ${drafts.length}`]].map(([k, label]) => (
                <button key={k} type="button" className={`view-tab ${filter === k ? 'active' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="page-hero-text">
              <p className="cockpit-hero-sub">
                {!loading && <span>{allClasses.length} class{allClasses.length === 1 ? '' : 'es'} made from these</span>}
              </p>
            </div>
            <div className="page-hero-actions">
              <NewProgramControl
                onCreate={async title => {
                  const { data, error: err } = await runBusy('Creating programme…', () => createProgram({ title, created_by: authSession?.user.id }));
                  if (err) return err.message;
                  if (data?.id) navigate(`/trainer/programs/${data.id}`);
                  return null;
                }}
              />
            </div>
          </div>
        </section>

        {loading && <SkeletonCards count={6} label="Loading programmes…" />}
        {error && <p className="error">{error}</p>}

        {!loading && !error && (
          <>
            <section className="cockpit-gauges" aria-label="Programmes at a glance">
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
                    {publishedNotReady.length + draftsNotReady.length === 0 ? 'every programme has one' : `${freeWorkbooks} free workbook${freeWorkbooks === 1 ? '' : 's'} to attach`}
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

            <div className="cockpit-room">
              <section className="participants-pane programs-pane">
                <div className="programs-pane-head">
                  <h2>Programmes <span className="programs-pane-sub">most recent class first</span></h2>
                  <div className="room-view-switch" role="group" aria-label="Show programmes as">
                    <button type="button" aria-pressed={view === 'tiles'} onClick={() => pickView('tiles')}>Tiles</button>
                    <button type="button" aria-pressed={view === 'table'} onClick={() => pickView('table')}>Table</button>
                  </div>
                </div>

                {rows.length === 0 && <p className="cockpit-empty">No programmes yet. Use + New programme to make the first one.</p>}
                {rows.length > 0 && shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}

                {view === 'tiles' && shown.length > 0 && (
                  <ul className="program-tiles" aria-label="Programmes">
                    {shown.map(p => (
                      <li key={p.id}>
                        <ProgramTile p={p} selected={p.id === selectedId} onPick={() => setSelectedId(p.id)} onOpen={() => navigate(`/trainer/programs/${p.id}`)} />
                      </li>
                    ))}
                  </ul>
                )}

                {view === 'table' && shown.length > 0 && (
                  <div className="programs-table-wrap">
                    <table className="programs-table programs-list-table">
                      <thead>
                        <tr><th>Programme</th><th>Status</th><th>Workbook</th><th>Assessment</th><th className="num">PDFs</th><th className="num">Classes</th><th>Last class</th></tr>
                      </thead>
                      <tbody>
                        {shown.map(p => (
                          <tr key={p.id} className={p.id === selectedId ? 'is-selected' : ''} onClick={() => setSelectedId(p.id)}>
                            <td>
                              <span className="program-swatch" style={{ background: p.colour }} aria-hidden="true" />
                              <Link to={`/trainer/programs/${p.id}`} className="program-name-link" onClick={e => e.stopPropagation()}>{p.title}</Link>
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

              <aside className="cockpit-rail" aria-label="Programme details">
                {selected && (
                  <section className="cockpit-card">
                    <h3 className="cockpit-card-title">Selected</h3>
                    <div className="program-selected-name">{selected.title}</div>
                    <div className="program-selected-meta">
                      <StatusChip status={selected.status} />
                      <span>{selected.program_type?.name || 'No type'} · created {shortDate(selected.created_at)}</span>
                    </div>
                    <div className="program-selected-actions">
                      <Link to={`/trainer/programs/${selected.id}`} className="primary-link">Open programme</Link>
                      {selected.status === 'published' && isReady(selected) && (
                        <Link to={`/trainer?new=1&program=${selected.id}`} className="ghost-link">New class from it</Link>
                      )}
                    </div>
                  </section>
                )}
                <section className="cockpit-card">
                  <h3 className="cockpit-card-title">Needs you</h3>
                  {publishedNotReady.length + draftsNotReady.length === 0 ? (
                    <p className="cockpit-empty">Every programme has a workbook.</p>
                  ) : (
                    <ul className="cockpit-alerts">
                      {publishedNotReady.map(p => (
                        <li key={p.id}>
                          <button type="button" className="cockpit-alert" onClick={() => navigate(`/trainer/programs/${p.id}`)}>
                            <span className="cockpit-dot tone-bad" aria-hidden="true" />
                            <span className="cockpit-alert-name">{p.title}</span>
                            <span className="cockpit-alert-why">Published with no workbook, so no class can be made from it</span>
                          </button>
                        </li>
                      ))}
                      {draftsNotReady.map(p => (
                        <li key={p.id}>
                          <button type="button" className="cockpit-alert" onClick={() => navigate(`/trainer/programs/${p.id}`)}>
                            <span className="cockpit-dot tone-warn" aria-hidden="true" />
                            <span className="cockpit-alert-name">{p.title}</span>
                            <span className="cockpit-alert-why">
                              Draft with no workbook{freeWorkbooks === 0 ? ' · no free workbook to attach' : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
            </div>
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

function ProgramTile({ p, selected, onPick, onOpen }) {
  const pdfs = p.handouts + p.quickRefs;
  return (
    <button
      type="button"
      className={`program-tile${p.status !== 'published' ? ' is-draft' : ''}`}
      style={{ '--edge': p.colour }}
      aria-pressed={selected}
      onClick={onPick}
      onDoubleClick={onOpen}
      title="Click to select, double-click to open"
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

// "+ New programme" asks for a title in place, then opens the new programme.
function NewProgramControl({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) {
    return <button type="button" className="program-new-btn" onClick={() => setOpen(true)}>+ New programme</button>;
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
    <form className="program-new-form" onSubmit={submit}>
      <input
        ref={inputRef}
        id="new-program-title"
        className="form-input"
        placeholder="Programme title, e.g. New joiner – Foundation"
        value={title}
        maxLength={120}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTitle(''); setErr(''); } }}
        aria-label="New programme title"
      />
      <button type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create'}</button>
      <button type="button" className="ghost" onClick={() => { setOpen(false); setTitle(''); setErr(''); }}>Cancel</button>
      {err && <span className="error program-new-err">{err}</span>}
    </form>
  );
}

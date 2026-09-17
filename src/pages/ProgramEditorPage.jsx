import { useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useProgram } from '../hooks/useProgram.js';
import { useProgramTypes } from '../hooks/useProgramTypes.js';
import { programColour } from '../lib/programColour.js';
import { classSummary, shortDate, shortRange, titleFromFile } from '../lib/programReadiness.js';
import { Ring } from '../components/dashboard/SessionCockpit.jsx';
import KebabMenu from '../components/KebabMenu.jsx';
import TopBar from '../components/TopBar.jsx';
import { StatusChip } from './ProgramsListPage.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/programs.css';

// One programme, in the session cockpit's clothes: the title above one bar
// (facts, tabs, actions), gauges that say whether it is ready and how it is
// used, and a rail with what needs doing and the programme's details.
//
// It replaces five stacked full-width cards. Nothing asks through a browser
// pop-up any more: every destructive step confirms inline, in place.
export default function ProgramEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { run: runBusy } = useBusyOverlay();
  const prog = useProgram(id);
  const { loading, error, program, workbook, assessment, materials, sessions } = prog;
  const { types: programTypes } = useProgramTypes(); // active only
  const [tab, setTab] = useState('overview');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionErr, setActionErr] = useState('');

  const classes = useMemo(() => classSummary(sessions), [sessions]);

  if (loading) return <><TopBar /><SkeletonPage body="lines" rows={5} label="Loading programme…" /></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;
  if (!program) return <><TopBar /><main className="page"><p className="muted">Programme not found.</p></main></>;

  const published = program.status === 'published';
  // Sorted here, not trusted from load order: a move or a kind switch updates
  // rows in place, and the list must follow without a reload.
  const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
  const handouts = materials.filter(m => m.kind === 'handout').sort(bySort);
  const quickRefs = materials.filter(m => m.kind === 'quick_ref').sort(bySort);

  async function publish(next) {
    setActionErr('');
    const { error: e } = await runBusy(next === 'published' ? 'Publishing…' : 'Reverting to draft…', () => prog.setStatus(next));
    if (e) setActionErr(e.message);
  }

  async function handleDelete() {
    setActionErr('');
    const { error: e } = await runBusy('Deleting programme…', () => prog.deleteProgram());
    if (e) { setActionErr(e.message); setConfirmDelete(false); return; }
    navigate('/trainer/programs');
  }

  const needs = [
    !workbook && {
      tone: published ? 'bad' : 'warn',
      name: 'Attach a workbook',
      why: published ? 'Published, but no class can be made without one' : 'It cannot be published until it has one',
      go: () => setTab('overview'),
    },
    !published && workbook && {
      tone: 'ok',
      name: 'Ready to publish',
      why: 'Publishing offers it in New session',
      go: null,
    },
    materials.some(m => /\.pdf$/i.test(m.title)) && {
      tone: 'off',
      name: `Tidy ${materials.filter(m => /\.pdf$/i.test(m.title)).length} PDF title${materials.filter(m => /\.pdf$/i.test(m.title)).length === 1 ? '' : 's'}`,
      why: 'Titles still end in .pdf',
      go: () => setTab('materials'),
    },
  ].filter(Boolean);

  return (
    <>
      <TopBar />
      <main className="page dashboard programs-page">
        <header className="cockpit-page-title">
          <h1>{program.title}</h1>
          <span className="program-type-tag">
            <span className="program-swatch" style={{ background: programColour(program.program_type?.id) }} aria-hidden="true" />
            {program.program_type?.name || 'No type'}
          </span>
          <StatusChip status={program.status} />
        </header>

        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="page-hero-text">
              <p className="cockpit-hero-sub">
                <Link to="/trainer/programs" className="back-link">&larr; Programmes</Link>
                <span>Created {shortDate(program.created_at)}</span>
                <span>{classes.total} class{classes.total === 1 ? '' : 'es'}{classes.running.length ? ` · ${classes.running.length} running` : ''}</span>
              </p>
            </div>
            <div className="view-tabs" role="tablist" aria-label="Programme sections">
              {[['overview', 'Overview'], ['materials', `Materials · ${materials.length}`], ['classes', `Classes · ${classes.total}`]].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`view-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            <div className="page-hero-actions">
              {!published && (
                <button
                  type="button"
                  className="program-publish-btn"
                  disabled={!workbook}
                  data-tip={workbook ? 'Offer this programme in New session' : 'Attach a workbook first'}
                  onClick={() => publish('published')}
                >
                  Publish
                </button>
              )}
              {published && workbook && (
                <Link to={`/trainer?new=1&program=${program.id}`} className="ghost-link">New class from this</Link>
              )}
              <KebabMenu
                label="Programme actions"
                items={[
                  published && {
                    label: 'Revert to draft',
                    glyph: '↺',
                    onClick: () => publish('draft'),
                  },
                  published && { separator: true },
                  {
                    label: 'Delete programme…',
                    glyph: '✕',
                    danger: true,
                    onClick: () => setConfirmDelete(true),
                  },
                ]}
              />
            </div>
          </div>
        </section>

        {/* sessions.program_id has no ON DELETE rule, so the database refuses
            to delete a programme any class was made from. Say that up front
            rather than offer a Delete that fails. */}
        {confirmDelete && classes.total > 0 && (
          <div className="program-confirm" role="alert">
            <span>
              <strong>{program.title} can't be deleted.</strong>{' '}
              {classes.total} class{classes.total === 1 ? ' was' : 'es were'} made from it.
              {published ? ' Revert it to draft to stop it being offered in New session.' : ''}
            </span>
            {published && <button type="button" className="ghost" onClick={() => { setConfirmDelete(false); publish('draft'); }}>Revert to draft</button>}
            <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>OK</button>
          </div>
        )}
        {confirmDelete && classes.total === 0 && (
          <div className="program-confirm" role="alert">
            <span>
              <strong>Delete {program.title}?</strong>{' '}
              {workbook || assessment ? 'Its workbook and assessment are detached, not deleted. ' : ''}
              No classes were made from it.
            </span>
            <button type="button" className="danger" onClick={handleDelete}>Delete</button>
            <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </div>
        )}
        {actionErr && <p className="error">{actionErr}</p>}

        <ProgramGauges prog={prog} classes={classes} published={published} handouts={handouts} quickRefs={quickRefs} onTab={setTab} />

        <div className="cockpit-room">
          <section className="participants-pane programs-pane">
            {tab === 'overview' && (
              <>
                <div className="programs-pane-head">
                  <h2>What a class gets <span className="programs-pane-sub">copied when the class is created</span></h2>
                </div>
                <div className="program-slots">
                  <AttachSlot
                    kind="workbook"
                    code="WB"
                    item={workbook}
                    detail={workbook && `${prog.sectionCount != null ? `${prog.sectionCount} sections · ` : ''}edited ${shortDate(workbook.updated_at)} · new classes get this version`}
                    emptyTitle="No workbook"
                    emptyWhy={published ? 'No class can be made from this programme until it has one' : 'Needed before this programme can be published'}
                    required
                    openHref={workbook && `/trainer/workbooks/${workbook.id}`}
                    free={prog.freeWorkbooks}
                    noneFree={<>Every workbook is attached to a programme. <Link to="/trainer/workbooks/new">Create a workbook</Link>.</>}
                    onAttach={wid => runBusy('Attaching workbook…', () => prog.attachWorkbook(wid))}
                    onDetach={() => runBusy('Detaching workbook…', () => prog.detachWorkbook())}
                    detachWarning={classes.open.length ? `The ${classes.open.length} open class${classes.open.length === 1 ? ' keeps its' : 'es keep their'} copy.` : ''}
                  />
                  <AttachSlot
                    kind="assessment"
                    code="AS"
                    item={assessment}
                    detail={assessment && `edited ${shortDate(assessment.updated_at)} · new classes get this version`}
                    emptyTitle="No assessment"
                    emptyWhy="Optional. Classes made from this programme won't have one."
                    openHref={assessment && `/trainer/assessments/${assessment.id}`}
                    free={prog.freeAssessments}
                    noneFree={<>Every assessment is attached to a programme. <Link to="/trainer/assessments">Create an assessment</Link>.</>}
                    onAttach={aid => runBusy('Attaching assessment…', () => prog.attachAssessment(aid))}
                    onDetach={() => runBusy('Detaching assessment…', () => prog.detachAssessment())}
                    detachWarning={classes.open.length ? `Open classes that already have it keep their copy.` : ''}
                  />
                </div>

                <div className="programs-pane-head programs-pane-head--spaced">
                  <h2>Classes <span className="programs-pane-sub">most recent first</span></h2>
                  {classes.total > 3 && (
                    <button type="button" className="ghost-link program-link-btn" onClick={() => setTab('classes')}>All {classes.total} →</button>
                  )}
                </div>
                <ClassesTable list={classes.list.slice(0, 3)} />
              </>
            )}

            {tab === 'materials' && (
              <MaterialsPane prog={prog} handouts={handouts} quickRefs={quickRefs} openClasses={classes.open.length} runBusy={runBusy} />
            )}

            {tab === 'classes' && <ClassesPane classes={classes} />}
          </section>

          <aside className="cockpit-rail" aria-label="Programme details">
            <section className="cockpit-card">
              <h3 className="cockpit-card-title">Needs you</h3>
              {needs.length === 0 ? (
                <p className="cockpit-empty">Nothing. It has what a class needs.</p>
              ) : (
                <ul className="cockpit-alerts">
                  {needs.map(n => (
                    <li key={n.name}>
                      {n.go ? (
                        <button type="button" className="cockpit-alert" onClick={n.go}>
                          <span className={`cockpit-dot tone-${n.tone}`} aria-hidden="true" />
                          <span className="cockpit-alert-name">{n.name}</span>
                          <span className="cockpit-alert-why">{n.why}</span>
                        </button>
                      ) : (
                        <div className="cockpit-alert program-alert-static">
                          <span className={`cockpit-dot tone-${n.tone}`} aria-hidden="true" />
                          <span className="cockpit-alert-name">{n.name}</span>
                          <span className="cockpit-alert-why">{n.why}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <DetailsCard program={program} programTypes={programTypes} updateFields={prog.updateFields} />
          </aside>
        </div>
      </main>
    </>
  );
}

// ----- gauges ----------------------------------------------------------------

function ProgramGauges({ prog, classes, published, handouts, quickRefs, onTab }) {
  const { workbook, assessment, materials, sectionCount } = prog;
  const run = classes.running[0];
  const people = classes.running.reduce((n, s) => n + (s.people || 0), 0);
  return (
    <section className="cockpit-gauges" aria-label="Programme at a glance">
      <button type="button" className={`cockpit-gauge cockpit-gauge-button${workbook ? '' : published ? ' is-bad' : ' is-warn'}`} onClick={() => onTab('overview')}>
        <Ring frac={workbook ? 1 : 0} tone="ok" label={workbook ? '✓' : '!'} />
        <div>
          <div className="cockpit-gauge-label">Workbook</div>
          <div className={`cockpit-gauge-value${workbook ? ' state-open' : ' state-expired'}`}>{workbook ? 'Ready' : 'Missing'}</div>
          <div className="cockpit-gauge-hint">
            {workbook ? `${sectionCount != null ? `${sectionCount} sections · ` : ''}edited ${shortDate(workbook.updated_at)}` : 'needed to make a class'}
          </div>
        </div>
      </button>
      {/* Optional by decision: an empty assessment is grey, never red. */}
      <button type="button" className="cockpit-gauge cockpit-gauge-button" onClick={() => onTab('overview')}>
        <div>
          <div className="cockpit-gauge-label">Assessment</div>
          <div className={`cockpit-gauge-value${assessment ? ' state-open' : ' is-muted'}`}>{assessment ? 'Attached' : 'None'}</div>
          <div className="cockpit-gauge-hint">{assessment ? assessment.title : 'optional'}</div>
        </div>
      </button>
      <button type="button" className="cockpit-gauge cockpit-gauge-button" onClick={() => onTab('materials')}>
        <div>
          <div className="cockpit-gauge-label">Materials</div>
          <div className={`cockpit-gauge-value${materials.length ? '' : ' is-muted'}`}>{materials.length}<small> PDF{materials.length === 1 ? '' : 's'}</small></div>
          <div className="cockpit-gauge-hint">{handouts.length} handout{handouts.length === 1 ? '' : 's'} · {quickRefs.length} quick ref</div>
        </div>
      </button>
      <button type="button" className="cockpit-gauge cockpit-gauge-button" onClick={() => onTab('classes')}>
        <div>
          <div className="cockpit-gauge-label">Running now</div>
          <div className={`cockpit-gauge-value${classes.running.length ? ' state-open' : ' is-muted'}`}>{classes.running.length}</div>
          <div className="cockpit-gauge-hint">
            {run ? `${classes.running.length === 1 ? run.name : `${people} people`} · ${run.state.label.replace('Running · ', '')}` : 'no class in its dates today'}
          </div>
        </div>
      </button>
      <button type="button" className="cockpit-gauge cockpit-gauge-button" onClick={() => onTab('classes')}>
        <div>
          <div className="cockpit-gauge-label">Classes</div>
          <div className={`cockpit-gauge-value${classes.total ? '' : ' is-muted'}`}>{classes.total}</div>
          <div className="cockpit-gauge-hint">{classes.lastCreated ? `last made ${shortDate(classes.lastCreated)}` : 'none made yet'}</div>
        </div>
      </button>
    </section>
  );
}

// ----- workbook / assessment slot ---------------------------------------------

function AttachSlot({ kind, code, item, detail, emptyTitle, emptyWhy, required, openHref, free, noneFree, onAttach, onDetach, detachWarning }) {
  // The picker starts EMPTY. It used to arrive with the first option already
  // chosen beside an Attach button, which read as "already attached" and let
  // one click attach whatever happened to be first.
  const [picked, setPicked] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { setPicked(''); setConfirming(false); }, [item?.id]);

  async function attach() {
    if (!picked) return;
    setMsg('');
    const { error: e } = await onAttach(picked);
    if (e) setMsg(e.message);
  }
  async function detach() {
    setMsg('');
    const { error: e } = await onDetach();
    setConfirming(false);
    if (e) setMsg(e.message);
  }

  if (item) {
    return (
      <div className="program-slot">
        <span className="program-slot-icon" aria-hidden="true">{code}</span>
        <div className="program-slot-text">
          <div className="program-slot-title">{item.title}</div>
          <div className="program-slot-sub">{detail}</div>
          {confirming && (
            <div className="program-inline-confirm">
              <span>Detach this {kind}? It is not deleted. {detachWarning}</span>
              <button type="button" className="danger compact" onClick={detach}>Detach</button>
              <button type="button" className="ghost compact" onClick={() => setConfirming(false)}>Keep</button>
            </div>
          )}
          {msg && <p className="error program-slot-err">{msg}</p>}
        </div>
        <div className="program-slot-actions">
          <Link to={openHref} className="ghost-link program-small-link">Open</Link>
          <KebabMenu
            label={`${kind} actions`}
            items={[{ label: `Detach ${kind}…`, glyph: '⤫', danger: true, onClick: () => setConfirming(true) }]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`program-slot is-empty${required ? ' is-required' : ''}`}>
      <span className="program-slot-icon" aria-hidden="true">?</span>
      <div className="program-slot-text">
        <div className="program-slot-title">{emptyTitle}</div>
        <div className="program-slot-sub">{emptyWhy}</div>
        {free.length === 0 ? (
          <p className="program-slot-none">{noneFree}</p>
        ) : (
          <div className="program-slot-picker">
            <select
              id={`attach-${kind}`}
              className="form-input"
              value={picked}
              onChange={e => setPicked(e.target.value)}
              aria-label={`Choose a ${kind} to attach`}
            >
              <option value="">Choose a {kind}…</option>
              {free.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
            <button type="button" className="compact" disabled={!picked} onClick={attach}>Attach</button>
          </div>
        )}
        {msg && <p className="error program-slot-err">{msg}</p>}
      </div>
    </div>
  );
}

// ----- classes ------------------------------------------------------------------

function ClassesTable({ list, withAssessment = false }) {
  if (list.length === 0) return <p className="cockpit-empty">No classes have been made from this programme yet.</p>;
  return (
    <div className="programs-table-wrap">
      <table className="programs-table">
        <thead>
          <tr>
            <th>Class</th><th>Dates</th><th>State</th><th className="num">People</th>
            {withAssessment && <th>Assessment</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map(s => (
            <tr key={s.id}>
              <td className="program-class-name">{s.name}</td>
              <td>{shortRange(s.starts_at, s.ends_at)}</td>
              <td><span className={`program-class-state is-${s.state.key}`}>{s.state.label}</span></td>
              {/* Retention slims closed classes, so their roster reads 0. */}
              <td className="num">{s.state.key === 'closed' && !s.people ? '–' : s.people}</td>
              {withAssessment && <td>{s.assessment_id ? 'Yes' : <span className="program-muted">None</span>}</td>}
              <td className="program-row-action">
                <Link to={`/trainer/sessions/${s.id}`} className="ghost-link program-small-link">
                  {s.state.key === 'closed' ? 'Report' : 'Cockpit'}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassesPane({ classes }) {
  const [f, setF] = useState('all');
  const list = f === 'open' ? classes.open : f === 'closed' ? classes.closed : classes.list;
  const openPeople = classes.open.reduce((n, s) => n + (s.people || 0), 0);
  return (
    <>
      <div className="programs-pane-head">
        <h2>Classes from this programme <span className="programs-pane-sub">{classes.total} · {openPeople} people in open classes</span></h2>
        <div className="room-view-switch" role="group" aria-label="Show classes">
          <button type="button" aria-pressed={f === 'all'} onClick={() => setF('all')}>All</button>
          <button type="button" aria-pressed={f === 'open'} onClick={() => setF('open')}>Open · {classes.open.length}</button>
          <button type="button" aria-pressed={f === 'closed'} onClick={() => setF('closed')}>Closed · {classes.closed.length}</button>
        </div>
      </div>
      <ClassesTable list={list} withAssessment />
    </>
  );
}

// ----- materials -------------------------------------------------------------------

function MaterialsPane({ prog, handouts, quickRefs, openClasses, runBusy }) {
  const [kind, setKind] = useState('handout');
  const [msg, setMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  async function upload(files) {
    const pdfs = [...(files || [])].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) { setMsg('Only PDF files can be added.'); return; }
    setMsg('');
    const label = pdfs.length === 1 ? 'Uploading…' : `Uploading ${pdfs.length} PDFs…`;
    const failed = [];
    await runBusy(label, async () => {
      for (const file of pdfs) {
        const { error: e } = await prog.uploadMaterial({ file, kind, title: titleFromFile(file.name) });
        if (e) failed.push(`${file.name}: ${e.message}`);
      }
    });
    if (failed.length) setMsg(`Not added — ${failed.join('; ')}`);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <div className="programs-pane-head">
        <h2>Materials <span className="programs-pane-sub">classes read these live, not a copy</span></h2>
      </div>

      <MaterialGroup title="Handouts" rows={handouts} prog={prog} openClasses={openClasses} runBusy={runBusy} />
      <MaterialGroup title="Quick reference" rows={quickRefs} prog={prog} openClasses={openClasses} runBusy={runBusy} />

      <div
        className={`program-drop${dragOver ? ' is-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
      >
        <div className="room-view-switch" role="group" aria-label="Add as">
          <button type="button" aria-pressed={kind === 'handout'} onClick={() => setKind('handout')}>Add as handouts</button>
          <button type="button" aria-pressed={kind === 'quick_ref'} onClick={() => setKind('quick_ref')}>Add as quick reference</button>
        </div>
        <p>
          Drop PDFs here, or{' '}
          <label className="program-choose">
            choose files
            <input ref={fileRef} id="program-material-files" type="file" accept="application/pdf" multiple onChange={e => upload(e.target.files)} />
          </label>
          . Titles come from the file names.
        </p>
      </div>
      {msg && <p className="error">{msg}</p>}
    </>
  );
}

function MaterialGroup({ title, rows, prog, openClasses, runBusy }) {
  return (
    <div className="program-mat-group">
      <h3 className="cockpit-card-title">{title} · {rows.length}</h3>
      {rows.length === 0 ? (
        <p className="cockpit-empty">None yet.</p>
      ) : (
        <ul className="program-mats">
          {rows.map((m, i) => (
            <MaterialRow key={m.id} m={m} first={i === 0} last={i === rows.length - 1} prog={prog} openClasses={openClasses} runBusy={runBusy} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MaterialRow({ m, first, last, prog, openClasses, runBusy }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(m.title);
  const [removing, setRemoving] = useState(false);
  const [msg, setMsg] = useState('');
  const hasExt = /\.pdf$/i.test(m.title);

  async function open() {
    setMsg('');
    const { data, error: e } = await prog.signedUrlFor(m);
    if (e) { setMsg(e.message); return; }
    window.open(data, '_blank', 'noopener,noreferrer');
  }
  async function save(patch, busyLabel) {
    setMsg('');
    const { error: e } = await runBusy(busyLabel, () => prog.updateMaterial(m, patch));
    if (e) setMsg(e.message);
    return !e;
  }
  async function saveName(e) {
    e?.preventDefault();
    const t = name.trim();
    if (!t || t === m.title) { setRenaming(false); setName(m.title); return; }
    if (await save({ title: t }, 'Renaming…')) setRenaming(false);
  }
  async function move(dir) {
    setMsg('');
    const { error: e } = await runBusy('Moving…', () => prog.moveMaterial(m, dir));
    if (e) setMsg(e.message);
  }
  async function remove() {
    setMsg('');
    const { error: e } = await runBusy('Removing…', () => prog.removeMaterial(m));
    if (e) { setMsg(e.message); setRemoving(false); }
  }

  return (
    <li className="program-mat">
      <span className="program-pdf" aria-hidden="true">PDF</span>
      <div className="program-mat-text">
        {renaming ? (
          <form onSubmit={saveName} className="program-rename">
            <input
              id={`rename-${m.id}`}
              className="form-input"
              value={name}
              autoFocus
              maxLength={120}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setRenaming(false); setName(m.title); } }}
              aria-label="PDF title"
            />
            <button type="submit" className="compact">Save</button>
            <button type="button" className="ghost compact" onClick={() => { setRenaming(false); setName(m.title); }}>Cancel</button>
          </form>
        ) : (
          <>
            <span className="program-mat-title">{m.title}</span>
            <span className="program-mat-sub">
              added {shortDate(m.created_at)}
              {hasExt && (
                <> · <button type="button" className="program-tidy" onClick={() => save({ title: titleFromFile(m.title) }, 'Tidying title…')}>remove “.pdf” from the title</button></>
              )}
            </span>
          </>
        )}
        {removing && (
          <div className="program-inline-confirm">
            <span>
              Remove this PDF?{' '}
              {openClasses > 0 ? `It disappears from the ${openClasses} open class${openClasses === 1 ? '' : 'es'} as well.` : 'No open class uses it.'}
            </span>
            <button type="button" className="danger compact" onClick={remove}>Remove</button>
            <button type="button" className="ghost compact" onClick={() => setRemoving(false)}>Keep</button>
          </div>
        )}
        {msg && <p className="error program-slot-err">{msg}</p>}
      </div>
      <div className="program-slot-actions">
        <button type="button" className="ghost compact" onClick={open}>Open</button>
        <KebabMenu
          label={`Actions for ${m.title}`}
          items={[
            { label: 'Rename', glyph: '✎', onClick: () => { setName(m.title); setRenaming(true); } },
            !first && { label: 'Move up', glyph: '↑', onClick: () => move(-1) },
            !last && { label: 'Move down', glyph: '↓', onClick: () => move(1) },
            {
              label: m.kind === 'handout' ? 'Make it a quick reference' : 'Make it a handout',
              glyph: '⇄',
              onClick: () => save({ kind: m.kind === 'handout' ? 'quick_ref' : 'handout' }, 'Moving…'),
            },
            { separator: true },
            { label: 'Remove…', glyph: '✕', danger: true, onClick: () => setRemoving(true) },
          ]}
        />
      </div>
    </li>
  );
}

// ----- details ---------------------------------------------------------------------

// Saves when you leave a field (or pick a type), and reads the row back.
function DetailsCard({ program, programTypes, updateFields }) {
  const [title, setTitle] = useState(program.title);
  const [description, setDescription] = useState(program.description || '');
  const [state, setState] = useState({ kind: 'idle', text: '' });

  useEffect(() => {
    setTitle(program.title);
    setDescription(program.description || '');
  }, [program.id, program.title, program.description]);

  async function save(patch) {
    setState({ kind: 'saving', text: 'Saving…' });
    const { error: e } = await updateFields(patch);
    setState(e ? { kind: 'error', text: e.message } : { kind: 'saved', text: '✓ Saved' });
  }

  function saveTitle() {
    const t = title.trim();
    if (!t) { setTitle(program.title); setState({ kind: 'error', text: 'A programme needs a title.' }); return; }
    if (t !== program.title) save({ title: t });
  }
  function saveDescription() {
    const d = description.trim() || null;
    if (d !== (program.description || null)) save({ description: d });
  }

  return (
    <section className="cockpit-card program-details">
      <div className="program-details-head">
        <h3 className="cockpit-card-title">Details</h3>
        {state.text && <span className={`program-save-state is-${state.kind}`}>{state.text}</span>}
      </div>
      <label className="program-field" htmlFor="program-title">Title</label>
      <input id="program-title" className="form-input" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} />
      <label className="program-field" htmlFor="program-type">Type</label>
      <select
        id="program-type"
        className="form-input"
        value={program.program_type_id || ''}
        onChange={e => save({ program_type_id: e.target.value || null })}
      >
        <option value="">No type</option>
        {programTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label className="program-field" htmlFor="program-description">About</label>
      <textarea
        id="program-description"
        className="form-input"
        rows={6}
        value={description}
        placeholder="What this programme covers"
        onChange={e => setDescription(e.target.value)}
        onBlur={saveDescription}
      />
    </section>
  );
}

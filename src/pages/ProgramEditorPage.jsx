import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { supabase } from '../lib/supabase.js';
import { useProgram } from '../hooks/useProgram.js';
import { useProgramTypes } from '../hooks/useProgramTypes.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function ProgramEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { run: runBusy } = useBusyOverlay();
  const {
    loading, error, program, workbook, assessment, materials,
    updateFields, setStatus, deleteProgram,
    attachWorkbook, detachWorkbook,
    attachAssessment, detachAssessment,
    uploadMaterial, removeMaterial, signedUrlFor,
  } = useProgram(id);
  const { types: programTypes } = useProgramTypes(); // active only
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delErr, setDelErr] = useState('');

  if (loading) return <><TopBar /><main className="page"><div className="loading">Loading…</div></main></>;
  if (error)   return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;
  if (!program) return <><TopBar /><main className="page"><p className="muted">Program not found.</p></main></>;

  async function handleDelete() {
    setDelErr('');
    const { error: e } = await runBusy('Deleting program…', () => deleteProgram());
    if (e) { setDelErr(e.message); return; }
    navigate('/trainer/programs');
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer/programs" className="back-link">&larr; Back to Programs</Link>
            <h1>{program.title}</h1>
            <p>
              Edit the program's details, attach a workbook, and upload handouts and quick-reference
              PDFs. Sessions are created from a published program (coming in a later release).
            </p>
          </div>
          <div className="page-hero-actions">
            <StatusToggle program={program} setStatus={setStatus} runBusy={runBusy} />
            {confirmDelete ? (
              <>
                <span className="confirm-text">Delete program? Workbook &amp; assessment will be detached.</span>
                <button className="danger" onClick={handleDelete}>Yes</button>
                <button className="ghost" onClick={() => { setConfirmDelete(false); setDelErr(''); }}>No</button>
              </>
            ) : (
              <button className="ghost danger" onClick={() => setConfirmDelete(true)}>Delete program</button>
            )}
          </div>
        </section>
        {delErr && <p className="error">{delErr}</p>}

        <DetailsCard program={program} updateFields={updateFields} programTypes={programTypes} runBusy={runBusy} />

        <WorkbookCard
          programId={id}
          workbook={workbook}
          attachWorkbook={attachWorkbook}
          detachWorkbook={detachWorkbook}
          runBusy={runBusy}
        />

        <AssessmentCard
          programId={id}
          assessment={assessment}
          attachAssessment={attachAssessment}
          detachAssessment={detachAssessment}
          runBusy={runBusy}
        />

        <MaterialsCard
          kind="handout"
          title="Handouts"
          subtitle="PDFs of participant handouts. Reference-only — sessions read the latest version."
          materials={materials.filter(m => m.kind === 'handout')}
          uploadMaterial={uploadMaterial}
          removeMaterial={removeMaterial}
          signedUrlFor={signedUrlFor}
          runBusy={runBusy}
        />

        <MaterialsCard
          kind="quick_ref"
          title="Quick-reference guides"
          subtitle="Cheat sheets and quick-reference PDFs. Same reference semantics as handouts."
          materials={materials.filter(m => m.kind === 'quick_ref')}
          uploadMaterial={uploadMaterial}
          removeMaterial={removeMaterial}
          signedUrlFor={signedUrlFor}
          runBusy={runBusy}
        />
      </main>
    </>
  );
}

function StatusToggle({ program, setStatus, runBusy }) {
  async function toggle() {
    const next = program.status === 'published' ? 'draft' : 'published';
    await runBusy(next === 'published' ? 'Publishing…' : 'Reverting to draft…', () => setStatus(next));
  }
  const isPublished = program.status === 'published';
  return (
    <button type="button" className={isPublished ? 'ghost' : ''} onClick={toggle}>
      {isPublished ? 'Revert to draft' : 'Publish program'}
    </button>
  );
}

function DetailsCard({ program, updateFields, programTypes, runBusy }) {
  const [title, setTitle] = useState(program.title);
  const [description, setDescription] = useState(program.description || '');
  const [typeId, setTypeId] = useState(program.program_type_id || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Keep local form in sync if the program reloads (e.g. status toggle).
  useEffect(() => {
    setTitle(program.title);
    setDescription(program.description || '');
    setTypeId(program.program_type_id || '');
  }, [program.id, program.title, program.description, program.program_type_id]);

  async function save(e) {
    e.preventDefault();
    setMsg(''); setBusy(true);
    const { error: err } = await runBusy(
      'Saving program…',
      () => updateFields({
        title: title.trim(),
        description: description.trim() || null,
        program_type_id: typeId || null,
      })
    );
    setBusy(false);
    setMsg(err ? err.message : 'Saved.');
  }

  return (
    <section className="editor-card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Details</h2>
      <form onSubmit={save}>
        <label className="form-label">Title</label>
        <input className="form-input large" value={title} onChange={e => setTitle(e.target.value)} required />

        <label className="form-label">Description (optional)</label>
        <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} />

        <label className="form-label">Program type</label>
        <select className="form-input" value={typeId} onChange={e => setTypeId(e.target.value)}>
          <option value="">— None —</option>
          {programTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div className="form-actions">
          <button type="submit" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          {msg && <span className="muted" style={{ marginLeft: '0.75rem' }}>{msg}</span>}
        </div>
      </form>
    </section>
  );
}

function WorkbookCard({ programId, workbook, attachWorkbook, detachWorkbook, runBusy }) {
  const [available, setAvailable] = useState([]);
  const [pickedId, setPickedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (workbook) return; // no picker shown while one is attached
    (async () => {
      // Unattached master templates only. RLS already restricts to super-tier.
      const { data } = await supabase
        .from('workbooks')
        .select('id, title, updated_at')
        .eq('is_template', true)
        .is('program_id', null)
        .order('updated_at', { ascending: false });
      setAvailable(data || []);
      if (data?.length) setPickedId(data[0].id);
    })();
  }, [workbook, programId]);

  async function handleAttach() {
    if (!pickedId) return;
    setMsg(''); setBusy(true);
    const { error: err } = await runBusy('Attaching workbook…', () => attachWorkbook(pickedId));
    setBusy(false);
    if (err) setMsg(err.message);
  }

  async function handleDetach() {
    if (!confirm('Detach this workbook? The workbook itself is not deleted — it just stops being linked to this program.')) return;
    setMsg(''); setBusy(true);
    const { error: err } = await runBusy('Detaching workbook…', () => detachWorkbook());
    setBusy(false);
    if (err) setMsg(err.message);
  }

  return (
    <section className="editor-card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Workbook</h2>
      <p className="muted" style={{ marginTop: '-0.25rem' }}>
        One workbook per program. Sessions clone this master at creation time, so edits to the
        master never affect a session that's already running.
      </p>

      {workbook ? (
        <div className="participants-table" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border, #e5e7eb)', borderRadius: '0.5rem' }}>
            <div>
              <strong>{workbook.title}</strong>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Updated {new Date(workbook.updated_at).toLocaleDateString()}
              </div>
            </div>
            <div>
              <Link to={`/trainer/workbooks/${workbook.id}`} className="ghost" style={{ marginRight: '0.5rem' }}>Edit</Link>
              <button type="button" className="ghost" onClick={handleDetach} disabled={busy}>Detach</button>
            </div>
          </div>
        </div>
      ) : available.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No unattached templates. <Link to="/trainer/workbooks/new">Create a workbook</Link> or
          detach one from another program.
        </p>
      ) : (
        <div style={{ marginTop: '1rem' }}>
          <label className="form-label">Attach an existing workbook</label>
          <div className="form-grid">
            <select className="form-input" value={pickedId} onChange={e => setPickedId(e.target.value)}>
              {available.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button type="button" onClick={handleAttach} disabled={busy || !pickedId}>
                {busy ? 'Attaching…' : 'Attach'}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && <p className="error" style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </section>
  );
}

function AssessmentCard({ programId, assessment, attachAssessment, detachAssessment, runBusy }) {
  const [available, setAvailable] = useState([]);
  const [pickedId, setPickedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (assessment) return;
    (async () => {
      const { data } = await supabase
        .from('assessments')
        .select('id, title, updated_at')
        .eq('is_template', true)
        .is('program_id', null)
        .order('updated_at', { ascending: false });
      setAvailable(data || []);
      if (data?.length) setPickedId(data[0].id);
    })();
  }, [assessment, programId]);

  async function handleAttach() {
    if (!pickedId) return;
    setMsg(''); setBusy(true);
    const { error: err } = await runBusy('Attaching assessment…', () => attachAssessment(pickedId));
    setBusy(false);
    if (err) setMsg(err.message);
  }

  async function handleDetach() {
    if (!confirm('Detach this assessment? The assessment itself is not deleted — it just stops being linked to this program.')) return;
    setMsg(''); setBusy(true);
    const { error: err } = await runBusy('Detaching assessment…', () => detachAssessment());
    setBusy(false);
    if (err) setMsg(err.message);
  }

  return (
    <section className="editor-card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Assessment</h2>
      <p className="muted" style={{ marginTop: '-0.25rem' }}>
        One assessment per program. Program-internal — vendors don't see assessments in their workbook list.
      </p>

      {assessment ? (
        <div className="participants-table" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border, #e5e7eb)', borderRadius: '0.5rem' }}>
            <div>
              <strong>{assessment.title}</strong>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Updated {new Date(assessment.updated_at).toLocaleDateString()}
              </div>
            </div>
            <div>
              <Link to={`/trainer/assessments/${assessment.id}`} className="ghost" style={{ marginRight: '0.5rem' }}>Edit</Link>
              <button type="button" className="ghost" onClick={handleDetach} disabled={busy}>Detach</button>
            </div>
          </div>
        </div>
      ) : available.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No unattached assessment templates. <Link to="/trainer/assessments">Create an assessment</Link> or
          detach one from another program.
        </p>
      ) : (
        <div style={{ marginTop: '1rem' }}>
          <label className="form-label">Attach an existing assessment</label>
          <div className="form-grid">
            <select className="form-input" value={pickedId} onChange={e => setPickedId(e.target.value)}>
              {available.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button type="button" onClick={handleAttach} disabled={busy || !pickedId}>
                {busy ? 'Attaching…' : 'Attach'}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && <p className="error" style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </section>
  );
}

function MaterialsCard({ kind, title, subtitle, materials, uploadMaterial, removeMaterial, signedUrlFor, runBusy }) {
  const [file, setFile] = useState(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setMsg(''); setBusy(true);
    const { error: err } = await runBusy('Uploading…', () => uploadMaterial({ file, kind, title: label }));
    setBusy(false);
    if (err) { setMsg(err.message); return; }
    setFile(null);
    setLabel('');
    // Reset the file input by re-rendering — controlled via a key would be cleaner,
    // but the simplest reset is to clear via a ref. Inline form re-mount on submit
    // is good enough here; users can also pick a new file.
    e.target.reset();
  }

  async function handleOpen(m) {
    const { data, error: err } = await signedUrlFor(m);
    if (err) { alert(err.message); return; }
    window.open(data, '_blank', 'noopener,noreferrer');
  }

  async function handleRemove(m) {
    if (!confirm(`Remove "${m.title}"?`)) return;
    const { error: err } = await runBusy('Removing…', () => removeMaterial(m));
    if (err) alert(err.message);
  }

  return (
    <section className="editor-card">
      <h2 className="section-title" style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted" style={{ marginTop: '-0.25rem' }}>{subtitle}</p>

      <form onSubmit={handleUpload} style={{ marginTop: '1rem' }}>
        <label className="form-label">Add a PDF</label>
        <div className="form-grid">
          <input
            type="file"
            accept="application/pdf"
            className="form-input"
            onChange={e => setFile(e.target.files?.[0] || null)}
            required
          />
          <input
            className="form-input"
            placeholder="Title (defaults to filename)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={120}
          />
          <div className="form-actions" style={{ marginTop: 0 }}>
            <button type="submit" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload'}</button>
          </div>
        </div>
        {msg && <p className="error">{msg}</p>}
      </form>

      {materials.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>None yet.</p>
      ) : (
        <table className="participants-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Title</th>
              <th style={{ width: '8rem' }}>Added</th>
              <th style={{ width: '12rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {materials.map(m => (
              <tr key={m.id}>
                <td>{m.title}</td>
                <td>{new Date(m.created_at).toLocaleDateString()}</td>
                <td>
                  <button type="button" className="ghost" onClick={() => handleOpen(m)}>Open</button>
                  <button type="button" className="ghost" onClick={() => handleRemove(m)} style={{ marginLeft: '0.5rem' }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

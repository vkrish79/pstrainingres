import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useAssessmentEditor } from '../hooks/useAssessmentEditor.js';
import ContentEditorScaffold from '../components/editor/ContentEditorScaffold.jsx';
import AddExercisesModal from '../components/editor/AddExercisesModal.jsx';
import AssessmentPrepPanel from '../components/editor/AssessmentPrepPanel.jsx';
import AssessmentAnswerKeyPanel from '../components/editor/AssessmentAnswerKeyPanel.jsx';
import {
  renumberExercisesIn,
  ASSESSMENT_CONTENT_KIND,
} from '../lib/exerciseNumbering.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/editor.css';
import '../styles/workbook.css';
import '../styles/dashboard.css';

export default function AssessmentEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const {
    loading, error, assessment, sections, blocks,
    updateAssessmentTitle, updateAssessmentDescription,
    createBlock, updateBlock, deleteBlock, moveBlock, duplicateBlock,
    createSection, updateSectionTitle, deleteSection,
    deleteAssessment, reload,
  } = useAssessmentEditor(id);

  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [showAddExercises, setShowAddExercises] = useState(false);

  // Assessments are a flat list of numbered questions — no section UI. Keep a
  // single backing section so the block/clone/scoring model is unchanged; create
  // it once if the assessment has none (new assessments, or a freshly emptied one).
  const ensuredSectionRef = useRef(false);
  useEffect(() => {
    if (loading || error || !assessment) return;
    if (sections.length === 0 && !ensuredSectionRef.current) {
      ensuredSectionRef.current = true;
      createSection('Questions');
    }
  }, [loading, error, assessment, sections.length, createSection]);

  if (loading) return <><TopBar /><div className="loading">Loading assessment…</div></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  const title = titleDraft !== '' ? titleDraft : (assessment?.title || '');
  const description = descDraft !== '' ? descDraft : (assessment?.description || '');

  async function commitTitle() {
    if (titleDraft && titleDraft !== assessment.title) {
      await updateAssessmentTitle(titleDraft);
    }
    setTitleDraft('');
  }
  async function commitDescription() {
    if (descDraft !== (assessment.description || '')) {
      await updateAssessmentDescription(descDraft.trim() || null);
    }
    setDescDraft('');
  }

  async function handleDelete() {
    setDelErr('');
    const { error: e } = await runBusy('Deleting assessment…', () => deleteAssessment());
    if (e) { setDelErr(e.message); return; }
    navigate('/trainer/assessments');
  }

  return (
    <>
      <TopBar />
      <main className={`page editor ${showPreview ? 'with-preview' : ''}`}>
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer/assessments" className="back-link">&larr; Back to Assessments</Link>
            <h1>Assessment editor</h1>
            <p>Same block model as a workbook. Attach to a program from its editor page when ready.</p>
          </div>
          <div className="page-hero-actions">
            <button className="ghost" onClick={() => setShowPreview(p => !p)}>
              {showPreview ? '◧ Hide preview' : '◨ Show preview'}
            </button>
            {confirmDelete ? (
              <>
                <span className="confirm-text">Delete assessment &amp; all questions?</span>
                <button className="danger" onClick={handleDelete}>Yes</button>
                <button className="ghost" onClick={() => { setConfirmDelete(false); setDelErr(''); }}>No</button>
              </>
            ) : (
              <button className="ghost danger" onClick={() => setConfirmDelete(true)}>Delete assessment</button>
            )}
          </div>
        </section>
        {delErr && <p className="error">{delErr}</p>}

        <section className="editor-card">
          <label className="form-label">Assessment title</label>
          <input
            className="form-input large"
            value={title}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
          />
          <label className="form-label" style={{ marginTop: '0.75rem' }}>Description (optional)</label>
          <input
            className="form-input"
            value={description}
            onChange={e => setDescDraft(e.target.value)}
            onBlur={commitDescription}
            placeholder="What this assessment covers"
          />
        </section>

        <AssessmentPrepPanel assessment={assessment} sections={sections} profile={profile} />

        <AssessmentAnswerKeyPanel sections={sections} blocks={blocks} />

        <ContentEditorScaffold
          sections={sections}
          blocks={blocks}
          onCreateBlock={createBlock}
          onUpdateBlock={updateBlock}
          onDeleteBlock={deleteBlock}
          onMoveBlock={moveBlock}
          onDuplicateBlock={duplicateBlock}
          onCreateSection={createSection}
          onUpdateSectionTitle={updateSectionTitle}
          onDeleteSection={deleteSection}
          showPreview={showPreview}
          previewTitle={title || 'Untitled assessment'}
          allowInteractive
          flat
          extraAddSectionActions={
            <>
              <button className="ghost" onClick={() => setShowAddExercises(true)}>➕ Add exercises from another assessment</button>
              <button className="ghost" onClick={async () => { await renumberExercisesIn(ASSESSMENT_CONTENT_KIND, id); await reload(); }}>🔢 Renumber exercises</button>
            </>
          }
        />
      </main>
      {showAddExercises && (
        <AddExercisesModal
          currentParentId={id}
          kindConfig={ASSESSMENT_CONTENT_KIND}
          onClose={() => setShowAddExercises(false)}
          onAdded={reload}
        />
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAssessmentEditor } from '../hooks/useAssessmentEditor.js';
import { useAssessmentDraft, isDraftId } from '../hooks/useAssessmentDraft.js';
import { useAssessmentAnswerKeys } from '../hooks/useAssessmentAnswerKeys.js';
import ContentEditorScaffold from '../components/editor/ContentEditorScaffold.jsx';
import QuestionTagsPanel from '../components/editor/QuestionTagsPanel.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/editor.css';
import '../styles/workbook.css';
import '../styles/dashboard.css';

// The question bank editor.
//
// A bank is an assessments row with kind='bank', so this reuses the assessment
// editor's machinery wholesale — the same draft hook, the same sections-and-blocks
// scaffold. What it leaves out is everything that belongs to a paper rather than
// to a question: no scorecard, no pass mark, no prep pools, no session edit-heat,
// no withdraw-a-question. A bank question is never taken by anyone; it is only
// ever copied into an assessment that is.
//
// What a bank DOES own is the correct answer, and that is marked on the question
// itself, in its own editor. Marks and marking criteria are set later, in
// whichever assessment the question is pulled into.
export default function QuestionBankEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    loading, error, assessment: bank,
    sections: savedSections, blocks: savedBlocks,
    updateAssessmentTitle, updateAssessmentDescription,
    deleteAssessment, reload,
  } = useAssessmentEditor(id);

  const draft = useAssessmentDraft({ sections: savedSections, blocks: savedBlocks, reload });
  const { sections, blocks } = draft;

  // A bank holds the correct ANSWER and nothing else — no marks, no marking
  // criteria — so there is no scorecard panel on this page at all. The answer is
  // marked on the question itself, which is the only thing a bank owns.
  const savedBlockIds = blocks
    .filter(b => !isDraftId(b.id) && !isDraftId(b.section_id))
    .map(b => b.id);
  const keysApi = useAssessmentAnswerKeys(savedBlockIds);

  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delErr, setDelErr] = useState('');

  // Same shape as the assessment editor's, deliberately: an empty draft falls
  // back to the saved value rather than being seeded in an effect.
  const title = titleDraft !== '' ? titleDraft : (bank?.title || '');
  const description = descDraft !== '' ? descDraft : (bank?.description || '');

  // Leaving with staged structural work would lose it silently.
  useEffect(() => {
    if (!draft.dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft.dirty]);

  async function commitTitle() {
    if (!bank) return;
    if (titleDraft && titleDraft !== bank.title) {
      await updateAssessmentTitle(titleDraft);
    }
  }
  async function commitDescription() {
    if (!bank) return;
    if (descDraft !== (bank.description || '')) {
      await updateAssessmentDescription(descDraft.trim() || null);
    }
  }

  async function handleDelete() {
    setDelErr('');
    const res = await deleteAssessment();
    if (res?.error) { setDelErr(res.error.message || String(res.error)); return; }
    navigate('/trainer/question-bank');
  }

  if (loading) return <><TopBar /><SkeletonPage label="Loading question bank…" /></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;
  if (!bank) return <><TopBar /><main className="page"><p className="muted">Not found.</p></main></>;

  return (
    <>
      <TopBar />
      <main className={`page editor ${showPreview ? 'with-preview' : ''}`}>
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer/question-bank" className="back-link">&larr; Back to Question bank</Link>
            <h1>Question bank editor</h1>
            <p>
              Write each question once, with its correct answer. Assessments pick from here and set
              what each question is worth; a question you change here is offered to every
              assessment that has not started yet.
            </p>
          </div>
          <div className="page-hero-actions">
            <button className="ghost" onClick={() => setShowPreview(p => !p)}>
              {showPreview ? '◧ Hide preview' : '◨ Show preview'}
            </button>
            {confirmDelete ? (
              <>
                <span className="confirm-text">Delete this bank &amp; all its questions?</span>
                <button className="danger" onClick={handleDelete}>Yes</button>
                <button className="ghost" onClick={() => { setConfirmDelete(false); setDelErr(''); }}>No</button>
              </>
            ) : (
              <button className="ghost danger" onClick={() => setConfirmDelete(true)}>Delete bank</button>
            )}
          </div>
        </section>
        {delErr && <p className="error">{delErr}</p>}
        {/* With no scorecard on this page there is nowhere else for an
            answer-key failure to appear, and a silently unsaved correct answer is
            the worst kind of failure here — the question looks finished. */}
        {keysApi.error && (
          <p className="error">⚠️ Correct answers aren’t saving. {keysApi.error}</p>
        )}

        <section className="editor-card">
          <label className="form-label">Question bank title</label>
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
            placeholder="What this bank covers"
          />
        </section>

        <div className={`draft-bar ${draft.dirty ? 'dirty' : ''}`}>
          <span className="draft-bar-status">
            {draft.dirty ? '● Unsaved changes to the questions' : 'All question changes saved'}
          </span>
          <span className="draft-bar-hint">
            Question wording and correct answers save on their own.
          </span>
          <button disabled={!draft.dirty || draft.saving} onClick={() => draft.save(id)}>
            {draft.saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="ghost" disabled={!draft.dirty || draft.saving} onClick={draft.discard}>
            Discard
          </button>
        </div>

        {draft.saveError && (
          <div className="organise-error-detail">
            <div className="organise-error-head">
              Save failed at the “{draft.saveError.stage}” step — nothing else was written
            </div>
            <table>
              <tbody>
                <tr><th>code</th><td>{draft.saveError.code}</td></tr>
                <tr><th>message</th><td>{draft.saveError.message}</td></tr>
                <tr><th>details</th><td>{draft.saveError.details}</td></tr>
                <tr><th>hint</th><td>{draft.saveError.hint}</td></tr>
              </tbody>
            </table>
            <button className="ghost" style={{ marginTop: '.5rem' }} onClick={draft.clearSaveError}>
              Dismiss
            </button>
          </div>
        )}

        {/* Tags are what make a bank browsable by subject rather than only by
            widget type. Saved sections only — a tag is written straight to the
            row, and a draft question has no row yet. */}
        <QuestionTagsPanel
          sections={sections.filter(s => !isDraftId(s.id))}
          blocks={blocks}
          unsavedCount={sections.filter(s => isDraftId(s.id)).length}
          onSaved={reload}
        />

        {/* NO SCORECARD PANEL HERE, deliberately. Marks and marking criteria are a
            property of the paper a question appears in, not of the question — the
            same question is worth 2 in a foundation test and 5 in a certification.
            A bank owns the correct answer only, and that is marked on the question
            itself, so a panel here would have exactly nothing left to show. */}

        <ContentEditorScaffold
          sections={sections}
          blocks={blocks}
          onCreateBlock={draft.createBlock}
          onMoveBlockTo={draft.moveBlockTo}
          onUpdateBlock={draft.updateBlock}
          answerKeys={keysApi.keys}
          onSaveAnswerKey={keysApi.setCorrectAnswer}
          answerKeysLoaded={keysApi.loaded}
          onDeleteBlock={draft.deleteBlock}
          onMoveBlock={draft.moveBlock}
          onDuplicateBlock={draft.duplicateBlock}
          onCreateSection={draft.createSection}
          onUpdateSectionTitle={draft.updateSectionTitle}
          onDeleteSection={draft.deleteSection}
          onMoveSection={draft.moveSection}
          showPreview={showPreview}
          previewTitle={title || 'Untitled question bank'}
          allowInteractive
          questions
        />
      </main>
    </>
  );
}

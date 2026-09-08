import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useAssessmentEditor } from '../hooks/useAssessmentEditor.js';
import { useAssessmentDraft, isDraftId } from '../hooks/useAssessmentDraft.js';
import ContentEditorScaffold from '../components/editor/ContentEditorScaffold.jsx';
import AddExercisesModal from '../components/editor/AddExercisesModal.jsx';
import AssessmentPrepPanel from '../components/editor/AssessmentPrepPanel.jsx';
import AssessmentAnswerKeyPanel from '../components/editor/AssessmentAnswerKeyPanel.jsx';
import QuestionNav from '../components/editor/QuestionNav.jsx';
import EditHeatModal from '../components/editor/EditHeatModal.jsx';
import WorkbookChangesModal from '../components/editor/WorkbookChangesModal.jsx';
import { useAssessmentEditHeat } from '../hooks/useWorkbookEditHeat.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import OrganiseQuestionsPanel from '../components/editor/OrganiseQuestionsPanel.jsx';
import { ASSESSMENT_CONTENT_KIND } from '../lib/exerciseNumbering.js';
import { buildQuestions } from '../lib/assessmentStructure.js';
import { isWithdrawn, withdrawalOf, setQuestionWithdrawn } from '../lib/questionWithdrawal.js';
import WithdrawQuestion from '../components/WithdrawQuestion.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/editor.css';
import '../styles/workbook.css';
import '../styles/dashboard.css';
import '../styles/edit-heat.css';

export default function AssessmentEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const {
    loading, error, assessment,
    sections: savedSections, blocks: savedBlocks,
    updateAssessmentTitle, updateAssessmentDescription,
    deleteAssessment, reload,
  } = useAssessmentEditor(id);

  // Structural edits stage here until Save. Content, title/description and
  // answer keys still write immediately — see hooks/useAssessmentDraft.js for
  // why that line is drawn where it is.
  const draft = useAssessmentDraft({ sections: savedSections, blocks: savedBlocks, reload });
  const { sections, blocks, createSection } = draft;

  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [showAddExercises, setShowAddExercises] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(null);
  const [withdrawErr, setWithdrawErr] = useState({});
  const [heatFocus, setHeatFocus] = useState(null); // { sectionId, sectionTitle, blockId, blockLabel }
  const [showAllChanges, setShowAllChanges] = useState(false);

  // What the field has changed in its own copies of this assessment. Only a
  // super trainer sees it — the RPCs return nothing for anyone else, and firing
  // a query that can only come back empty just looks broken.
  const heatEnabled = assessment?.is_template === true && isSuperTrainerOrAbove(profile?.role);
  const {
    bySection: heatBySection, byBlock: heatByBlock,
    openSections, totalSections, refresh: refreshHeat,
  } = useAssessmentEditHeat(id, heatEnabled);

  // A section IS a question (lib/assessmentStructure.js). A brand-new
  // assessment starts with one empty question rather than nothing, so there is
  // somewhere to put the first block without a separate "add question" step.
  const ensuredSectionRef = useRef(false);
  useEffect(() => {
    if (loading || error || !assessment) return;
    if (sections.length === 0 && !ensuredSectionRef.current) {
      ensuredSectionRef.current = true;
      createSection('Question 1');
    }
    // createSection is a stable useCallback; depending on `draft` itself would
    // re-run this on every render, since the hook returns a fresh object.
  }, [loading, error, assessment, sections.length, createSection]);

  // Leaving with staged structural work would lose it silently. The browser's
  // own prompt is the only thing that can interrupt a navigation away.
  useEffect(() => {
    if (!draft.dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft.dirty]);

  // Withdrawing on the MASTER means "never include this question in any future
  // session" — the session-level equivalent lives on the trainer's own copy.
  // It writes immediately rather than staging with the structural edits,
  // because it is a config change like question wording, and because a
  // withdrawal is a decision rather than a draft.
  async function applyWithdraw(q, withdrawn, reason) {
    setWithdrawBusy(q.section.id);
    setWithdrawErr(prev => ({ ...prev, [q.section.id]: null }));
    const res = await setQuestionWithdrawn(q.blocks, {
      withdrawn,
      reason,
      actor: { name: profile?.full_name || null },
    });
    setWithdrawBusy(null);
    if (res.error) {
      setWithdrawErr(prev => ({ ...prev, [q.section.id]: res.error.message || String(res.error) }));
      return res;
    }
    await reload();
    return {};
  }

  function renderQuestionWithdraw(q) {
    // Nothing to withdraw until the question has been saved and has content.
    if (!q.blocks.length || q.blocks.some(b => isDraftId(b.id))) return null;
    const withdrawn = q.blocks.every(isWithdrawn);
    return (
      <WithdrawQuestion
        withdrawn={withdrawn}
        withdrawal={withdrawalOf(q.blocks)}
        busy={withdrawBusy === q.section.id}
        error={withdrawErr[q.section.id]}
        onWithdraw={reason => applyWithdraw(q, true, reason)}
        onRestore={() => applyWithdraw(q, false, null)}
      />
    );
  }

  // Jump the editor pane to a question. The scaffold already stamps
  // data-section-id on each question, so the nav needs nothing from it.
  function jumpToQuestion(sectionId) {
    const el = document.querySelector(`[data-section-id="${sectionId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loading) return <><TopBar /><div className="loading">Loading assessment…</div></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  const { questions: qList } = buildQuestions(sections, blocks);

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
            {/* Uses TOTAL, not open: once everything is reviewed the marker
                goes quiet but must stay reachable, or finishing a review would
                make the record disappear. */}
            {heatEnabled && totalSections > 0 && (
              <button
                type="button"
                className="wb-heat-note wb-heat-btn"
                onClick={() => setHeatFocus({
                  sectionId: [...heatBySection.keys()][0],
                  sectionTitle: 'Session changes',
                  blockId: null,
                })}
                title="Questions the field has reworded or withdrawn in their own copies"
              >
                <span className={`heat-dot heat-l${openSections > 0 ? 3 : 0}`} aria-hidden />
                {openSections > 0
                  ? `${openSections} question${openSections === 1 ? '' : 's'} need a look`
                  : `${totalSections} reviewed`}
              </button>
            )}
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

        {/* Sticky, because structural work happens far down a long paper and a
            Save you have to scroll back to is a Save you forget. */}
        <div className={`draft-bar ${draft.dirty ? 'dirty' : ''}`}>
          <span className="draft-bar-status">
            {draft.dirty
              ? '● Unsaved changes to the questions'
              : 'All question changes saved'}
          </span>
          <span className="draft-bar-hint">
            Question wording, answer keys and marks save on their own.
          </span>
          <button disabled={!draft.dirty || draft.saving} onClick={() => draft.save(id)}>
            {draft.saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="ghost" disabled={!draft.dirty || draft.saving} onClick={draft.discard}>
            Cancel
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

        <AssessmentPrepPanel assessment={assessment} sections={sections.filter(s => !isDraftId(s.id))} profile={profile} />

        <OrganiseQuestionsPanel
          sections={sections}
          blocks={blocks}
          onApply={draft.applyGrouping}
        />

        {/* Answer keys address a block's database id, so a question that only
            exists in the draft has nothing to key. Filter those out here and
            say why, rather than offering a control that would fail on save. */}
        <AssessmentAnswerKeyPanel
          sections={sections.filter(s => !isDraftId(s.id))}
          blocks={blocks.filter(b => !isDraftId(b.id) && !isDraftId(b.section_id))}
          unsavedCount={blocks.filter(b => isDraftId(b.id)).length}
        />

        <div className="assessment-editor-body">
          <QuestionNav questions={qList} onJump={jumpToQuestion} />
          <div className="assessment-editor-main">
            {/* There is deliberately no "renumber questions" button. An auto
                question's number is DERIVED from its position every time it
                renders, so it can never be stale — move a question and it
                renumbers itself. Only an author-written heading opts out. */}
            <ContentEditorScaffold
              sections={sections}
              blocks={blocks}
              onCreateBlock={draft.createBlock}
              onUpdateBlock={draft.updateBlock}
              onDeleteBlock={draft.deleteBlock}
              onMoveBlock={draft.moveBlock}
              onDuplicateBlock={draft.duplicateBlock}
              onCreateSection={draft.createSection}
              onUpdateSectionTitle={draft.updateSectionTitle}
              onDeleteSection={draft.deleteSection}
              onMoveSection={draft.moveSection}
              showPreview={showPreview}
              previewTitle={title || 'Untitled assessment'}
              allowInteractive
              questions
              renderQuestionWithdraw={renderQuestionWithdraw}
              heat={heatEnabled ? { bySection: heatBySection, byBlock: heatByBlock } : null}
              onOpenHeat={heatEnabled ? setHeatFocus : null}
              extraAddSectionActions={
                <button className="ghost" onClick={() => setShowAddExercises(true)}>
                  ➕ Add questions from another assessment
                </button>
              }
            />
          </div>
        </div>
      </main>
      {showAllChanges && (
        <WorkbookChangesModal
          kind="assessment"
          workbookId={id}
          workbookTitle={assessment?.title || 'this assessment'}
          onClose={() => setShowAllChanges(false)}
          onResolved={async () => { await refreshHeat(); }}
          onJumpToSection={jumpToQuestion}
        />
      )}
      {heatFocus && (
        <EditHeatModal
          kind="assessment"
          workbookId={id}
          sectionId={heatFocus.sectionId}
          sectionTitle={heatFocus.sectionTitle}
          blockId={heatFocus.blockId}
          blockLabel={heatFocus.blockLabel}
          onClose={() => setHeatFocus(null)}
          onResolved={async () => { await refreshHeat(); await reload(); }}
        />
      )}
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

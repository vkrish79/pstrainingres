import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { useNavigate, useParams } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useAssessmentEditor } from '../hooks/useAssessmentEditor.js';
import { useAssessmentDraft, isDraftId } from '../hooks/useAssessmentDraft.js';
import { useAssessmentAnswerKeys } from '../hooks/useAssessmentAnswerKeys.js';
import ContentEditorScaffold from '../components/editor/ContentEditorScaffold.jsx';
import AddExercisesModal from '../components/editor/AddExercisesModal.jsx';
import AddFromBankModal from '../components/editor/AddFromBankModal.jsx';
import BankUpdatesBar from '../components/editor/BankUpdatesBar.jsx';
import SaveToBankPanel from '../components/editor/SaveToBankPanel.jsx';
import { useBankLinks } from '../hooks/useBankLinks.js';
import AssessmentPrepPanel from '../components/editor/AssessmentPrepPanel.jsx';
import AssessmentAnswerKeyPanel from '../components/editor/AssessmentAnswerKeyPanel.jsx';
import QuestionNav from '../components/editor/QuestionNav.jsx';
import EditHeatModal from '../components/editor/EditHeatModal.jsx';
import { useAssessmentEditHeat } from '../hooks/useWorkbookEditHeat.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import OrganiseQuestionsPanel from '../components/editor/OrganiseQuestionsPanel.jsx';
import { ASSESSMENT_CONTENT_KIND } from '../lib/exerciseNumbering.js';
import { buildQuestions } from '../lib/assessmentStructure.js';
import { linkedBySection } from '../lib/prepTemplateEdit.js';
import { isWithdrawn, withdrawalOf, setQuestionWithdrawn } from '../lib/questionWithdrawal.js';
import WithdrawQuestion from '../components/WithdrawQuestion.jsx';
import TopBar from '../components/TopBar.jsx';
import QuestionEditorHead, { DraftSaveError } from '../components/editor/QuestionEditorHead.jsx';
import SetupDrawer from '../components/editor/SetupDrawer.jsx';
import { isScorableBlock, isManuallyMarkable, isInactiveBlock } from '../lib/assessmentScoring.js';
import { placeholderFixes, newBoxId } from '../lib/tableCells.js';
import '../styles/editor.css';
import '../styles/workbook.css';
import '../styles/dashboard.css';
import '../styles/edit-heat.css';
import '../styles/workbook-editor-head.css';
import '../styles/question-editor-head.css';
import PlaceholderRepair from '../components/editor/PlaceholderRepair.jsx';

export default function AssessmentEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const {
    loading, error, assessment,
    sections: savedSections, blocks: savedBlocks,
    updateAssessmentTitle, updateAssessmentDescription, updateAssessmentPassMark,
    deleteAssessment, reload, saves,
  } = useAssessmentEditor(id);

  // Structural edits stage here until Save. Content, title/description and
  // answer keys still write immediately — see hooks/useAssessmentDraft.js for
  // why that line is drawn where it is.
  const draft = useAssessmentDraft({ sections: savedSections, blocks: savedBlocks, reload, saves });
  const { sections, blocks, createSection } = draft;

  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [passMarkDraft, setPassMarkDraft] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [showAddExercises, setShowAddExercises] = useState(false);
  const [showAddFromBank, setShowAddFromBank] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(null);
  const [withdrawErr, setWithdrawErr] = useState({});
  const [heatFocus, setHeatFocus] = useState(null); // { sectionId, sectionTitle, blockId, blockLabel }
  // Which setup panel the drawer shows; null = closed.
  const [pane, setPane] = useState(null);
  const closePane = useCallback(() => setPane(null), []);
  // The prep template as the Prep template card last loaded or saved it, so each
  // ticked question can carry a marker on its own heading.
  const [prepTemplate, setPrepTemplate] = useState(null);
  const prepBySection = useMemo(() => linkedBySection(prepTemplate), [prepTemplate]);

  // What the field has changed in its own copies of this assessment. Only a
  // super trainer sees it — the RPCs return nothing for anyone else, and firing
  // a query that can only come back empty just looks broken.
  const heatEnabled = assessment?.is_template === true && isSuperTrainerOrAbove(profile?.role);
  const {
    bySection: heatBySection, byBlock: heatByBlock,
    openSections, totalSections, refresh: refreshHeat,
  } = useAssessmentEditHeat(id, heatEnabled);

  // Questions pulled from the bank, and which of them the bank has since
  // changed. Only meaningful on a template: a session clone is a deep copy
  // with no live link to anything.
  const bankLinks = useBankLinks(id, assessment?.is_template === true);

  // ONE answer-key instance for the whole page, shared by the question editor
  // (where the correct option is marked) and the scorecard (which shows marks
  // and manual criteria). Two instances would each cache the same rows and the
  // one that did not write would show a stale answer.
  //
  // Saved blocks only: a key is stored against a block’s database id, and a
  // block that exists only in the draft has none yet.
  const savedBlockIds = blocks
    .filter(b => !isDraftId(b.id) && !isDraftId(b.section_id))
    .map(b => b.id);
  const keysApi = useAssessmentAnswerKeys(savedBlockIds);

  // A section IS a question (lib/assessmentStructure.js). A brand-new
  // assessment starts with one empty question rather than nothing, so there is
  // somewhere to put the first block without a separate "add question" step.
  const ensuredSectionRef = useRef(false);
  useEffect(() => {
    if (loading || error || !assessment) return;
    // Read the SAVED sections, never the draft's.
    //
    // The draft re-seeds itself in an effect, so on the render where loading
    // flips false the draft still holds its initial empty array — it catches up
    // a commit later. Testing draft.sections here saw "no questions" on every
    // assessment and added a phantom one, which showed up as unsaved changes on
    // a page nobody had touched, and would have saved a real empty question.
    if (savedSections.length === 0 && !ensuredSectionRef.current) {
      ensuredSectionRef.current = true;
      createSection('Question 1');
    }
    // createSection is a stable useCallback; depending on `draft` itself would
    // re-run this on every render, since the hook returns a fresh object.
  }, [loading, error, assessment, savedSections.length, createSection]);

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

  if (loading) return <><TopBar /><SkeletonPage body="lines" rows={6} label="Loading assessment…" /></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  const { questions: qList } = buildQuestions(sections, blocks);

  const title = titleDraft !== '' ? titleDraft : (assessment?.title || '');
  const description = descDraft !== '' ? descDraft : (assessment?.description || '');
  const passMark = passMarkDraft !== null
    ? passMarkDraft
    : (assessment?.pass_mark != null ? String(assessment.pass_mark) : '');

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

  async function commitPassMark() {
    if (passMarkDraft === null) return;          // never focused — nothing to do
    const raw = passMarkDraft.trim();
    const current = assessment?.pass_mark ?? null;

    if (raw === '') {
      // Cleared on purpose: back to "nobody has decided", which prints blank.
      if (current !== null) await updateAssessmentPassMark(null);
      setPassMarkDraft(null);
      return;
    }
    const n = Number(raw);
    // Garbage typed in reverts rather than writing NaN into the column.
    if (!Number.isFinite(n)) { setPassMarkDraft(null); return; }
    // Clamped to the CHECK constraint's range so a typo is corrected here
    // rather than rejected by the database with an opaque error.
    const next = Math.min(100, Math.max(0, n));
    if (next !== current) await updateAssessmentPassMark(next);
    setPassMarkDraft(null);
  }

  async function handleDelete() {
    setDelErr('');
    const { error: e } = await runBusy('Deleting assessment…', () => deleteAssessment());
    if (e) { setDelErr(e.message); return; }
    navigate('/trainer/assessments');
  }

  // ── Setup chips: one line of state, each opening its panel ──────────────
  // Every count comes from data this page already holds; none adds a query.
  const qCount = qList.length;
  const prepCount = prepTemplate ? qList.filter(q => prepBySection.get(q.section.id)).length : null;
  const markable = blocks.filter(b => !isDraftId(b.id) && !isInactiveBlock(b)
    && (isScorableBlock(b) || isManuallyMarkable(b)));
  const setUp = markable.filter(b => keysApi.keys[b.id] != null || keysApi.modes?.[b.id] === 'manual').length;
  const repairCells = blocks.filter(b => !isDraftId(b.id) && b.block_type === 'table')
    .reduce((n, b) => n + placeholderFixes(b.config, newBoxId).length, 0);
  const bankUpdates = (bankLinks.stale?.length || 0) + (bankLinks.orphaned?.length || 0);
  const PANES = {
    details: 'Details',
    prep: 'Prep template',
    scorecard: 'Scorecard',
    repair: 'Answer boxes to fix',
    bank: 'Bank updates',
    organise: 'Organise questions',
    savebank: 'Save to the question bank',
  };
  // Until the keys have loaded, "0 of 34" would be a false alarm: say nothing.
  const scoreKnown = keysApi.loaded && markable.length > 0;
  const scoreClass = keysApi.error ? ' is-bad'
    : scoreKnown && setUp === markable.length ? ' is-ok'
      : scoreKnown ? ' is-warn' : '';

  return (
    <>
      <TopBar />
      <main className={`page editor wbe-page ${showPreview ? 'with-preview' : ''}`}>
        <QuestionEditorHead
          backTo="/trainer/assessments"
          backLabel="← Assessments"
          kindLabel="Assessment"
          titleLabel="Assessment title"
          title={title}
          onTitleChange={setTitleDraft}
          onTitleCommit={commitTitle}
          saves={saves}
          onReload={reload}
          draft={draft}
          onSaveDraft={() => draft.save(id)}
          savedHint="Moving, adding and removing questions waits for Save. Wording, answer keys and marks save on their own."
          menuItems={[
            { label: 'Delete assessment…', glyph: '✕', danger: true, onClick: () => setConfirmDelete(true) },
          ]}
        >
          {/* Uses TOTAL, not open: once everything is reviewed the marker
              goes quiet but must stay reachable, or finishing a review would
              make the record disappear. */}
          {heatEnabled && totalSections > 0 && (
            <button
              type="button"
              className="wbe-chip wbe-heat"
              onClick={() => setHeatFocus({
                sectionId: [...heatBySection.keys()][0],
                sectionTitle: 'Session changes',
                blockId: null,
              })}
              data-tip="Questions the field has reworded or withdrawn in their own copies"
            >
              <span className={`heat-dot heat-l${openSections > 0 ? 3 : 0}`} aria-hidden />
              {openSections > 0
                ? `${openSections} question${openSections === 1 ? '' : 's'} need a look`
                : `${totalSections} reviewed`}
            </button>
          )}
          <button type="button" className="wbe-chip wbe-preview-toggle" onClick={() => setShowPreview(p => !p)} aria-pressed={showPreview}>
            {showPreview ? '◧ Hide preview' : '◨ Show preview'}
          </button>
        </QuestionEditorHead>

        {confirmDelete && (
          <div className="wbe-confirm">
            <span className="confirm-text">Delete this assessment and all its questions? This cannot be undone.</span>
            <button className="danger" onClick={handleDelete}>Delete assessment</button>
            <button className="ghost" onClick={() => { setConfirmDelete(false); setDelErr(''); }}>Keep</button>
          </div>
        )}
        {delErr && <p className="error">{delErr}</p>}

        {/* Setup, as chips. Anything that needs attention is a warning chip,
            so moving the panels into the drawer never makes it go quiet. */}
        <nav className="qe-setup" aria-label="Assessment setup">
          <button type="button" className="qe-chip" onClick={() => setPane('details')}>
            {passMark === '' ? 'No pass mark' : `Pass mark ${passMark}%`}
          </button>
          <button
            type="button"
            className={`qe-chip${prepCount != null && qCount && prepCount === qCount ? ' is-ok' : ''}`}
            onClick={() => setPane('prep')}
          >
            {prepCount == null ? 'Prep' : `Prep · ${prepCount} of ${qCount}`}
          </button>
          <button type="button" className={`qe-chip${scoreClass}`} onClick={() => setPane('scorecard')}>
            {keysApi.error
              ? 'Answer keys aren’t saving'
              : scoreKnown ? `Scorecard · ${setUp} of ${markable.length} set up` : 'Scorecard'}
          </button>
          {repairCells > 0 && (
            <button type="button" className="qe-chip is-warn" onClick={() => setPane('repair')}>
              {repairCells} answer box{repairCells === 1 ? '' : 'es'} to fix
            </button>
          )}
          {bankUpdates > 0 && (
            <button type="button" className="qe-chip is-warn" onClick={() => setPane('bank')}>
              {bankUpdates} bank update{bankUpdates === 1 ? '' : 's'}
            </button>
          )}
          <button type="button" className="qe-chip" onClick={() => setPane('organise')}>Organise questions</button>
          <button type="button" className="qe-chip" onClick={() => setPane('savebank')}>Save to bank</button>
        </nav>

        {keysApi.error && (
          <p className="error" role="alert">⚠️ Answer keys aren’t saving — changes won’t persist. {keysApi.error}</p>
        )}
        <DraftSaveError
          error={draft.saveError}
          onDismiss={draft.clearSaveError}
          onReload={async () => { draft.clearSaveError(); draft.discard(); await reload(); }}
        />

        <SetupDrawer open={!!pane} title={PANES[pane] || ''} onClose={closePane}>
          <div className="setup-pane" hidden={pane !== 'details'}>
            <label className="form-label" htmlFor="asmt-desc">Description (optional)</label>
            <input
              id="asmt-desc"
              className="form-input"
              value={description}
              onChange={e => setDescDraft(e.target.value)}
              onBlur={commitDescription}
              placeholder="What this assessment covers"
            />
            {/* Blank is a real value, not a missing one: it means nobody has
                decided what a pass is, and the report prints that Result cell
                empty rather than calling it a fail. */}
            <label className="form-label qe-gap" htmlFor="asmt-pass">Pass mark (optional)</label>
            <div className="pass-mark-row">
              <input
                id="asmt-pass"
                className="form-input pass-mark-input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={passMark}
                onChange={e => setPassMarkDraft(e.target.value)}
                onBlur={commitPassMark}
                placeholder="—"
              />
              <span className="pass-mark-suffix">%</span>
              <span className="muted pass-mark-hint">
                {passMark === ''
                  ? 'Not set — the report leaves Result blank.'
                  : `Scoring ${passMark}% or above is a pass.`}
              </span>
            </div>
          </div>
          <div className="setup-pane" hidden={pane !== 'prep'}>
            <AssessmentPrepPanel assessment={assessment} sections={sections.filter(s => !isDraftId(s.id))} allSections={sections} profile={profile} onTemplate={setPrepTemplate} />
          </div>
          <div className="setup-pane" hidden={pane !== 'scorecard'}>
            {/* Answer keys address a block's database id, so a question that
                only exists in the draft has nothing to key yet. */}
            <AssessmentAnswerKeyPanel
              keysApi={keysApi}
              sections={sections.filter(s => !isDraftId(s.id))}
              blocks={blocks.filter(b => !isDraftId(b.id) && !isDraftId(b.section_id))}
              unsavedCount={blocks.filter(b => isDraftId(b.id)).length}
            />
          </div>
          <div className="setup-pane" hidden={pane !== 'repair'}>
            {/* Saved blocks only: a draft block is written whole on Save anyway. */}
            <PlaceholderRepair
              sections={sections}
              blocks={blocks.filter(b => !isDraftId(b.id))}
              onSaveBlock={draft.updateBlock}
            />
          </div>
          <div className="setup-pane" hidden={pane !== 'bank'}>
            <BankUpdatesBar
              stale={bankLinks.stale}
              orphaned={bankLinks.orphaned}
              onResync={async (ids) => { const r = await bankLinks.resync(ids); await reload(); return r; }}
            />
          </div>
          <div className="setup-pane" hidden={pane !== 'organise'}>
            <OrganiseQuestionsPanel sections={sections} blocks={blocks} onApply={draft.applyGrouping} />
          </div>
          <div className="setup-pane" hidden={pane !== 'savebank'}>
            {/* Saved sections only: a draft question has no row yet, so there
                is no answer key for the copy to carry. */}
            <SaveToBankPanel
              sections={sections.filter(s => !isDraftId(s.id))}
              blocks={blocks.filter(b => !isDraftId(b.id) && !isDraftId(b.section_id))}
              unsavedCount={sections.filter(s => isDraftId(s.id)).length
                + blocks.filter(b => isDraftId(b.id)).length}
            />
          </div>
        </SetupDrawer>

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
              previewTitle={title || 'Untitled assessment'}
              allowInteractive
              questions
              renderQuestionWithdraw={renderQuestionWithdraw}
              heat={heatEnabled ? { bySection: heatBySection, byBlock: heatByBlock } : null}
              onOpenHeat={heatEnabled ? setHeatFocus : null}
              prepBySection={prepBySection}
              extraAddSectionActions={
                <>
                  {/* Two ways in, deliberately separate. The bank is the reusable
                      pool built for this; the other assessment is the older
                      "I know there's one like it in that paper" route, which
                      stays as it was.

                      BOTH are blocked while there are unsaved structural edits,
                      and that is not caution — it prevents silent loss. Either
                      one writes its questions server-side and then reloads, and
                      the draft re-seeds from whatever comes back. Any staged
                      move, rename or DELETE is thrown away in that moment, with
                      nothing on screen to say so: remove a question, add one
                      from the bank, and the removed question quietly returns. */}
                  <button
                    className="ghost"
                    disabled={draft.dirty}
                    data-tip={draft.dirty
                      ? 'Save your changes first — adding reloads the questions, which would discard them'
                      : 'Pick questions from a bank, or draw some at random'}
                    onClick={() => setShowAddFromBank(true)}
                  >
                    <span className="btn-glyph" aria-hidden>✈</span> Add from the question bank
                  </button>
                  <button
                    className="ghost"
                    disabled={draft.dirty}
                    data-tip={draft.dirty
                      ? 'Save your changes first — adding reloads the questions, which would discard them'
                      : 'Copy questions out of another assessment'}
                    onClick={() => setShowAddExercises(true)}
                  >
                    <span className="btn-glyph" aria-hidden>⊕</span> Add questions from another assessment
                  </button>
                </>
              }
            />
          </div>
        </div>
      </main>
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
      {showAddFromBank && (
        <AddFromBankModal
          currentParentId={id}
          // From the DRAFT list, not from the database. A removed question is
          // staged until Save, so reading the database would keep calling it
          // "already added" after it had gone from the screen.
          usedBankSectionIds={sections.map(s => s.source_bank_section_id)}
          onClose={() => setShowAddFromBank(false)}
          onAdded={async () => { await reload(); await bankLinks.refresh(); }}
        />
      )}
    </>
  );
}

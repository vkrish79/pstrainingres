import { Fragment, useEffect, useRef, useState } from 'react';
import BlockListItem from './BlockListItem.jsx';
import AddBlockMenu from './AddBlockMenu.jsx';
import KebabMenu from '../KebabMenu.jsx';
import WorkbookOutline, { ALL } from './WorkbookOutline.jsx';
// Only reached when a caller supplies onSaveAnswerKey, i.e. an assessment or a
// question bank. A workbook never passes it, so this branch is dead there.
import { isDraftId } from '../../hooks/useAssessmentDraft.js';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { isInactiveBlock } from '../../lib/assessmentScoring.js';
import { heatLevel } from '../../lib/configDiff.js';
import { newBlock } from '../../lib/newBlock.js';
import { HeatChip, PrepChip } from './ScaffoldMarkers.jsx';
import ScaffoldPreview from './ScaffoldPreview.jsx';

// Shared sections-and-blocks editor (editor pane + live participant preview
// with scroll-sync). Powers both the workbook editor and the assessment
// editor — the wrapping page supplies the parent (workbook/assessment)
// header, any kind-specific extras (workbook prep panel, vendor-visible
// toggle, add-from-other-workbook modal), and the showPreview toggle UI.
//
// Behavior change here means a behavior change in both editors; preserving
// the long-standing block-level scroll-sync is intentional.
export default function ContentEditorScaffold({
  sections,
  blocks,
  onCreateBlock,
  onMoveBlockTo = null,
  onUpdateBlock,
  answerKeys = null,        // { [blockId]: correct answer } — assessment/bank only
  onSaveAnswerKey = null,   // (blockId, key) => Promise; absent = no answers here
  answerKeysLoaded = true,  // false while the first read is in flight
  onDeleteBlock,
  onMoveBlock,
  onDuplicateBlock,
  onCreateSection,
  onUpdateSectionTitle,
  onDeleteSection,
  onMoveSection = null,
  showPreview,
  previewTitle,
  extraAddSectionActions = null,
  allowInteractive = false,
  // Session-edit heat: { bySection, byBlock } keyed by master section/block id,
  // plus a click handler. Null for the assessment editor, which renders exactly
  // as it did before.
  heat = null,
  onOpenHeat = null,
  // Question mode (assessments): a SECTION IS A QUESTION. Its prose is
  // narration, its fillable blocks are the sub-questions, lettered (a)(b)(c).
  // See lib/assessmentStructure.js for the numbering rules.
  //
  // This replaces the older flat mode, where the section layer was hidden and
  // every fillable block in the whole assessment took the next running number.
  questions = false,
  // Question-level withdraw control, supplied by the assessment editor. Kept as
  // a render prop because withdrawal writes immediately (it is a config change)
  // while everything else in this editor is staged — the scaffold should not
  // have to know the difference.
  renderQuestionWithdraw = null,
  // Rendered under a question's heading. A bank puts its topics here; an
  // assessment passes nothing and is unchanged.
  renderQuestionExtra = null,
  // Map of section id -> its prep_template entry, for the exercises ticked in
  // the Prep template card. Null where there is no such card (a session copy,
  // a question bank), and then no heading carries a prep marker.
  prepBySection = null,
  // Workbook outline (WorkbookOutline.jsx): a list of every group and exercise
  // beside the editor. With it, focusSectionId picks the ONE section shown in
  // the editor and the preview, or ALL for the long scroll. The page owns the
  // value (it lives in the URL) so a jump from elsewhere on the page can set it.
  // Off for assessments, which have their own question list.
  outline = false,
  focusSectionId = ALL,
  onFocusSection = null,
}) {
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');
  const [confirmDelSection, setConfirmDelSection] = useState(null);
  const [activeBlockId, setActiveBlockId] = useState(null);
  const [pulseBlockId, setPulseBlockId] = useState(null);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const editorSectionRefs = useRef({});
  const editorBlockRefs = useRef({});
  const previewSectionRefs = useRef({});
  const previewBlockRefs = useRef({});
  const previewPaneRef = useRef(null);
  // Suppress observer-driven sync briefly after a click-to-locate, so the
  // smooth-scroll animation completes without being overridden.
  const suppressSyncUntilRef = useRef(0);

  function scrollPreviewTo(blockId, { smooth }) {
    const target = previewBlockRefs.current[blockId];
    const pane = previewPaneRef.current;
    if (!target || !pane) return;
    const offset =
      target.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop -
      8;
    pane.scrollTo({ top: Math.max(0, offset), behavior: smooth ? 'smooth' : 'auto' });
  }

  function locateBlockInPreview(blockId) {
    suppressSyncUntilRef.current = Date.now() + 800;
    setActiveBlockId(blockId);
    setSelectedBlockId(blockId);
    scrollPreviewTo(blockId, { smooth: true });
    setPulseBlockId(blockId);
    setTimeout(() => setPulseBlockId(p => (p === blockId ? null : p)), 1200);
  }

  // Block-level scroll sync: the editor block whose top sits highest within
  // the upper band of the viewport is the "active" block; the preview pane
  // mirrors its position in real time.
  useEffect(() => {
    if (!showPreview) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressSyncUntilRef.current) return;
        const visible = entries
          .filter(e => e.isIntersecting)
          .map(e => ({ id: e.target.dataset.blockId, ratio: e.intersectionRatio, top: e.boundingClientRect.top }))
          .sort((a, b) => a.top - b.top); // topmost-in-band wins
        if (visible.length && visible[0].id) {
          setActiveBlockId(visible[0].id);
        }
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: [0, 0.25, 0.75, 1] }
    );
    Object.values(editorBlockRefs.current).forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [blocks, showPreview, focusSectionId]);

  // When natural-scroll changes the active block, mirror in the preview pane.
  // 'auto' (instant) keeps tracking glued to scroll; deliberate clicks use
  // smooth via locateBlockInPreview.
  useEffect(() => {
    if (!activeBlockId) return;
    if (Date.now() < suppressSyncUntilRef.current) return;
    scrollPreviewTo(activeBlockId, { smooth: false });
  }, [activeBlockId]);

  const focusMode = outline && focusSectionId && focusSectionId !== ALL;
  const visibleSections = focusMode ? sections.filter(s => s.id === focusSectionId) : sections;

  // Outline click. One-at-a-time: show that section and go to the top of it.
  // Long scroll: scroll to it, as the assessment question list does.
  function pickSection(id) {
    if (id === ALL || focusMode) {
      onFocusSection?.(id);
      window.scrollTo({ top: 0 });
      return;
    }
    const el = editorSectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Prev / Next walk the exercises, plus any group heading that carries blocks
  // of its own. An empty group heading is a divider, not a page worth landing on.
  const steppable = outline
    ? sections.filter(s => s.kind !== 'group' || blocks.some(b => b.section_id === s.id))
    : [];
  function stepSection(delta) {
    const i = steppable.findIndex(s => s.id === focusSectionId);
    const next = steppable[i + delta];
    if (next) pickSection(next.id);
  }
  function pagerFor() {
    if (!focusMode) return null;
    const i = sections.findIndex(s => s.id === focusSectionId);
    if (i < 0) return null;
    const cur = sections[i];
    let g = i - 1; while (g >= 0 && sections[g].kind !== 'group') g--;
    const group = cur.kind === 'group' ? '' : (g >= 0 ? sections[g].title : '');
    const exercises = sections.filter(s => s.kind !== 'group');
    const exIdx = exercises.findIndex(s => s.id === cur.id);
    const si = steppable.findIndex(s => s.id === cur.id);
    return (
      <div className="editor-pager">
        {group && <span className="editor-pager-group">§ {group}</span>}
        <span className="editor-pager-pos">
          {exIdx >= 0 ? <><b>{exIdx + 1}</b> of {exercises.length} exercises</> : 'Group heading'}
        </span>
        <button type="button" className="ghost" onClick={() => stepSection(-1)} disabled={si <= 0}>← Prev</button>
        <button type="button" className="ghost" onClick={() => stepSection(1)} disabled={si < 0 || si === steppable.length - 1}>Next →</button>
      </div>
    );
  }

  const activeSectionId = activeBlockId
    ? blocks.find(b => b.id === activeBlockId)?.section_id || null
    : null;

  // Question mode: sections in order, each with its narration and its parts.
  const { questions: qList, partLabelByBlockId } = questions
    ? buildQuestions(sections, blocks)
    : { questions: [], partLabelByBlockId: {} };

  // The add row at the foot of a section. ONE definition, used by both the
  // question path and the section path — this markup existed twice until now,
  // character-identical, which meant any change to it reached the assessment
  // editor or the workbook editor but never both.
  function addBlockRow(sectionId) {
    return (
      <div className="add-block-row">
        <AddBlockMenu
          allowInteractive={allowInteractive}
          onAdd={type => handleAdd(sectionId, type)}
        />
      </div>
    );
  }

  // An insertion point BETWEEN two blocks. Hidden until the gap is hovered or
  // something inside it takes focus, so the resting page is no busier than it
  // was — but reachable by keyboard, which a hover-only control is not.
  function insertPoint(sectionId, afterIndex) {
    return (
      <div className="block-insert">
        <span className="block-insert-line" aria-hidden />
        <AddBlockMenu
          compact
          allowInteractive={allowInteractive}
          onAdd={type => handleAdd(sectionId, type, afterIndex)}
        />
        <span className="block-insert-line" aria-hidden />
      </div>
    );
  }

  // The add control under a group heading: the same insert seam used between
  // blocks, appending at the end of the group.
  function groupAddSeam(sectionId) {
    return (
      <div className="block-insert block-insert--group">
        <span className="block-insert-line" aria-hidden />
        <AddBlockMenu
          compact
          allowInteractive={allowInteractive}
          onAdd={type => handleAdd(sectionId, type)}
        />
        <span className="block-insert-line" aria-hidden />
      </div>
    );
  }

  // Rename and Delete used to sit on every section head as two always-visible
  // buttons — 48 red "Delete section" buttons on one workbook. They move into
  // ⋯, the same treatment the block rows already had. The title itself is still
  // the quick way to rename. Delete keeps its confirmation: the menu item only
  // asks, and the Yes/No appears in the head as before.
  function sectionActions(sec, kind, displayed, isEditingTitle, blockCount = 0) {
    const noun = kind === 'question' ? 'question' : kind === 'group' ? 'group heading' : 'section';
    if (confirmDelSection === sec.id) {
      return (
        <>
          <span className="confirm-text">
            {kind === 'question' ? 'Delete question & all its parts?'
              : kind === 'group' ? `Delete this group heading${blockCount ? ` and its ${blockCount} block${blockCount === 1 ? '' : 's'}` : ''}? The exercises after it stay.`
              : 'Delete section & all blocks?'}
          </span>
          <button className="danger" onClick={async () => { await onDeleteSection(sec.id); setConfirmDelSection(null); }}>Yes</button>
          <button className="ghost" onClick={() => setConfirmDelSection(null)}>No</button>
        </>
      );
    }
    if (isEditingTitle) return null;
    return (
      <KebabMenu
        label={`More actions for this ${noun}`}
        items={[
          { label: 'Rename', glyph: '✎', onClick: () => startEditingSection(sec, displayed) },
          { separator: true },
          { label: `Delete ${noun}`, glyph: '✕', danger: true, onClick: () => setConfirmDelSection(sec.id) },
        ]}
      />
    );
  }

  // `displayed` matters in question mode: an auto-numbered question's heading is
  // DERIVED from its position, not read from the stored title, so the two can
  // differ after a move. Seeding the rename box from the stored title would
  // then show "Question 2" on a question the screen calls "Question 5".
  function startEditingSection(sec, displayed = null) {
    setEditingSectionId(sec.id);
    setSectionTitleDraft(displayed ?? sec.title);
  }
  async function commitSectionTitle(sec) {
    if (sectionTitleDraft.trim() && sectionTitleDraft !== sec.title) {
      await onUpdateSectionTitle(sec.id, sectionTitleDraft.trim());
    }
    setEditingSectionId(null);
    setSectionTitleDraft('');
  }

  // The heat and prep markers (ScaffoldMarkers.jsx). Thin wrappers so each call
  // site stays one line; heat markers only exist where the page passes onOpenHeat.
  function heatChip(entry, onClick, extraClass = '') {
    if (!onOpenHeat) return null;
    return <HeatChip entry={entry} onClick={onClick} extraClass={extraClass} />;
  }
  function prepChip(sec) {
    return prepBySection?.get(sec.id) ? <PrepChip sectionId={sec.id} /> : null;
  }

  // Saving a question from its own form writes to TWO places, because the correct
  // answer cannot live in the block.
  //
  // `config` goes to assessment_blocks, which the participant reads. The answer
  // goes to assessment_answer_keys, which has no participant policy at all — that
  // absence is the only thing keeping answers away from candidates, so putting the
  // answer in config would hand every paper its own answer sheet. Marking the
  // correct option on the question is a UI choice; where it is stored is not.
  //
  // Order matters. Config first: if the key write fails, the wording is still
  // saved and the trainer can retry the answer. The reverse order could leave a
  // key pointing at an option that was never written.
  async function handleBlockSave(blockId, patch) {
    const { answerKey, ...rest } = patch || {};
    const wantsKey = onSaveAnswerKey && answerKey !== undefined;

    // A question added in this sitting has no database row yet, so there is no id
    // for a key to point at. Stage the answer on the draft block instead and let
    // Save write it once the insert has produced a real id — otherwise ticking the
    // correct option on a new question would either throw (a temp id is not a
    // uuid) or, worse, be quietly discarded.
    if (wantsKey && isDraftId(blockId)) {
      return onUpdateBlock(blockId, { ...rest, pending_key: answerKey });
    }

    const res = await onUpdateBlock(blockId, rest);
    if (wantsKey) {
      const keyRes = await onSaveAnswerKey(blockId, answerKey);
      if (keyRes?.error) return keyRes;
    }
    return res;
  }

  // afterIndex is null to append (the row at the foot of a section) or the
  // index of the block to insert after.
  // What each add-menu choice starts as lives in lib/newBlock.js.
  async function handleAdd(sectionId, type, afterIndex = null) {
    const { blockType, config } = newBlock(type);
    await onCreateBlock(sectionId, blockType, config, afterIndex);
  }

  return (
    <div className={`editor-layout ${showPreview ? 'with-preview' : ''}${outline && !questions ? ' with-outline' : ''}`}>
      {outline && !questions && (
        <WorkbookOutline
          sections={sections}
          blocks={blocks}
          focusId={focusSectionId}
          activeSectionId={activeSectionId}
          onPick={pickSection}
          prepBySection={prepBySection}
          heatBySection={heat?.bySection || null}
        />
      )}
      <div className="editor-pane">
        {questions ? (
          <>
            {qList.length === 0 && <p className="muted">No questions yet — add one below.</p>}
            {qList.map((q, qi) => {
              const sec = q.section;
              const isEditingTitle = editingSectionId === sec.id;
              return (
                <section
                  key={sec.id}
                  className="editor-section editor-question"
                  data-section-id={sec.id}
                  ref={el => { editorSectionRefs.current[sec.id] = el; }}
                >
                  <div className="editor-section-head">
                    {isEditingTitle ? (
                      <input
                        className="form-input"
                        autoFocus
                        value={sectionTitleDraft}
                        onChange={e => setSectionTitleDraft(e.target.value)}
                        onBlur={() => commitSectionTitle(sec)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEditingSectionId(null); setSectionTitleDraft(''); } }}
                      />
                    ) : (
                      <h2 className="editor-section-title" onClick={() => startEditingSection(sec, q.heading)}>
                        {q.heading}
                        {/* An author-written heading has taken over from the
                            automatic number — say so, or renumbering looks broken. */}
                        {!q.isAuto && <span className="editor-question-custom">custom number</span>}
                      </h2>
                    )}
                    {heatChip(
                      heat?.bySection?.get(sec.id),
                      () => onOpenHeat({ sectionId: sec.id, sectionTitle: q.heading, blockId: null }),
                      'heat-chip--section',
                    )}
                    {prepChip(sec)}
                    {renderQuestionWithdraw && (
                      <span className="question-withdraw-slot">
                        {renderQuestionWithdraw(q)}
                      </span>
                    )}
                    <span className="editor-question-parts">
                      {q.partCount === 0
                        ? 'no answerable part yet'
                        : `${q.partCount} part${q.partCount === 1 ? '' : 's'}`}
                    </span>
                    <div className="editor-section-actions">
                      {onMoveSection && (
                        <>
                          <button className="icon-btn" onClick={() => onMoveSection(sec.id, 'up')} disabled={qi === 0} aria-label="Move question up">↑</button>
                          <button className="icon-btn" onClick={() => onMoveSection(sec.id, 'down')} disabled={qi === qList.length - 1} aria-label="Move question down">↓</button>
                        </>
                      )}
                      {sectionActions(sec, 'question', q.heading, isEditingTitle)}
                    </div>
                  </div>
                  {/* Kind-specific extras that belong to the question itself
                      rather than to the paper — topics, on a bank. Optional, so
                      an assessment renders exactly as before. */}
                  {renderQuestionExtra && renderQuestionExtra(q)}
                  {q.blocks.length === 0 && (
                    <div className="block-empty">
                      <div className="block-empty-title">Nothing in this question yet</div>
                      <div className="block-empty-sub">
                        Most questions open with a scenario, then what it asks.
                      </div>
                      <div className="block-empty-actions">
                        <button className="addblock-chip" onClick={() => handleAdd(sec.id, 'prose')}>
                          <span className="addblock-glyph" aria-hidden>¶</span> Add the scenario
                        </button>
                        <button className="addblock-chip" onClick={() => handleAdd(sec.id, 'field')}>
                          <span className="addblock-glyph" aria-hidden>▭</span> Add a field
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="block-list">
                    {q.blocks.map((b, i) => {
                      const bHeat = heat?.byBlock?.get(b.id);
                      return (
                      <Fragment key={b.id}>
                      <div
                        data-block-id={b.id}
                        ref={el => { editorBlockRefs.current[b.id] = el; }}
                        className={bHeat?.openSessions ? `heat-wrap heat-l${heatLevel(bHeat.openSessions)}` : undefined}
                      >
                        <BlockListItem
                          headExtra={heatChip(
                            bHeat,
                            () => onOpenHeat({
                              sectionId: sec.id,
                              sectionTitle: q.heading,
                              blockId: b.id,
                              blockLabel: partLabelByBlockId[b.id] || `Question ${q.number}`,
                            }),
                          )}
                          block={b}
                          answerKey={answerKeys ? answerKeys[b.id] : undefined}
                          canSetAnswer={!!onSaveAnswerKey && answerKeysLoaded}
                          partLabel={partLabelByBlockId[b.id] ?? null}
                          inactive={isInactiveBlock(b)}
                          isFirst={i === 0}
                          isLast={i === q.blocks.length - 1}
                          onSave={(blockId, patch) => handleBlockSave(blockId, patch)}
                          onDelete={(blockId) => onDeleteBlock(blockId)}
                          onDuplicate={(blockId) => onDuplicateBlock(blockId)}
                          onMoveUp={() => onMoveBlock(b.id, 'up')}
                          onMoveDown={() => onMoveBlock(b.id, 'down')}
                          onMoveTo={onMoveBlockTo}
                          onLocate={locateBlockInPreview}
                        />
                      </div>
                      {i < q.blocks.length - 1 && insertPoint(sec.id, i)}
                      </Fragment>
                      );
                    })}
                  </div>
                  {addBlockRow(sec.id)}
                </section>
              );
            })}
            <div className="add-section-row">
              <button className="primary" onClick={() => onCreateSection(`Question ${qList.length + 1}`)}>
                <span className="btn-glyph" aria-hidden>+</span> Add question
              </button>
              {extraAddSectionActions}
            </div>
          </>
        ) : (
        <>
        {pagerFor()}
        {visibleSections.map(sec => {
          const sectionBlocks = blocks
            .filter(b => b.section_id === sec.id)
            .sort((a, b) => a.order_index - b.order_index);
          const isEditingTitle = editingSectionId === sec.id;
          const isGroup = sec.kind === 'group';
          return (
            <section
              key={sec.id}
              className={`editor-section${isGroup ? ' editor-section-group' : ''}`}
              data-section-id={sec.id}
              ref={el => { editorSectionRefs.current[sec.id] = el; }}
            >
              <div className="editor-section-head">
                {isEditingTitle ? (
                  <input
                    className="form-input"
                    autoFocus
                    value={sectionTitleDraft}
                    onChange={e => setSectionTitleDraft(e.target.value)}
                    onBlur={() => commitSectionTitle(sec)}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEditingSectionId(null); setSectionTitleDraft(''); } }}
                  />
                ) : (
                  <h2 className="editor-section-title" onClick={() => startEditingSection(sec)} title="Click to rename">
                    {isGroup && <span className="editor-section-group-badge" aria-label="Group heading">§</span>}
                    {sec.title}
                  </h2>
                )}
                {heatChip(
                  heat?.bySection?.get(sec.id),
                  () => onOpenHeat({ sectionId: sec.id, sectionTitle: sec.title, blockId: null }),
                  'heat-chip--section',
                )}
                {!isGroup && prepChip(sec)}
                {!isGroup && !isEditingTitle && (
                  <span className="editor-section-count">
                    {sectionBlocks.length} block{sectionBlocks.length === 1 ? '' : 's'}
                  </span>
                )}
                <div className="editor-section-actions">
                  {sectionActions(sec, isGroup ? 'group' : 'section', null, isEditingTitle, sectionBlocks.length)}
                </div>
              </div>
              {/* A group heading is a divider in the book, not an exercise, and
                  16 of the 17 in a real workbook hold nothing — so it gets no
                  "Nothing in this section yet" card telling the author to fill
                  it. It can still carry a block (one does), so the add control
                  stays, as a quiet seam rather than a row of buttons. */}
              {!isGroup && sectionBlocks.length === 0 && (
                <div className="block-empty">
                  <div className="block-empty-title">Nothing in this section yet</div>
                  <div className="block-empty-sub">
                    Start with the wording, then add what the participant fills in.
                  </div>
                  <div className="block-empty-actions">
                    <button className="addblock-chip" onClick={() => handleAdd(sec.id, 'prose')}>
                      <span className="addblock-glyph" aria-hidden>¶</span> Add prose
                    </button>
                    <button className="addblock-chip" onClick={() => handleAdd(sec.id, 'field')}>
                      <span className="addblock-glyph" aria-hidden>▭</span> Add a field
                    </button>
                  </div>
                </div>
              )}
              <div className="block-list">
                {sectionBlocks.map((b, i) => {
                  const bHeat = heat?.byBlock?.get(b.id);
                  return (
                  <Fragment key={b.id}>
                  <div
                    data-block-id={b.id}
                    ref={el => { editorBlockRefs.current[b.id] = el; }}
                    className={bHeat?.openSessions ? `heat-wrap heat-l${heatLevel(bHeat.openSessions)}` : undefined}
                  >
                    <BlockListItem
                      headExtra={heatChip(
                        bHeat,
                        () => onOpenHeat({
                          sectionId: sec.id,
                          sectionTitle: sec.title,
                          blockId: b.id,
                          blockLabel: `Block ${i + 1}`,
                        }),
                      )}
                      block={b}
                      answerKey={answerKeys ? answerKeys[b.id] : undefined}
                      canSetAnswer={!!onSaveAnswerKey && answerKeysLoaded}
                      isFirst={i === 0}
                      isLast={i === sectionBlocks.length - 1}
                      onSave={(blockId, patch) => handleBlockSave(blockId, patch)}
                      onDelete={(blockId) => onDeleteBlock(blockId)}
                      onDuplicate={(blockId) => onDuplicateBlock(blockId)}
                      onMoveUp={() => onMoveBlock(b.id, 'up')}
                      onMoveDown={() => onMoveBlock(b.id, 'down')}
                      onMoveTo={onMoveBlockTo}
                      onLocate={locateBlockInPreview}
                    />
                  </div>
                  {i < sectionBlocks.length - 1 && insertPoint(sec.id, i)}
                  </Fragment>
                  );
                })}
              </div>
              {isGroup ? groupAddSeam(sec.id) : addBlockRow(sec.id)}
            </section>
          );
        })}

        <div className="add-section-row">
          <button className="primary" onClick={() => onCreateSection('New section')}>
            <span className="btn-glyph" aria-hidden>+</span> Add section
          </button>
          {extraAddSectionActions}
        </div>
        </>
        )}
      </div>

      {showPreview && (
        <ScaffoldPreview
          paneRef={previewPaneRef}
          sectionRefs={previewSectionRefs}
          blockRefs={previewBlockRefs}
          title={previewTitle}
          questions={questions}
          qList={qList}
          partLabelByBlockId={partLabelByBlockId}
          sections={sections}
          visibleSections={visibleSections}
          blocks={blocks}
          activeSectionId={activeSectionId}
          focusMode={focusMode}
          selectedBlockId={selectedBlockId}
          pulseBlockId={pulseBlockId}
        />
      )}
    </div>
  );
}

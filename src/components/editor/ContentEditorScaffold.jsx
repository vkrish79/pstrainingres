import { useEffect, useRef, useState } from 'react';
import BlockListItem from './BlockListItem.jsx';
import Block from '../blocks/Block.jsx';
import { parseFillBlank, newItemId } from '../../lib/interactiveBlocks.js';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { isInactiveBlock } from '../../lib/assessmentScoring.js';
import { heatLevel } from '../../lib/configDiff.js';

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
  onUpdateBlock,
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
  }, [blocks, showPreview]);

  // When natural-scroll changes the active block, mirror in the preview pane.
  // 'auto' (instant) keeps tracking glued to scroll; deliberate clicks use
  // smooth via locateBlockInPreview.
  useEffect(() => {
    if (!activeBlockId) return;
    if (Date.now() < suppressSyncUntilRef.current) return;
    scrollPreviewTo(activeBlockId, { smooth: false });
  }, [activeBlockId]);

  const activeSectionId = activeBlockId
    ? blocks.find(b => b.id === activeBlockId)?.section_id || null
    : null;

  // Question mode: sections in order, each with its narration and its parts.
  const { questions: qList, partLabelByBlockId } = questions
    ? buildQuestions(sections, blocks)
    : { questions: [], partLabelByBlockId: {} };

  // The add-question button row (prose/field/table + optional interactive).
  function addBlockRow(sectionId) {
    return (
      <div className="add-block-row">
        <button className="ghost" onClick={() => handleAdd(sectionId, 'prose')}>+ Add prose</button>
        <button className="ghost" onClick={() => handleAdd(sectionId, 'field')}>+ Add field</button>
        <button className="ghost" onClick={() => handleAdd(sectionId, 'table')}>+ Add table</button>
        {allowInteractive && (
          <>
            <span className="add-block-divider" aria-hidden />
            <button className="ghost" onClick={() => handleAdd(sectionId, 'fill_blank')}>+ Fill-in-the-blank</button>
            <button className="ghost" onClick={() => handleAdd(sectionId, 'card_sort')}>+ Card sort</button>
            <button className="ghost" onClick={() => handleAdd(sectionId, 'match_pairs')}>+ Match pairs</button>
            <button className="ghost" onClick={() => handleAdd(sectionId, 'reorder')}>+ Reorder</button>
          </>
        )}
      </div>
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

  // A heat marker. Intensity comes from DISTINCT SESSIONS still awaiting a
  // decision, not the raw edit count — one trainer fiddling with a paragraph is
  // noise; five cohorts independently rewording the same line is the signal.
  //
  // Once everything is resolved the marker goes quiet but does NOT disappear:
  // it becomes a tick that still opens the history. Removing it entirely would
  // make the record unreachable the moment you finished reviewing it.
  function heatChip(entry, onClick, extraClass = '') {
    if (!onOpenHeat || !entry) return null;
    const openCount = entry.openSessions || 0;
    const total = entry.totalSessions || 0;
    if (!openCount && !total) return null;

    const cls = extraClass ? ` ${extraClass}` : '';
    if (!openCount) {
      return (
        <button
          type="button"
          className={`heat-chip heat-chip--done${cls}`}
          onClick={onClick}
          aria-label={`Reviewed — show the ${total} recorded session change${total === 1 ? '' : 's'}`}
        >
          ✓
        </button>
      );
    }

    const label =
      `${openCount} session${openCount === 1 ? '' : 's'} reworded this`
      + ` (${entry.openTrainers} trainer${entry.openTrainers === 1 ? '' : 's'}) — review the changes`;
    return (
      <button
        type="button"
        className={`heat-chip heat-l${heatLevel(openCount)}${cls}`}
        onClick={onClick}
        aria-label={label}
      >
        <span className="heat-dot" aria-hidden />
        {openCount}
      </button>
    );
  }

  async function handleAdd(sectionId, type) {
    let defaultConfig;
    if (type === 'prose') defaultConfig = { html: '<p>New prose block</p>' };
    else if (type === 'field') defaultConfig = { label: 'New field', input_type: 'short_text' };
    else if (type === 'table') defaultConfig = {
      headers: ['Column 1', 'Column 2'],
      rows: [
        [{ kind: 'static', text: 'Row label' }, { kind: 'input', id: `c_${Date.now()}_1`, input_type: 'short_text' }],
      ],
    };
    else if (type === 'fill_blank') {
      const text = 'Type your sentence here with a {{}} to fill in.';
      const { parts, blanks } = parseFillBlank(text);
      defaultConfig = { text, parts, blanks };
    }
    else if (type === 'card_sort') defaultConfig = {
      prompt: 'Sort each card into the right category',
      cards: [{ id: newItemId('card'), text: 'Card 1' }, { id: newItemId('card'), text: 'Card 2' }],
      buckets: [{ id: newItemId('bkt'), label: 'Category A' }, { id: newItemId('bkt'), label: 'Category B' }],
    };
    else if (type === 'match_pairs') defaultConfig = {
      prompt: 'Match each item on the left to the right',
      left: [{ id: newItemId('l'), text: 'Term 1' }, { id: newItemId('l'), text: 'Term 2' }],
      right: [{ id: newItemId('r'), text: 'Match 1' }, { id: newItemId('r'), text: 'Match 2' }],
    };
    else if (type === 'reorder') defaultConfig = {
      prompt: 'Put these in the correct order',
      items: [{ id: newItemId(), text: 'First' }, { id: newItemId(), text: 'Second' }, { id: newItemId(), text: 'Third' }],
    };
    await onCreateBlock(sectionId, type, defaultConfig);
  }

  return (
    <div className={`editor-layout ${showPreview ? 'with-preview' : ''}`}>
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
                      {!isEditingTitle && (
                        <button className="ghost" onClick={() => startEditingSection(sec, q.heading)}>Rename</button>
                      )}
                      {confirmDelSection === sec.id ? (
                        <>
                          <span className="confirm-text">Delete question &amp; all its parts?</span>
                          <button className="danger" onClick={async () => { await onDeleteSection(sec.id); setConfirmDelSection(null); }}>Yes</button>
                          <button className="ghost" onClick={() => setConfirmDelSection(null)}>No</button>
                        </>
                      ) : (
                        <button className="ghost danger" onClick={() => setConfirmDelSection(sec.id)}>Delete question</button>
                      )}
                    </div>
                  </div>
                  {q.blocks.length === 0 && <p className="muted">Empty — add narration or a part below.</p>}
                  <div className="block-list">
                    {q.blocks.map((b, i) => {
                      const bHeat = heat?.byBlock?.get(b.id);
                      return (
                      <div
                        key={b.id}
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
                          partLabel={partLabelByBlockId[b.id] ?? null}
                          inactive={isInactiveBlock(b)}
                          isFirst={i === 0}
                          isLast={i === q.blocks.length - 1}
                          onSave={(blockId, patch) => onUpdateBlock(blockId, patch)}
                          onDelete={(blockId) => onDeleteBlock(blockId)}
                          onDuplicate={(blockId) => onDuplicateBlock(blockId)}
                          onMoveUp={() => onMoveBlock(b.id, 'up')}
                          onMoveDown={() => onMoveBlock(b.id, 'down')}
                          onLocate={locateBlockInPreview}
                        />
                      </div>
                      );
                    })}
                  </div>
                  {addBlockRow(sec.id)}
                </section>
              );
            })}
            <div className="add-section-row">
              <button className="ghost" onClick={() => onCreateSection(`Question ${qList.length + 1}`)}>
                ➕ Add question
              </button>
              {extraAddSectionActions}
            </div>
          </>
        ) : (
        <>
        {sections.map(sec => {
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
                    {isGroup && <span className="editor-section-group-badge">§ Section</span>}
                    {sec.title}
                  </h2>
                )}
                {heatChip(
                  heat?.bySection?.get(sec.id),
                  () => onOpenHeat({ sectionId: sec.id, sectionTitle: sec.title, blockId: null }),
                  'heat-chip--section',
                )}
                <div className="editor-section-actions">
                  {!isEditingTitle && (
                    <button className="ghost" onClick={() => startEditingSection(sec)}>Rename</button>
                  )}
                  {confirmDelSection === sec.id ? (
                    <>
                      <span className="confirm-text">Delete section &amp; all blocks?</span>
                      <button className="danger" onClick={async () => { await onDeleteSection(sec.id); setConfirmDelSection(null); }}>Yes</button>
                      <button className="ghost" onClick={() => setConfirmDelSection(null)}>No</button>
                    </>
                  ) : (
                    <button className="ghost danger" onClick={() => setConfirmDelSection(sec.id)}>Delete section</button>
                  )}
                </div>
              </div>
              {sectionBlocks.length === 0 && <p className="muted">No blocks yet.</p>}
              <div className="block-list">
                {sectionBlocks.map((b, i) => {
                  const bHeat = heat?.byBlock?.get(b.id);
                  return (
                  <div
                    key={b.id}
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
                      isFirst={i === 0}
                      isLast={i === sectionBlocks.length - 1}
                      onSave={(blockId, patch) => onUpdateBlock(blockId, patch)}
                      onDelete={(blockId) => onDeleteBlock(blockId)}
                      onDuplicate={(blockId) => onDuplicateBlock(blockId)}
                      onMoveUp={() => onMoveBlock(b.id, 'up')}
                      onMoveDown={() => onMoveBlock(b.id, 'down')}
                      onLocate={locateBlockInPreview}
                    />
                  </div>
                  );
                })}
              </div>
              <div className="add-block-row">
                <button className="ghost" onClick={() => handleAdd(sec.id, 'prose')}>+ Add prose</button>
                <button className="ghost" onClick={() => handleAdd(sec.id, 'field')}>+ Add field</button>
                <button className="ghost" onClick={() => handleAdd(sec.id, 'table')}>+ Add table</button>
                {allowInteractive && (
                  <>
                    <span className="add-block-divider" aria-hidden />
                    <button className="ghost" onClick={() => handleAdd(sec.id, 'fill_blank')}>+ Fill-in-the-blank</button>
                    <button className="ghost" onClick={() => handleAdd(sec.id, 'card_sort')}>+ Card sort</button>
                    <button className="ghost" onClick={() => handleAdd(sec.id, 'match_pairs')}>+ Match pairs</button>
                    <button className="ghost" onClick={() => handleAdd(sec.id, 'reorder')}>+ Reorder</button>
                  </>
                )}
              </div>
            </section>
          );
        })}

        <div className="add-section-row">
          <button className="ghost" onClick={() => onCreateSection('New section')}>+ Add section</button>
          {extraAddSectionActions}
        </div>
        </>
        )}
      </div>

      {showPreview && (
        <aside className="preview-pane" ref={previewPaneRef}>
          <div className="preview-pane-head">
            Participant preview
            <span className="preview-pane-hint">read-only</span>
          </div>
          <div className="preview-pane-body">
            <h1 className="preview-workbook-title">{previewTitle || 'Untitled'}</h1>
            {questions ? (
              qList.map(q => (
                <section
                  key={q.section.id}
                  className={`wb-section wb-question ${activeSectionId === q.section.id ? 'active' : ''}`}
                  ref={el => { previewSectionRefs.current[q.section.id] = el; }}
                >
                  <div className="question-number">{q.heading}</div>
                  {q.blocks.map(b => (
                    <div
                      key={b.id}
                      className={`preview-block-wrap ${selectedBlockId === b.id ? 'selected' : ''} ${pulseBlockId === b.id ? 'pulse' : ''}`}
                      ref={el => { previewBlockRefs.current[b.id] = el; }}
                    >
                      {partLabelByBlockId[b.id] && (
                        <div className="wb-part-label">{partLabelByBlockId[b.id]}</div>
                      )}
                      <Block block={b} value={undefined} onChange={() => {}} />
                    </div>
                  ))}
                </section>
              ))
            ) : (
            <>
            {sections.length === 0 && <p className="muted">No sections yet.</p>}
            {sections.map(sec => {
              const secBlocks = blocks
                .filter(b => b.section_id === sec.id)
                .sort((a, b) => a.order_index - b.order_index);
              const isGroup = sec.kind === 'group';
              return (
                <section
                  key={sec.id}
                  className={`wb-section ${isGroup ? 'wb-section-group ' : ''}${activeSectionId === sec.id ? 'active' : ''}`}
                  ref={el => { previewSectionRefs.current[sec.id] = el; }}
                >
                  {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
                  {secBlocks.map(b => (
                    <div
                      key={b.id}
                      className={`preview-block-wrap ${selectedBlockId === b.id ? 'selected' : ''} ${pulseBlockId === b.id ? 'pulse' : ''}`}
                      ref={el => { previewBlockRefs.current[b.id] = el; }}
                    >
                      <Block block={b} value={undefined} onChange={() => {}} />
                    </div>
                  ))}
                </section>
              );
            })}
            </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

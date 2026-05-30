import { useEffect, useRef, useState } from 'react';
import BlockListItem from './BlockListItem.jsx';
import Block from '../blocks/Block.jsx';

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
  showPreview,
  previewTitle,
  extraAddSectionActions = null,
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

  function startEditingSection(sec) {
    setEditingSectionId(sec.id);
    setSectionTitleDraft(sec.title);
  }
  async function commitSectionTitle(sec) {
    if (sectionTitleDraft.trim() && sectionTitleDraft !== sec.title) {
      await onUpdateSectionTitle(sec.id, sectionTitleDraft.trim());
    }
    setEditingSectionId(null);
    setSectionTitleDraft('');
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
    await onCreateBlock(sectionId, type, defaultConfig);
  }

  return (
    <div className={`editor-layout ${showPreview ? 'with-preview' : ''}`}>
      <div className="editor-pane">
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
                {sectionBlocks.map((b, i) => (
                  <div
                    key={b.id}
                    data-block-id={b.id}
                    ref={el => { editorBlockRefs.current[b.id] = el; }}
                  >
                    <BlockListItem
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
                ))}
              </div>
              <div className="add-block-row">
                <button className="ghost" onClick={() => handleAdd(sec.id, 'prose')}>+ Add prose</button>
                <button className="ghost" onClick={() => handleAdd(sec.id, 'field')}>+ Add field</button>
                <button className="ghost" onClick={() => handleAdd(sec.id, 'table')}>+ Add table</button>
              </div>
            </section>
          );
        })}

        <div className="add-section-row">
          <button className="ghost" onClick={() => onCreateSection('New section')}>+ Add section</button>
          {extraAddSectionActions}
        </div>
      </div>

      {showPreview && (
        <aside className="preview-pane" ref={previewPaneRef}>
          <div className="preview-pane-head">
            Participant preview
            <span className="preview-pane-hint">read-only</span>
          </div>
          <div className="preview-pane-body">
            <h1 className="preview-workbook-title">{previewTitle || 'Untitled'}</h1>
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
          </div>
        </aside>
      )}
    </div>
  );
}

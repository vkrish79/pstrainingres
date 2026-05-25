import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useWorkbookEditor } from '../hooks/useWorkbookEditor.js';
import { renumberExercises } from '../lib/exerciseNumbering.js';
import BlockListItem from '../components/editor/BlockListItem.jsx';
import WorkbookPrepPanel from '../components/editor/WorkbookPrepPanel.jsx';
import AddExercisesModal from '../components/editor/AddExercisesModal.jsx';
import Block from '../components/blocks/Block.jsx';
import TopBar from '../components/TopBar.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import '../styles/editor.css';
import '../styles/workbook.css';
import '../styles/dashboard.css';

export default function WorkbookEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const {
    loading, error, workbook, sections, blocks,
    updateWorkbookTitle, createBlock, updateBlock, deleteBlock, moveBlock,
    duplicateBlock, createSection, updateSectionTitle, deleteSection,
    deleteWorkbook, reload,
  } = useWorkbookEditor(id);

  const [titleDraft, setTitleDraft] = useState('');
  const [readOnlySectionId, setReadOnlySectionId] = useState('__all__');
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');
  const [confirmDelSection, setConfirmDelSection] = useState(null);
  const [confirmDelWorkbook, setConfirmDelWorkbook] = useState(false);
  const [refByOnDelete, setRefByOnDelete] = useState([]); // composed workbooks drawing this pool
  const [delErr, setDelErr] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [showAddExercises, setShowAddExercises] = useState(false);
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
          .sort((a, b) => a.top - b.top);          // topmost-in-band wins
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

  if (loading) return <><TopBar /><div className="loading">Loading workbook…</div></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  const title = titleDraft !== '' ? titleDraft : (workbook?.title || '');

  async function commitTitle() {
    if (titleDraft && titleDraft !== workbook.title) {
      await updateWorkbookTitle(titleDraft);
    }
    setTitleDraft('');
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
    await createBlock(sectionId, type, defaultConfig);
  }

  function startEditingSection(sec) {
    setEditingSectionId(sec.id);
    setSectionTitleDraft(sec.title);
  }
  async function commitSectionTitle(sec) {
    if (sectionTitleDraft.trim() && sectionTitleDraft !== sec.title) {
      await updateSectionTitle(sec.id, sectionTitleDraft.trim());
    }
    setEditingSectionId(null);
    setSectionTitleDraft('');
  }

  async function handleDeleteWorkbook() {
    setDelErr('');
    const { error: e } = await deleteWorkbook();
    if (e) { setDelErr(e.message); return; }
    navigate('/trainer');
  }

  const isTemplate = workbook?.is_template === true;
  // Templates are shared across sessions, so only super-tier may restructure
  // them. Session clones (is_template=false) stay editable for any trainer
  // who can reach the session.
  const canEdit = !isTemplate || isSuperTrainerOrAbove(profile?.role);

  if (!canEdit) {
    const ALL = '__all__';
    const visibleSections = readOnlySectionId === ALL
      ? sections
      : sections.filter(s => s.id === readOnlySectionId);
    return (
      <>
        <TopBar />
        <main className="page workbook">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <Link to="/trainer" className="back-link">&larr; Back</Link>
              <h1>{title || 'Untitled workbook'}</h1>
            </div>
          </section>

          <div className="exresp-layout">
            <div className="exresp-mobile-nav">
              <select
                className="form-input"
                value={readOnlySectionId}
                onChange={e => setReadOnlySectionId(e.target.value)}
              >
                <option value={ALL}>All exercises</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>

            <aside className="exresp-sidebar">
              <div className="exresp-sidebar-head">Exercises</div>
              <ul className="exresp-sidebar-list">
                <li>
                  <button
                    className={`exresp-sidebar-item ${readOnlySectionId === ALL ? 'active' : ''}`}
                    onClick={() => setReadOnlySectionId(ALL)}
                  >
                    <div className="exresp-sidebar-row">
                      <span className="exresp-sidebar-title">All exercises</span>
                    </div>
                  </button>
                </li>
                {sections.map(s => (
                  <li key={s.id}>
                    <button
                      className={`exresp-sidebar-item ${readOnlySectionId === s.id ? 'active' : ''}`}
                      onClick={() => setReadOnlySectionId(s.id)}
                    >
                      <div className="exresp-sidebar-row">
                        <span className="exresp-sidebar-title">{s.title}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="exresp-main">
              {visibleSections.length === 0 && <p className="muted">No sections yet.</p>}
              {visibleSections.map(sec => {
                const secBlocks = blocks
                  .filter(b => b.section_id === sec.id)
                  .sort((a, b) => a.order_index - b.order_index);
                return (
                  <section key={sec.id} className="wb-section">
                    <h2>{sec.title}</h2>
                    {secBlocks.map(b => (
                      <Block key={b.id} block={b} value={undefined} onChange={() => {}} />
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className={`page editor ${showPreview ? 'with-preview' : ''}`}>
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Workbook editor</h1>
            <p>Edits broadcast live to enrolled participants. Their answers stay attached to stable block IDs, so renames and reorders don't lose data.</p>
          </div>
          <div className="page-hero-actions">
            <button className="ghost" onClick={() => setShowPreview(p => !p)}>
              {showPreview ? '◧ Hide preview' : '◨ Show preview'}
            </button>
            {isTemplate && (
              confirmDelWorkbook ? (
                <>
                  <span className="confirm-text">
                    Delete workbook &amp; all sections/blocks?
                    {refByOnDelete.length > 0 && (
                      <> ⚠ Prep for <strong>{refByOnDelete.join(', ')}</strong> draws from this workbook — they’ll lose it.</>
                    )}
                  </span>
                  <button className="danger" onClick={handleDeleteWorkbook}>Yes</button>
                  <button className="ghost" onClick={() => { setConfirmDelWorkbook(false); setDelErr(''); }}>No</button>
                </>
              ) : (
                <button
                  className="ghost danger"
                  onClick={async () => {
                    setConfirmDelWorkbook(true);
                    const { data: allWbs } = await supabase
                      .from('workbooks').select('id, title, prep_template').eq('is_template', true);
                    setRefByOnDelete((allWbs || [])
                      .filter(w => w.id !== id && Array.isArray(w.prep_template)
                        && w.prep_template.some(e => e?.source_workbook_id === id))
                      .map(w => w.title));
                  }}
                >Delete workbook</button>
              )
            )}
          </div>
        </section>
        {delErr && <p className="error">{delErr}</p>}

        <section className="editor-card">
          <label className="form-label">Workbook title</label>
          <input
            className="form-input large"
            value={title}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
          />
        </section>

        {isTemplate && <WorkbookPrepPanel workbook={workbook} sections={sections} profile={profile} />}

        <div className={`editor-layout ${showPreview ? 'with-preview' : ''}`}>
          <div className="editor-pane">
        {sections.map(sec => {
          const sectionBlocks = blocks
            .filter(b => b.section_id === sec.id)
            .sort((a, b) => a.order_index - b.order_index);
          const isEditingTitle = editingSectionId === sec.id;
          return (
            <section
              key={sec.id}
              className="editor-section"
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
                      <button className="danger" onClick={async () => { await deleteSection(sec.id); setConfirmDelSection(null); }}>Yes</button>
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
                      onSave={(blockId, patch) => updateBlock(blockId, patch)}
                      onDelete={(blockId) => deleteBlock(blockId)}
                      onDuplicate={(blockId) => duplicateBlock(blockId)}
                      onMoveUp={() => moveBlock(b.id, 'up')}
                      onMoveDown={() => moveBlock(b.id, 'down')}
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
          <button className="ghost" onClick={() => createSection('New section')}>+ Add section</button>
          <button className="ghost" onClick={() => setShowAddExercises(true)}>➕ Add exercises from another workbook</button>
          <button className="ghost" onClick={async () => { await renumberExercises(id); await reload(); }}>🔢 Renumber exercises</button>
        </div>
          </div>

          {showPreview && (
            <aside className="preview-pane" ref={previewPaneRef}>
              <div className="preview-pane-head">
                Participant preview
                <span className="preview-pane-hint">read-only</span>
              </div>
              <div className="preview-pane-body">
                <h1 className="preview-workbook-title">{title || 'Untitled workbook'}</h1>
                {sections.length === 0 && <p className="muted">No sections yet.</p>}
                {sections.map(sec => {
                  const secBlocks = blocks
                    .filter(b => b.section_id === sec.id)
                    .sort((a, b) => a.order_index - b.order_index);
                  return (
                    <section
                      key={sec.id}
                      className={`wb-section ${activeSectionId === sec.id ? 'active' : ''}`}
                      ref={el => { previewSectionRefs.current[sec.id] = el; }}
                    >
                      <h2>{sec.title}</h2>
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
      </main>
      {showAddExercises && (
        <AddExercisesModal
          currentWorkbookId={id}
          onClose={() => setShowAddExercises(false)}
          onAdded={reload}
        />
      )}
    </>
  );
}

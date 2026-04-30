import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useWorkbookEditor } from '../hooks/useWorkbookEditor.js';
import BlockListItem from '../components/editor/BlockListItem.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/editor.css';

export default function WorkbookEditorPage() {
  const { id } = useParams();
  const {
    loading, error, workbook, sections, blocks,
    updateWorkbookTitle, createBlock, updateBlock, deleteBlock, moveBlock,
    duplicateBlock, createSection, updateSectionTitle, deleteSection,
  } = useWorkbookEditor(id);

  const [titleDraft, setTitleDraft] = useState('');
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');
  const [confirmDelSection, setConfirmDelSection] = useState(null);

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

  return (
    <>
      <TopBar />
      <main className="page editor">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Workbook editor</h1>
            <p>Edits broadcast live to enrolled participants. Their answers stay attached to stable block IDs, so renames and reorders don't lose data.</p>
          </div>
        </section>

        <section className="editor-card">
          <label className="form-label">Workbook title</label>
          <input
            className="form-input large"
            value={title}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
          />
        </section>

        {sections.map(sec => {
          const sectionBlocks = blocks
            .filter(b => b.section_id === sec.id)
            .sort((a, b) => a.order_index - b.order_index);
          const isEditingTitle = editingSectionId === sec.id;
          return (
            <section key={sec.id} className="editor-section">
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
                  <BlockListItem
                    key={b.id}
                    block={b}
                    isFirst={i === 0}
                    isLast={i === sectionBlocks.length - 1}
                    onSave={(blockId, patch) => updateBlock(blockId, patch)}
                    onDelete={(blockId) => deleteBlock(blockId)}
                    onDuplicate={(blockId) => duplicateBlock(blockId)}
                    onMoveUp={() => moveBlock(b.id, 'up')}
                    onMoveDown={() => moveBlock(b.id, 'down')}
                  />
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
        </div>
      </main>
    </>
  );
}

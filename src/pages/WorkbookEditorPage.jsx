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
  } = useWorkbookEditor(id);

  const [titleDraft, setTitleDraft] = useState('');

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
    const defaultConfig = type === 'prose'
      ? { html: '<p>New prose block</p>' }
      : { label: 'New field', input_type: 'short_text' };
    await createBlock(sectionId, type, defaultConfig);
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
          return (
            <section key={sec.id} className="editor-section">
              <h2 className="editor-section-title">{sec.title}</h2>
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
                    onMoveUp={() => moveBlock(b.id, 'up')}
                    onMoveDown={() => moveBlock(b.id, 'down')}
                  />
                ))}
              </div>
              <div className="add-block-row">
                <button className="ghost" onClick={() => handleAdd(sec.id, 'prose')}>+ Add prose</button>
                <button className="ghost" onClick={() => handleAdd(sec.id, 'field')}>+ Add field</button>
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

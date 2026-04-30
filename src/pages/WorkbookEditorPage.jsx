import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbookEditor } from '../hooks/useWorkbookEditor.js';
import BlockListItem from '../components/editor/BlockListItem.jsx';
import '../styles/editor.css';

export default function WorkbookEditorPage() {
  const { id } = useParams();
  const { profile, signOut } = useAuth();
  const {
    loading, error, workbook, sections, blocks,
    updateWorkbookTitle, createBlock, updateBlock, deleteBlock, moveBlock,
  } = useWorkbookEditor(id);

  const [titleDraft, setTitleDraft] = useState('');

  if (loading) return <div className="loading">Loading workbook…</div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

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
    <div className="page editor">
      <header className="page-header">
        <div>
          <Link to="/trainer" className="back-link">&larr; Back</Link>
          <h1>Workbook editor</h1>
          <p className="muted">Live edits broadcast to enrolled participants.</p>
        </div>
        <div>
          <span>{profile?.full_name}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

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
    </div>
  );
}

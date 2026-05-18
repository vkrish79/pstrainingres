import { useState } from 'react';
import BlockForm from './BlockForm.jsx';

export default function BlockListItem({ block, onSave, onDelete, onDuplicate, onMoveUp, onMoveDown, onLocate, isFirst, isLast, canEdit = true }) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  async function handleSave(patch) {
    await onSave(block.id, patch);
    setEditing(false);
  }

  return (
    <div className="block-row">
      <div className="block-row-head">
        <span
          className={`block-type-tag tag-${block.block_type}`}
          onClick={() => onLocate?.(block.id)}
          title="Scroll preview to this block"
          style={{ cursor: 'pointer' }}
        >
          {block.block_type}
        </span>
        <span
          className="block-preview"
          onClick={() => onLocate?.(block.id)}
          title="Scroll preview to this block"
          style={{ cursor: 'pointer' }}
        >
          {previewOf(block)}
        </span>
        {canEdit && (
          <div className="block-actions">
            <button className="icon-btn" onClick={onMoveUp} disabled={isFirst} aria-label="Move up">↑</button>
            <button className="icon-btn" onClick={onMoveDown} disabled={isLast} aria-label="Move down">↓</button>
            <button className="ghost" onClick={() => setEditing(e => !e)}>{editing ? 'Cancel' : 'Edit'}</button>
            {onDuplicate && (
              <button className="ghost" onClick={() => onDuplicate(block.id)} title="Duplicate this block">Duplicate</button>
            )}
            {confirmDel ? (
              <>
                <span className="confirm-text">Delete?</span>
                <button className="danger" onClick={() => onDelete(block.id)}>Yes</button>
                <button className="ghost" onClick={() => setConfirmDel(false)}>No</button>
              </>
            ) : (
              <button className="ghost danger" onClick={() => setConfirmDel(true)}>Delete</button>
            )}
          </div>
        )}
      </div>
      {canEdit && editing && (
        <BlockForm
          block={block}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function previewOf(block) {
  if (block.block_type === 'prose') {
    const html = block.config?.html || '';
    const text = html.replace(/<[^>]+>/g, '').trim();
    return text.length > 70 ? text.slice(0, 70) + '…' : (text || '(empty)');
  }
  if (block.block_type === 'field') return block.config?.label || '(no label)';
  if (block.block_type === 'table') return tableLabel(block);
  return '';
}

function tableLabel(block) {
  const cfg = block.config || {};
  const rowCount = (cfg.rows || []).length;
  if (cfg.caption?.trim()) return `${cfg.caption.trim()} · ${rowCount} rows`;

  // First non-empty static cell anywhere in the table — usually the
  // most identifying piece of text (a question, a row label, a section).
  for (const row of cfg.rows || []) {
    for (const cell of row || []) {
      if (cell?.kind === 'static' && cell.text?.trim()) {
        const t = cell.text.trim().replace(/\s+/g, ' ');
        const truncated = t.length > 60 ? t.slice(0, 60) + '…' : t;
        return `${truncated} · ${rowCount} rows`;
      }
    }
  }

  // Else the first non-empty header cell.
  for (const h of cfg.headers || []) {
    if (h?.trim()) return `${h.trim()} · ${rowCount} rows`;
  }

  return `Table · ${rowCount} rows`;
}

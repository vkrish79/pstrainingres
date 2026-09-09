import { useEffect, useRef, useState } from 'react';
import BlockForm from './BlockForm.jsx';
import { labelOf } from '../../lib/blockHelpers.js';

// partLabel is the assessment sub-question marker — "(b)" — shown verbatim.
// questionNumber is the older whole-question form, rendered as "Q3". A block
// gets one or the other, never both: inside a question the heading already
// carries the number, so only the letter is worth repeating.
export default function BlockListItem({ block, onSave, onDelete, onDuplicate, onMoveUp, onMoveDown, onMoveTo, onLocate, isFirst, isLast, canEdit = true, questionNumber = null, partLabel = null, headExtra = null, inactive = false, onToggleInactive = null }) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Escape and click-outside close the overflow menu. Escape hands focus back
  // to the trigger rather than dropping the user at the top of the document.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setConfirmDel(false);
        menuRef.current?.querySelector('.block-kebab')?.focus();
      }
    }
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
        setConfirmDel(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  async function handleSave(patch) {
    await onSave(block.id, patch);
    setEditing(false);
  }

  return (
    <div className={`block-row${inactive ? ' block-row-withdrawn' : ''}`}>
      <div className="block-row-head">
        {partLabel != null && <span className="block-qnum block-partlabel">{partLabel}</span>}
        {partLabel == null && questionNumber != null && <span className="block-qnum">Q{questionNumber}</span>}
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
        {/* Optional slot in the head row — used for the session-edit heat marker.
            Inside the flex flow rather than floated, so it cannot collide with
            the action buttons or be clipped. Null everywhere else. */}
        {headExtra}
        {inactive && (
          <span className="block-withdrawn" title="Participants do not see this question">
            withdrawn
          </span>
        )}
        {/* Edit stays; everything else moves into the overflow menu.
            A twelve-block question used to carry sixty always-visible controls,
            one in five of them destructive — so the eye had to skip five buttons
            per row to reach the content, and the red was spent so freely it
            stopped meaning anything.

            The row fades at rest and comes up on hover OR focus-within (see
            editor.css). Focus matters as much as hover: a hover-only control is
            invisible to the keyboard, and Edit and ⋯ stay legible at rest so
            the row is never a blank mystery on a touchscreen. */}
        {canEdit && (
          <div className="block-actions" ref={menuRef}>
            <button className="icon-btn" onClick={onMoveUp} disabled={isFirst} aria-label="Move up">↑</button>
            <button className="icon-btn" onClick={onMoveDown} disabled={isLast} aria-label="Move down">↓</button>
            <button className="ghost block-edit-btn" onClick={() => setEditing(e => !e)}>{editing ? 'Cancel' : 'Edit'}</button>

            <button
              type="button"
              className={`icon-btn block-kebab ${menuOpen ? 'is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
              onClick={() => { setMenuOpen(o => !o); setConfirmDel(false); }}
            >
              ⋯
            </button>

            {menuOpen && (
              <div className="block-menu" role="menu">
                {/* The two moves that cost a dozen ↑ clicks today. */}
                {onMoveTo && (
                  <>
                    <button type="button" className="block-menu-item" role="menuitem"
                      disabled={isFirst}
                      onClick={() => { setMenuOpen(false); onMoveTo(block.id, 'top'); }}>
                      <span className="block-menu-glyph" aria-hidden>⤒</span> Move to top
                    </button>
                    <button type="button" className="block-menu-item" role="menuitem"
                      disabled={isLast}
                      onClick={() => { setMenuOpen(false); onMoveTo(block.id, 'bottom'); }}>
                      <span className="block-menu-glyph" aria-hidden>⤓</span> Move to bottom
                    </button>
                    <div className="block-menu-sep" role="separator" />
                  </>
                )}

                {onDuplicate && (
                  <button type="button" className="block-menu-item" role="menuitem"
                    onClick={() => { setMenuOpen(false); onDuplicate(block.id); }}>
                    <span className="block-menu-glyph" aria-hidden>⧉</span> Duplicate
                  </button>
                )}

                {/* Withdrawing is not deleting: the question and every answer
                    given to it are kept, it simply leaves the paper and the
                    totals. */}
                {onToggleInactive && (
                  <button type="button" className="block-menu-item" role="menuitem"
                    onClick={() => { setMenuOpen(false); onToggleInactive(); }}
                    title={inactive
                      ? 'Put this question back into the paper'
                      : 'Take this question out of play — participants will not see it and it will not count'}>
                    <span className="block-menu-glyph" aria-hidden>{inactive ? '↺' : '⊘'}</span>
                    {inactive ? 'Restore to the paper' : 'Withdraw from the paper'}
                  </button>
                )}

                <div className="block-menu-sep" role="separator" />
                {confirmDel ? (
                  <div className="block-menu-confirm">
                    <span>Delete this block?</span>
                    <div>
                      <button className="danger" onClick={() => onDelete(block.id)}>Delete</button>
                      <button className="ghost" onClick={() => setConfirmDel(false)}>Keep</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="block-menu-item is-danger" role="menuitem"
                    onClick={() => setConfirmDel(true)}>
                    <span className="block-menu-glyph" aria-hidden>🗑</span> Delete
                  </button>
                )}
              </div>
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
  return labelOf(block);
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

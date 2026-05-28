import { useEffect, useRef, useState } from 'react';
import '../../styles/workbook.css';
import '../../styles/editor.css';

// Inline content-only editor for SESSION-level workbook edits (is_template=false).
// Renders the workbook like the participant view, but the *authored* text —
// prose, field labels, option wording, table captions/headers/static cells — is
// click-to-edit in place. Answer fields and all structure (rows, columns,
// blocks, sections) are locked. Saves go through onSaveBlock(blockId, { config }).
export default function ContentEditor({ sections, blocks, onSaveBlock }) {
  return (
    <div className="ce-doc">
      <p className="ce-hint">✎ Click any text to edit its wording. Answer boxes and the layout are locked — to change structure, edit the template.</p>
      {sections.map(sec => {
        const secBlocks = blocks
          .filter(b => b.section_id === sec.id)
          .sort((a, b) => a.order_index - b.order_index);
        const isGroup = sec.kind === 'group';
        return (
          <section key={sec.id} className={`wb-section ce-section${isGroup ? ' wb-section-group' : ''}`}>
            {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
            {secBlocks.length === 0 && !isGroup && <p className="muted">No content in this exercise.</p>}
            {secBlocks.map(b => (
              <div key={b.id} className="wb-block">
                <EditableBlock block={b} onSave={config => onSaveBlock(b.id, { config })} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// Per-block inline content editor. onSave receives the full new config object.
// Exported so the trainer copy (TrainerPracticeView) can drop it into its own
// layout behind an Edit toggle, sharing one editing UI with the editor page.
export function EditableBlock({ block, onSave }) {
  if (block.block_type === 'prose') return <ProseEdit block={block} onSave={onSave} />;
  if (block.block_type === 'field') return <FieldEdit block={block} onSave={onSave} />;
  if (block.block_type === 'table') return <TableEdit block={block} onSave={onSave} />;
  return null;
}

// Click-to-edit text. Single-line by default; multiline renders a textarea.
// Save is derived from the parent's current config (onSave receives the new
// string only), so there's no local-copy divergence. An optimistic display
// avoids the brief stale flash while the save round-trips and props refresh.
function EditableText({ value, onSave, multiline = false, placeholder = '(empty)', className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [optimistic, setOptimistic] = useState(null);
  const ref = useRef(null);

  const current = value ?? '';
  const shown = optimistic !== null ? optimistic : current;

  useEffect(() => {
    if (optimistic !== null && current === optimistic) setOptimistic(null);
  }, [current, optimistic]);

  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  function start() { setDraft(current); setEditing(true); }
  function commit() {
    setEditing(false);
    if (draft !== current) { setOptimistic(draft); onSave(draft); }
  }
  function cancel() { setEditing(false); }

  if (editing) {
    const common = {
      ref,
      className: `ce-input ${className}`,
      value: draft,
      onChange: e => setDraft(e.target.value),
      onBlur: commit,
    };
    return multiline ? (
      <textarea
        {...common}
        rows={Math.max(2, draft.split('\n').length)}
        onKeyDown={e => { if (e.key === 'Escape') cancel(); }}
      />
    ) : (
      <input
        {...common}
        type="text"
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') cancel();
        }}
      />
    );
  }

  return (
    <span
      className={`ce-editable ${shown === '' ? 'ce-empty' : ''} ${className}`}
      tabIndex={0}
      role="button"
      title="Click to edit"
      onClick={start}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } }}
    >
      {shown === '' ? placeholder : shown}
    </span>
  );
}

// Prose stores HTML, so "inline on the document" gives way to a click-to-reveal
// raw-HTML textarea (contentEditable round-trips mangle the markup). The same
// tags the editor hint documents apply.
function ProseEdit({ block, onSave }) {
  const html = block.config?.html || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function start() { setDraft(html); setEditing(true); }
  function commit() {
    setEditing(false);
    if (draft !== html) onSave({ ...block.config, html: draft });
  }

  if (editing) {
    return (
      <div className="ce-prose-edit">
        <textarea
          className="ce-input"
          autoFocus
          rows={Math.max(4, draft.split('\n').length + 1)}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }}
        />
        <p className="hint">Editing raw HTML — <code>&lt;p&gt;</code>, <code>&lt;strong&gt;</code>, <code>&lt;ul&gt;</code>/<code>&lt;li&gt;</code>. Esc to cancel.</p>
      </div>
    );
  }
  return (
    <div
      className="wb-prose ce-editable ce-prose"
      title="Click to edit"
      tabIndex={0}
      role="button"
      onClick={start}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); start(); } }}
      dangerouslySetInnerHTML={{ __html: html || '<p class="ce-empty">(empty — click to edit)</p>' }}
    />
  );
}

function FieldEdit({ block, onSave }) {
  const cfg = block.config || {};
  const { label, input_type, options } = cfg;
  const saveLabel = v => onSave({ ...cfg, label: v });
  const saveOpt = (i, v) => onSave({ ...cfg, options: (options || []).map((o, idx) => (idx === i ? v : o)) });

  // short_text / long_text — editable label + a locked answer placeholder.
  if (input_type === 'short_text' || input_type === 'long_text') {
    return (
      <div className="wb-field">
        <div className="wb-label"><EditableText value={label} onSave={saveLabel} placeholder="(label)" /></div>
        <div className="wb-readonly empty ce-locked" title="Answer field — filled by participants">—</div>
      </div>
    );
  }

  // choice / check_group — editable legend + editable option wording, locked control.
  return (
    <div className="wb-field">
      <fieldset className="wb-fieldset">
        <legend className="wb-label"><EditableText value={label} onSave={saveLabel} placeholder="(label)" /></legend>
        {(options || []).map((opt, i) => (
          <div key={i} className="wb-choice ce-choice">
            <input type={input_type === 'choice' ? 'radio' : 'checkbox'} disabled className="ce-locked-control" />
            <span><EditableText value={opt} onSave={v => saveOpt(i, v)} placeholder="(option)" /></span>
          </div>
        ))}
      </fieldset>
    </div>
  );
}

function TableEdit({ block, onSave }) {
  const cfg = block.config || {};
  const headers = Array.isArray(cfg.headers) ? cfg.headers : null;
  const rows = Array.isArray(cfg.rows) ? cfg.rows : [];

  const saveCaption = v => {
    const next = { ...cfg };
    if (v.trim()) next.caption = v; else delete next.caption;
    onSave(next);
  };
  const saveHeader = (i, v) => onSave({ ...cfg, headers: headers.map((h, idx) => (idx === i ? v : h)) });
  const saveCell = (ri, ci, v) => onSave({
    ...cfg,
    rows: rows.map((row, r) => (r === ri ? row.map((cell, c) => (c === ci ? { ...cell, text: v } : cell)) : row)),
  });

  return (
    <div className="wb-table-wrap">
      {cfg.caption ? (
        <div className="wb-table-caption">
          <EditableText value={cfg.caption} onSave={saveCaption} placeholder="(caption)" />
        </div>
      ) : null}
      <table className="wb-table">
        {headers && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}><EditableText value={h} onSave={v => saveHeader(i, v)} placeholder="(header)" /></th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cell.kind === 'input' ? 'wb-cell-input' : 'wb-cell-static'}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                >
                  {cell.kind === 'static' ? (
                    <EditableText value={cell.text || ''} onSave={v => saveCell(ri, ci, v)} placeholder="(empty)" multiline />
                  ) : (
                    <span className="wb-readonly inline empty ce-locked" title="Answer field — filled by participants">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

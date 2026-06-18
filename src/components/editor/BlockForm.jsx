import { useState } from 'react';
import '../../styles/interactive.css';
import { parseFillBlank, newItemId } from '../../lib/interactiveBlocks.js';

export default function BlockForm({ block, onSave, onCancel }) {
  if (block.block_type === 'prose') return <ProseForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'field') return <FieldForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'table') return <TableForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'fill_blank') return <FillBlankForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'card_sort') return <CardSortForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'match_pairs') return <MatchPairsForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'reorder') return <ReorderForm block={block} onSave={onSave} onCancel={onCancel} />;
  return null;
}

function ProseForm({ block, onSave, onCancel }) {
  const [html, setHtml] = useState(block.config?.html || '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    await onSave({ config: { ...block.config, html } });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">HTML content</label>
      <textarea
        className="form-textarea"
        rows="6"
        value={html}
        onChange={e => setHtml(e.target.value)}
      />
      <p className="hint">Supports basic HTML — <code>&lt;p&gt;</code>, <code>&lt;h3&gt;</code>, <code>&lt;h4&gt;</code>, <code>&lt;ul&gt;</code>/<code>&lt;li&gt;</code>, <code>&lt;strong&gt;</code>, <code>&lt;em&gt;</code>.</p>
      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

const INPUT_TYPES = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text (multi-line)' },
  { value: 'choice', label: 'Single choice (radio)' },
  { value: 'check_group', label: 'Multi-select (checkboxes)' },
];

function newCellId() {
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function TableForm({ block, onSave, onCancel }) {
  const cfg = block.config || {};
  const [caption, setCaption] = useState(cfg.caption || '');
  const [headers, setHeaders] = useState(Array.isArray(cfg.headers) ? cfg.headers : []);
  const [rows, setRows] = useState(Array.isArray(cfg.rows) ? cfg.rows : []);
  const [busy, setBusy] = useState(false);

  const numCols = Math.max(headers.length, ...rows.map(r => r.length), 1);

  function setHeader(i, v) {
    setHeaders(prev => {
      const next = prev.length ? [...prev] : Array.from({ length: numCols }, () => '');
      next[i] = v;
      return next;
    });
  }

  function addColumn() {
    setHeaders(prev => {
      const base = prev.length ? prev : Array.from({ length: numCols }, () => '');
      return [...base, `Column ${base.length + 1}`];
    });
    setRows(prev => prev.map(row => [...row, { kind: 'static', text: '' }]));
  }

  function removeColumn(i) {
    setHeaders(prev => prev.filter((_, idx) => idx !== i));
    setRows(prev => prev.map(row => row.filter((_, idx) => idx !== i)));
  }

  function addRow() {
    setRows(prev => [...prev, Array.from({ length: numCols }, () => ({ kind: 'static', text: '' }))]);
  }

  function removeRow(i) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateCell(ri, ci, fn) {
    setRows(prev => prev.map((row, r) =>
      r === ri ? row.map((cell, c) => c === ci ? fn(cell) : cell) : row
    ));
  }

  function setCellKind(ri, ci, kind) {
    updateCell(ri, ci, cell => {
      const spans = {};
      if (cell.colSpan > 1) spans.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) spans.rowSpan = cell.rowSpan;
      return kind === 'static'
        ? { kind: 'static', text: cell.text || '', ...spans }
        : { kind: 'input', id: cell.id || newCellId(), input_type: cell.input_type || 'short_text', ...spans };
    });
  }

  function setCellText(ri, ci, text) {
    updateCell(ri, ci, cell => ({ ...cell, text }));
  }

  function setCellInputType(ri, ci, t) {
    updateCell(ri, ci, cell => ({ ...cell, input_type: t }));
  }

  async function save() {
    setBusy(true);
    const config = { rows };
    if (caption.trim()) config.caption = caption.trim();
    if (headers.length && headers.some(h => (h || '').trim())) {
      config.headers = headers;
    }
    await onSave({ config });
    setBusy(false);
  }

  const showHeaders = headers.length > 0;

  return (
    <div className="block-form">
      <label className="form-label">Caption (optional)</label>
      <input className="form-input" value={caption} onChange={e => setCaption(e.target.value)} />

      <div className="table-form-actions" style={{ marginTop: '0.85rem' }}>
        {!showHeaders && (
          <button className="ghost" onClick={() => setHeaders(Array.from({ length: numCols }, (_, i) => `Column ${i + 1}`))}>
            + Add header row
          </button>
        )}
        {showHeaders && (
          <button className="ghost" onClick={() => setHeaders([])}>Remove header row</button>
        )}
      </div>

      <div className="table-form-wrap">
        <table className="table-form-grid">
          {showHeaders && (
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>
                    <div className="cell-stack">
                      <input className="form-input compact" value={h || ''} onChange={e => setHeader(i, e.target.value)} placeholder={`Col ${i + 1}`} />
                      <button className="ghost danger compact" onClick={() => removeColumn(i)} title="Remove column">× col</button>
                    </div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <div className="cell-stack">
                      <select className="form-input compact" value={cell.kind} onChange={e => setCellKind(ri, ci, e.target.value)}>
                        <option value="static">Text</option>
                        <option value="input">Input</option>
                      </select>
                      {cell.kind === 'static' ? (
                        <textarea className="form-textarea compact" rows="2" value={cell.text || ''} onChange={e => setCellText(ri, ci, e.target.value)} />
                      ) : (
                        <select className="form-input compact" value={cell.input_type || 'short_text'} onChange={e => setCellInputType(ri, ci, e.target.value)}>
                          <option value="short_text">Short text</option>
                          <option value="long_text">Long text</option>
                        </select>
                      )}
                    </div>
                  </td>
                ))}
                <td className="row-trash">
                  <button className="ghost danger compact" onClick={() => removeRow(ri)} title="Remove row">× row</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="add-block-row">
        <button className="ghost" onClick={addColumn}>+ Add column</button>
        <button className="ghost" onClick={addRow}>+ Add row</button>
      </div>

      <p className="hint">Rows can have different cell counts (from imports with merged cells). Add or remove cells as needed; participants' answers are tied to the input cell ID, so renaming/reordering won't lose data.</p>

      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function FieldForm({ block, onSave, onCancel }) {
  const [label, setLabel] = useState(block.config?.label || '');
  const [inputType, setInputType] = useState(block.config?.input_type || 'short_text');
  const [options, setOptions] = useState(block.config?.options || ['']);
  const [busy, setBusy] = useState(false);

  const needsOptions = inputType === 'choice' || inputType === 'check_group';

  function setOpt(i, v) {
    setOptions(prev => prev.map((o, idx) => idx === i ? v : o));
  }
  function addOpt() { setOptions(prev => [...prev, '']); }
  function removeOpt(i) { setOptions(prev => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    setBusy(true);
    const config = { label, input_type: inputType };
    if (needsOptions) config.options = options.filter(o => o.trim());
    await onSave({ config });
    setBusy(false);
  }

  return (
    <div className="block-form">
      <label className="form-label">Label</label>
      <input className="form-input" value={label} onChange={e => setLabel(e.target.value)} />

      <label className="form-label">Input type</label>
      <select className="form-input" value={inputType} onChange={e => setInputType(e.target.value)}>
        {INPUT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      {needsOptions && (
        <div className="options-editor">
          <div className="form-label">Options</div>
          {options.map((opt, i) => (
            <div key={i} className="option-row">
              <input className="form-input" value={opt} onChange={e => setOpt(i, e.target.value)} />
              <button className="ghost danger" onClick={() => removeOpt(i)} aria-label="Remove option">×</button>
            </div>
          ))}
          <button className="ghost" onClick={addOpt}>+ Add option</button>
        </div>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || !label.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// ── Interactive question editors ──────────────────────────────────────────
// These edit the question's *content* only. Correct answers are set in the
// Answer key panel (kept out of config so participants can't read them).

// A small reusable editor for an ordered list of {id, text} entries.
function ItemRowsEditor({ items, setItems, textKey = 'text', placeholder = 'Item', allowReorder = true }) {
  const setText = (i, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [textKey]: v } : it));
  const add = () => setItems(prev => [...prev, { id: newItemId(), [textKey]: '' }]);
  const remove = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const move = (i, dir) => setItems(prev => {
    const next = [...prev];
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  return (
    <div className="options-editor">
      {items.map((it, i) => (
        <div key={it.id} className="option-row">
          {allowReorder && <span className="muted" style={{ minWidth: '1.4rem', textAlign: 'right' }}>{i + 1}.</span>}
          <input className="form-input" value={it[textKey] || ''} placeholder={placeholder} onChange={e => setText(i, e.target.value)} />
          {allowReorder && (
            <>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">↓</button>
            </>
          )}
          <button className="ghost danger" onClick={() => remove(i)} aria-label="Remove">×</button>
        </div>
      ))}
      <button className="ghost" onClick={add}>+ Add</button>
    </div>
  );
}

function FillBlankForm({ block, onSave, onCancel }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [text, setText] = useState(cfg.text || '');
  const [busy, setBusy] = useState(false);
  const { parts, blanks } = parseFillBlank(text, cfg.blanks || []);
  const blankCount = blanks.length;

  async function save() {
    setBusy(true);
    await onSave({ config: { prompt: prompt.trim() || undefined, text, parts, blanks } });
    setBusy(false);
  }

  return (
    <div className="block-form">
      <label className="form-label">Instruction (optional)</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Complete the sentence" />

      <label className="form-label" style={{ marginTop: '0.6rem' }}>Sentence with blanks</label>
      <textarea
        className="form-textarea"
        rows="3"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="The capital of France is {{}} and of Japan is {{}}."
      />
      <p className="hint">Type <code>{'{{}}'}</code> wherever you want a blank. Detected blanks: <strong>{blankCount}</strong>. Set the correct answers in the <strong>Answer key</strong> panel above.</p>
      <p className="hint" style={{ color: 'var(--gold-dark)' }}>⚠ Blanks are matched by position. If you add or remove a blank after setting the answer key, re-check the key so each answer still lines up.</p>

      <div className="form-actions">
        <button onClick={save} disabled={busy || blankCount === 0}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function ReorderForm({ block, onSave, onCancel }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [items, setItems] = useState(Array.isArray(cfg.items) && cfg.items.length ? cfg.items : [{ id: newItemId(), text: '' }]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const clean = items.filter(it => (it.text || '').trim());
    await onSave({ config: { prompt: prompt.trim() || undefined, items: clean } });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Put the steps in the correct order" />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Items (enter them in the correct order)</label>
      <ItemRowsEditor items={items} setItems={setItems} placeholder="Step" />
      <p className="hint">Participants see these shuffled and arrange them. Set the correct order in the <strong>Answer key</strong> panel.</p>
      <div className="form-actions">
        <button onClick={save} disabled={busy || items.filter(it => (it.text || '').trim()).length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function CardSortForm({ block, onSave, onCancel }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [cards, setCards] = useState(Array.isArray(cfg.cards) && cfg.cards.length ? cfg.cards : [{ id: newItemId('card'), text: '' }]);
  const [buckets, setBuckets] = useState(Array.isArray(cfg.buckets) && cfg.buckets.length ? cfg.buckets : [{ id: newItemId('bkt'), label: '' }, { id: newItemId('bkt'), label: '' }]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const cleanCards = cards.filter(c => (c.text || '').trim());
    const cleanBuckets = buckets.filter(b => (b.label || '').trim());
    await onSave({ config: { prompt: prompt.trim() || undefined, cards: cleanCards, buckets: cleanBuckets } });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Sort each behaviour into the right column" />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Categories (buckets)</label>
      <ItemRowsEditor items={buckets} setItems={setBuckets} textKey="label" placeholder="Category name" allowReorder={false} />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Cards</label>
      <ItemRowsEditor items={cards} setItems={setCards} placeholder="Card text" allowReorder={false} />
      <p className="hint">Set which category each card belongs in via the <strong>Answer key</strong> panel.</p>
      <div className="form-actions">
        <button onClick={save} disabled={busy || cards.filter(c => (c.text || '').trim()).length === 0 || buckets.filter(b => (b.label || '').trim()).length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function MatchPairsForm({ block, onSave, onCancel }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [left, setLeft] = useState(Array.isArray(cfg.left) && cfg.left.length ? cfg.left : [{ id: newItemId('l'), text: '' }]);
  const [right, setRight] = useState(Array.isArray(cfg.right) && cfg.right.length ? cfg.right : [{ id: newItemId('r'), text: '' }]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const cleanLeft = left.filter(l => (l.text || '').trim());
    const cleanRight = right.filter(r => (r.text || '').trim());
    await onSave({ config: { prompt: prompt.trim() || undefined, left: cleanLeft, right: cleanRight } });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Match each term to its definition" />
      <div className="matchpairs-form-cols">
        <div>
          <label className="form-label">Left (prompts)</label>
          <ItemRowsEditor items={left} setItems={setLeft} placeholder="Term" allowReorder={false} />
        </div>
        <div>
          <label className="form-label">Right (choices)</label>
          <ItemRowsEditor items={right} setItems={setRight} placeholder="Match" allowReorder={false} />
        </div>
      </div>
      <p className="hint">Add extra right-hand choices as distractors if you like. Set the correct match for each left item in the <strong>Answer key</strong> panel.</p>
      <div className="form-actions">
        <button onClick={save} disabled={busy || left.filter(l => (l.text || '').trim()).length === 0 || right.filter(r => (r.text || '').trim()).length === 0}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

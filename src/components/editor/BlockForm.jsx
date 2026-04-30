import { useState } from 'react';

export default function BlockForm({ block, onSave, onCancel }) {
  if (block.block_type === 'prose') return <ProseForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'field') return <FieldForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'table') return (
    <div className="block-form">
      <p className="hint">Tables are configured at seed time. Full table editing is planned for v2.</p>
      <div className="form-actions"><button className="ghost" onClick={onCancel}>Close</button></div>
    </div>
  );
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

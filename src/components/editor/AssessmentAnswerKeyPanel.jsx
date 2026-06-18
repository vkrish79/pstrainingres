import { useMemo, useState } from 'react';
import '../../styles/interactive.css';
import { useAssessmentAnswerKeys } from '../../hooks/useAssessmentAnswerKeys.js';
import { isScorableBlock } from '../../lib/assessmentScoring.js';
import { labelOf, inputCellsOf } from '../../lib/blockHelpers.js';

// Answer-key entry for an assessment template. Lists every auto-scorable
// question (single-choice, multi-select, short text, table cells) with a
// control to set the correct answer. Saves to assessment_answer_keys. Long-text
// questions are not listed (never auto-scored). Trainer-only — participants
// never read these keys.
export default function AssessmentAnswerKeyPanel({ sections, blocks }) {
  const blockIds = useMemo(() => blocks.map(b => b.id), [blocks]);
  const { keys, setKey, clearKey, error } = useAssessmentAnswerKeys(blockIds);
  const [open, setOpen] = useState(false);

  const scorable = useMemo(() => blocks.filter(isScorableBlock), [blocks]);
  const keyedCount = scorable.filter(b => keys[b.id] != null).length;

  if (scorable.length === 0) {
    return (
      <section className="editor-card answer-key-panel">
        <div className="answer-key-head">
          <h2>🎯 Answer key (auto-marking)</h2>
          <span className="muted">No auto-scorable questions yet. Add choice, multi-select, short-text, table, or interactive questions.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-card answer-key-panel">
      <button type="button" className="answer-key-head answer-key-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="answer-key-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        <h2>🎯 Answer key (auto-marking)</h2>
        <span className={`answer-key-count ${keyedCount === scorable.length ? 'full' : keyedCount === 0 ? 'none' : 'partial'}`}>
          {keyedCount}/{scorable.length} keyed
        </span>
      </button>

      {error && (
        <p className="answer-key-error" role="alert">
          ⚠️ Answer keys aren’t saving — changes won’t persist. {error}
        </p>
      )}

      {open && (
        <div className="answer-key-body">
          <p className="ce-hint">Set the correct answer for each objective question. Matching is case-insensitive. Leave blank to skip a question (it won't be auto-marked).</p>
          {sections.map(sec => {
            const secBlocks = blocks.filter(b => b.section_id === sec.id && isScorableBlock(b));
            if (!secBlocks.length) return null;
            return (
              <div key={sec.id} className="answer-key-section">
                <h3 className="answer-key-section-title">{sec.title}</h3>
                {secBlocks.map(b => (
                  <KeyRow
                    key={b.id}
                    block={b}
                    value={keys[b.id]}
                    onChange={k => setKey(b.id, k)}
                    onClear={() => clearKey(b.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function KeyRow({ block, value, onChange, onClear }) {
  const label = labelOf(block);
  const hasKey = value != null;
  return (
    <div className={`answer-key-row ${hasKey ? 'has-key' : ''}`}>
      <div className="answer-key-q">
        <span className="answer-key-q-label">{label}</span>
        {hasKey && <button type="button" className="answer-key-clear" onClick={onClear} title="Clear key">clear</button>}
      </div>
      <div className="answer-key-control">
        <KeyControl block={block} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function KeyControl({ block, value, onChange }) {
  if (block.block_type === 'fill_blank') return <FillBlankKey block={block} value={value} onChange={onChange} />;
  if (block.block_type === 'card_sort') return <CardSortKey block={block} value={value} onChange={onChange} />;
  if (block.block_type === 'match_pairs') return <MatchPairsKey block={block} value={value} onChange={onChange} />;
  if (block.block_type === 'reorder') return <ReorderKey block={block} value={value} onChange={onChange} />;

  if (block.block_type === 'field') {
    const t = block.config?.input_type;
    const options = block.config?.options || [];

    if (t === 'short_text') {
      return (
        <input
          className="form-input"
          placeholder="Expected answer"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
        />
      );
    }

    if (t === 'choice') {
      return (
        <select className="form-input" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}>
          <option value="">— select correct option —</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }

    if (t === 'check_group') {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (opt) => onChange(arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt]);
      return (
        <div className="answer-key-checks">
          {options.map(opt => (
            <label key={opt} className="answer-key-check">
              <input type="checkbox" checked={arr.includes(opt)} onChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      );
    }
    return null;
  }

  if (block.block_type === 'table') {
    const cells = inputCellsOf(block);
    const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const setCell = (cellId, v) => {
      const next = { ...map };
      if (v.trim() === '') delete next[cellId]; else next[cellId] = v;
      onChange(Object.keys(next).length ? next : null);
    };
    return (
      <div className="answer-key-cells">
        {cells.map(c => (
          <label key={c.id} className="answer-key-cell">
            <span className="answer-key-cell-label">{c.label}</span>
            <input
              className="form-input"
              placeholder="Expected"
              value={map[c.id] != null ? String(map[c.id]) : ''}
              onChange={e => setCell(c.id, e.target.value)}
            />
          </label>
        ))}
      </div>
    );
  }
  return null;
}

// Helper: write into an object-shaped key, dropping empty entries; null when empty.
function objKeyUpdater(value, onChange) {
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return (id, v) => {
    const next = { ...map };
    if (v == null || String(v).trim() === '') delete next[id]; else next[id] = v;
    onChange(Object.keys(next).length ? next : null);
  };
}

function FillBlankKey({ block, value, onChange }) {
  const blanks = block.config?.blanks || [];
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const setBlank = objKeyUpdater(value, onChange);
  return (
    <div className="answer-key-cells">
      {blanks.map((b, i) => (
        <label key={b.id} className="answer-key-cell">
          <span className="answer-key-cell-label">Blank {i + 1}</span>
          <input
            className="form-input"
            placeholder="Expected"
            value={map[b.id] != null ? String(map[b.id]) : ''}
            onChange={e => setBlank(b.id, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

function CardSortKey({ block, value, onChange }) {
  const cards = block.config?.cards || [];
  const buckets = block.config?.buckets || [];
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const setCard = objKeyUpdater(value, onChange);
  return (
    <div className="answer-key-cells">
      {cards.map(c => (
        <label key={c.id} className="answer-key-cell">
          <span className="answer-key-cell-label">{c.text}</span>
          <select className="form-input" value={map[c.id] || ''} onChange={e => setCard(c.id, e.target.value)}>
            <option value="">— correct category —</option>
            {buckets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function MatchPairsKey({ block, value, onChange }) {
  const left = block.config?.left || [];
  const right = block.config?.right || [];
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const setLeft = objKeyUpdater(value, onChange);
  return (
    <div className="answer-key-cells">
      {left.map(l => (
        <label key={l.id} className="answer-key-cell">
          <span className="answer-key-cell-label">{l.text}</span>
          <select className="form-input" value={map[l.id] || ''} onChange={e => setLeft(l.id, e.target.value)}>
            <option value="">— correct match —</option>
            {right.map(r => <option key={r.id} value={r.id}>{r.text}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function ReorderKey({ block, value, onChange }) {
  const items = block.config?.items || [];
  const byId = Object.fromEntries(items.map(it => [it.id, it]));
  // Current correct order: the saved key, else the authored order. Keep any
  // items the key doesn't yet mention appended at the end.
  let order = Array.isArray(value) && value.length ? value.filter(id => byId[id]) : items.map(it => it.id);
  for (const it of items) if (!order.includes(it.id)) order = [...order, it.id];

  const move = (i, dir) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <ol className="answer-key-order">
      {order.map((id, i) => (
        <li key={id} className="answer-key-order-row">
          <span className="answer-key-order-rank">{i + 1}</span>
          <span className="answer-key-order-text">{byId[id]?.text || '(item)'}</span>
          <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
          <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Move down">↓</button>
        </li>
      ))}
    </ol>
  );
}

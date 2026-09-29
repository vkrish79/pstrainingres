import { useState } from 'react';
import '../../styles/interactive.css';
import { parseFillBlank, newItemId } from '../../lib/interactiveBlocks.js';
import { BOX_MARKER, mixedToText, mixedFromText, mixedWording } from '../../lib/tableCells.js';
import { PNR_FIELDS, normalisePnr } from '../../lib/pnrQuestion.js';

// answerKey / canSetAnswer are only meaningful in an assessment or a question
// bank, where a question has a correct answer at all. A workbook passes neither,
// so its form is exactly as it was.
export default function BlockForm({ block, onSave, onCancel, answerKey = undefined, canSetAnswer = false }) {
  if (block.block_type === 'prose') return <ProseForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'field') {
    return (
      <FieldForm
        block={block}
        onSave={onSave}
        onCancel={onCancel}
        answerKey={answerKey}
        canSetAnswer={canSetAnswer}
      />
    );
  }
  if (block.block_type === 'table') return <TableForm block={block} onSave={onSave} onCancel={onCancel} />;
  // THE FOUR INTERACTIVE TYPES NOW TAKE THE KEY TOO. They did not, so their
  // forms told the author to go and use an "Answer key" panel — which is on
  // the assessment editor but has never been on the question bank. In a bank,
  // a drag-and-drop question therefore had nowhere at all to record its
  // answer, and the hint pointed at a control that was not on the page.
  const keyProps = { answerKey, canSetAnswer };
  if (block.block_type === 'fill_blank') return <FillBlankForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  if (block.block_type === 'card_sort') return <CardSortForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  if (block.block_type === 'match_pairs') return <MatchPairsForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  if (block.block_type === 'reorder') return <ReorderForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  return null;
}

// ── Marking the correct answer, on the question itself ──────────────────────
//
// The controls below are bound to the form's LIVE items, never to
// block.config. A separate panel could read the saved block because by then it
// was saved; here a card you have only just typed has to be assignable before
// you press Save, and a card you rename has to show its new wording beside its
// own select. Reading block.config would show the stale one.
function InlineKey({ children, note, missing = 0 }) {
  return (
    <div className="inline-key">
      <div className="inline-key-head">
        Correct answer
        {missing > 0 && (
          <span className="inline-key-todo">{missing} still to set</span>
        )}
      </div>
      {children}
      {note && <p className="hint inline-key-note">{note}</p>}
    </div>
  );
}

// Keep only the ids that still exist, and only non-empty values.
//
// Deleting a card otherwise leaves a key entry for a card nobody can be asked
// about — which quietly inflates the denominator that partial credit divides
// by, since a mark is a fraction of the KEYED slots. Returns null, not {}, when
// nothing is set: null is this form's "clear the stored key", and a key row
// holding an empty object would claim the question is marked automatically
// when it cannot be.
function pruneKeyMap(map, liveIds) {
  const out = {};
  for (const id of liveIds) {
    const v = map?.[id];
    if (v != null && `${v}`.trim() !== '') out[id] = typeof v === 'string' ? v.trim() : v;
  }
  return Object.keys(out).length ? out : null;
}

// An object-shaped key read back off the row, defended against the array and
// string shapes the other block types store.
function asKeyMap(answerKey) {
  return answerKey && typeof answerKey === 'object' && !Array.isArray(answerKey) ? answerKey : {};
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
      if (kind === 'static') {
        return { kind: 'static', text: cell.kind === 'mixed' ? mixedWording(cell) : (cell.text || ''), ...spans };
      }
      if (kind === 'mixed') {
        // Keep the wording and put a box after it; the trainer moves the {{}}.
        const text = cell.kind === 'static' ? (cell.text || '').trim() : '';
        return mixedFromText(text ? `${text} ${BOX_MARKER}` : BOX_MARKER, { ...spans }, newCellId);
      }
      return { kind: 'input', id: cell.id || newCellId(), input_type: cell.input_type || 'short_text', ...spans };
    });
  }

  function setCellText(ri, ci, text) {
    updateCell(ri, ci, cell => ({ ...cell, text }));
  }

  function setMixedText(ri, ci, text) {
    updateCell(ri, ci, cell => mixedFromText(text, cell, newCellId));
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
                        <option value="mixed">Text with boxes</option>
                      </select>
                      {cell.kind === 'mixed' ? (
                        <textarea
                          className="form-textarea compact"
                          rows="2"
                          value={mixedToText(cell)}
                          onChange={e => setMixedText(ri, ci, e.target.value)}
                          data-tip={`Type ${BOX_MARKER} wherever an answer box goes`}
                        />
                      ) : cell.kind === 'static' ? (
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

function FieldForm({ block, onSave, onCancel, answerKey = undefined, canSetAnswer = false }) {
  const [label, setLabel] = useState(block.config?.label || '');
  const [inputType, setInputType] = useState(block.config?.input_type || 'short_text');
  const [options, setOptions] = useState(block.config?.options || ['']);
  // A PNR question is this form plus a scenario. Held in state only when the
  // block already carries one, so an ordinary field never grows the fieldset.
  const [pnr, setPnr] = useState(() => (block.config?.pnr ? normalisePnr(block.config.pnr) : null));
  const [busy, setBusy] = useState(false);

  const needsOptions = inputType === 'choice' || inputType === 'check_group';

  // ── The correct answer, marked here on the question ────────────────────────
  //
  // It is stored on assessment_answer_keys, NOT in config, and that is not
  // negotiable: the participant page reads assessment_blocks.select('*'), so an
  // answer kept in config would be handed to every candidate with the paper. Only
  // the control moved; the storage did not.
  //
  // CORRECT OPTIONS ARE TRACKED BY POSITION, not by their text, even though the
  // key is STORED as text (that is the shape scoring compares against). Tracking
  // the text in the form would reintroduce a real bug: rename an option and its
  // key silently stops matching, so a right answer marks wrong. Holding the index
  // means renaming an option rewrites its key in the same save.
  const initialCorrect = () => {
    const opts = block.config?.options || [];
    const norm = (s) => String(s ?? '').trim().toLowerCase();
    if ((block.config?.input_type || '') === 'check_group') {
      const wanted = (Array.isArray(answerKey) ? answerKey : []).map(norm);
      return new Set(opts.map((o, i) => (wanted.includes(norm(o)) ? i : -1)).filter(i => i >= 0));
    }
    if ((block.config?.input_type || '') === 'choice') {
      const i = opts.findIndex(o => norm(o) === norm(answerKey));
      return new Set(i >= 0 ? [i] : []);
    }
    return new Set();
  };
  const [correct, setCorrect] = useState(initialCorrect);
  const [textAnswer, setTextAnswer] = useState(
    typeof answerKey === 'string' && (block.config?.input_type || '') === 'short_text' ? answerKey : '',
  );

  // Removing an option has to shift every later index down, or the marked answer
  // quietly slides onto its neighbour.
  function shiftCorrectAfterRemove(removed) {
    setCorrect(prev => {
      const n = new Set();
      prev.forEach(i => {
        if (i < removed) n.add(i);
        else if (i > removed) n.add(i - 1);
      });
      return n;
    });
  }

  function toggleCorrect(i) {
    setCorrect(prev => {
      if (inputType === 'choice') return new Set(prev.has(i) ? [] : [i]);
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }

  // What gets written to the key column. undefined means "leave the stored key
  // alone"; null means "clear it".
  function answerToSave() {
    if (!canSetAnswer) return undefined;
    if (inputType === 'choice') {
      const i = [...correct][0];
      const opt = i == null ? null : options[i];
      return opt?.trim() ? opt.trim() : null;
    }
    if (inputType === 'check_group') {
      const picked = [...correct].map(i => options[i]).filter(o => o?.trim()).map(o => o.trim());
      return picked.length ? picked : null;
    }
    if (inputType === 'short_text') {
      return textAnswer.trim() ? textAnswer.trim() : null;
    }
    // long_text (including a PNR question) is marked by hand — there is no
    // correct answer to record, and the CHECK on the table forbids one.
    return null;
  }
  // The scenario only means anything on a long-text question: a PNR exercise is
  // marked by hand against criteria, and only long_text is excluded from
  // auto-marking. Switching the type away hides it rather than deleting it, so
  // switching back does not lose the scenario.
  const showPnr = pnr !== null && inputType === 'long_text';

  function setOpt(i, v) {
    setOptions(prev => prev.map((o, idx) => idx === i ? v : o));
  }
  function addOpt() { setOptions(prev => [...prev, '']); }
  function removeOpt(i) {
    setOptions(prev => prev.filter((_, idx) => idx !== i));
    shiftCorrectAfterRemove(i);
  }
  function setPnrField(key, v) { setPnr(prev => ({ ...prev, [key]: v })); }

  async function save() {
    setBusy(true);
    // Spread the existing config rather than rebuilding it from these three
    // fields. Anything else living there — a PNR scenario, the `inactive` flag a
    // withdrawn question carries — would otherwise be silently dropped by an
    // unrelated edit to the label.
    const config = { ...(block.config || {}), label, input_type: inputType };
    if (needsOptions) config.options = options.filter(o => o.trim());
    else delete config.options;
    if (pnr) config.pnr = pnr;
    // One call, both writes. The caller is responsible for keeping the config and
    // the answer in step — a config saved without its key would leave a renamed
    // option pointing at an answer that no longer exists.
    await onSave({ config, answerKey: answerToSave() });
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

      {showPnr && (
        <div className="options-editor">
          <div className="form-label">PNR scenario</div>
          <div className="pnr-form">
            {PNR_FIELDS.map(f => (
              <div key={f.key} className={f.key === 'scenario' ? 'pnr-form-full' : ''}>
                <label className="form-label">{f.label}</label>
                <input
                  className="form-input"
                  value={pnr[f.key]}
                  placeholder={f.placeholder}
                  onChange={e => setPnrField(f.key, e.target.value)}
                />
              </div>
            ))}
            <label className="pnr-form-check pnr-form-full">
              <input
                type="checkbox"
                checked={pnr.prep_needed}
                onChange={e => setPnrField('prep_needed', e.target.checked)}
              />
              <span>Runs on a PNR prepared in advance</span>
            </label>
          </div>
          <p className="hint">
            Marks come from the criteria on this question in the Scorecard panel, not from here.
          </p>
        </div>
      )}

      {pnr !== null && inputType !== 'long_text' && (
        <p className="hint">
          This question carries a PNR scenario, which only shows on a long-text question. Switch
          the input type back to <strong>Long text</strong> to edit it.
        </p>
      )}

      {needsOptions && (
        <div className="options-editor">
          <div className="form-label">
            Options
            {canSetAnswer && (
              <span className="muted" style={{ fontWeight: 400, marginLeft: '0.4rem' }}>
                — tick the correct {inputType === 'choice' ? 'one' : 'ones'}
              </span>
            )}
          </div>
          {options.map((opt, i) => (
            <div key={i} className={`option-row ${canSetAnswer && correct.has(i) ? 'is-correct' : ''}`}>
              {canSetAnswer && (
                <label className="option-correct" data-tip={correct.has(i) ? 'This is the correct answer' : 'Mark this as correct'}>
                  <input
                    type={inputType === 'choice' ? 'radio' : 'checkbox'}
                    name={`correct-${block.id}`}
                    checked={correct.has(i)}
                    onChange={() => toggleCorrect(i)}
                    aria-label={`Mark "${opt || `option ${i + 1}`}" as correct`}
                  />
                </label>
              )}
              <input className="form-input" value={opt} onChange={e => setOpt(i, e.target.value)} />
              <button className="ghost danger" onClick={() => removeOpt(i)} aria-label="Remove option">×</button>
            </div>
          ))}
          <button className="ghost" onClick={addOpt}>+ Add option</button>
          {canSetAnswer && correct.size === 0 && (
            <p className="hint">
              Nothing marked correct yet — this question won’t be marked automatically until one is.
            </p>
          )}
        </div>
      )}

      {/* A short answer is compared case-insensitively, so the trainer does not
          have to guess at capitalisation. */}
      {canSetAnswer && inputType === 'short_text' && (
        <>
          <label className="form-label">Correct answer</label>
          <input
            className="form-input"
            value={textAnswer}
            placeholder="Leave blank to mark this question by hand"
            onChange={e => setTextAnswer(e.target.value)}
          />
          <p className="hint">Matching ignores capitalisation and surrounding spaces.</p>
        </>
      )}

      {canSetAnswer && inputType === 'long_text' && (
        <p className="hint">
          A written answer has no correct answer to record — it is marked by hand, against the
          criteria you set on this question in the assessment.
        </p>
      )}

      <div className="form-actions">
        {/* A PNR question is titled by its scenario, so a filled scenario is
            enough on its own — requiring the label too would block saving a
            question that already reads perfectly well. */}
        <button
          onClick={save}
          disabled={busy || !(label.trim() || (showPnr && pnr.scenario.trim()))}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
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

function FillBlankForm({ block, onSave, onCancel, answerKey, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [text, setText] = useState(cfg.text || '');
  const [keyMap, setKeyMap] = useState(() => asKeyMap(answerKey));
  const [busy, setBusy] = useState(false);
  const { parts, blanks } = parseFillBlank(text, cfg.blanks || []);
  const blankCount = blanks.length;
  const unset = blanks.filter(b => !(keyMap[b.id] || '').trim()).length;

  function answerToSave() {
    if (!canSetAnswer) return undefined;
    return pruneKeyMap(keyMap, blanks.map(b => b.id));
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, text, parts, blanks },
      answerKey: answerToSave(),
    });
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
      <p className="hint">Type <code>{'{{}}'}</code> wherever you want a blank. Detected blanks: <strong>{blankCount}</strong>.</p>
      <p className="hint" style={{ color: 'var(--gold-dark)' }}>⚠ Blanks are matched by position. If you add or remove a blank after setting the answers, re-check them so each one still lines up.</p>

      {canSetAnswer && (
        <InlineKey
          missing={unset}
          note="Matched exactly as typed, ignoring surrounding spaces and letter case. Only the blanks you fill in are marked."
        >
          {blankCount === 0 ? (
            <p className="hint">Put a {'{{}}'} in the sentence above first.</p>
          ) : (
            <div className="inline-key-rows">
              {blanks.map((b, i) => (
                <label key={b.id} className="inline-key-row">
                  <span className="inline-key-label">Blank {i + 1}</span>
                  <input
                    className="form-input"
                    value={keyMap[b.id] || ''}
                    placeholder="Expected answer"
                    onChange={e => setKeyMap(prev => ({ ...prev, [b.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || blankCount === 0}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// No `answerKey` here on purpose: this is the one type whose key is DERIVED
// from the content, so there is no stored value to read back into the form.
function ReorderForm({ block, onSave, onCancel, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [items, setItems] = useState(Array.isArray(cfg.items) && cfg.items.length ? cfg.items : [{ id: newItemId(), text: '' }]);
  const [busy, setBusy] = useState(false);

  const clean = items.filter(it => (it.text || '').trim());

  // THE AUTHORED ORDER IS THE ANSWER — there is nothing else for it to be.
  // The field above says "enter them in the correct order" and participants
  // are shown them shuffled, so asking for the order a second time in a
  // separate control only created a way for the two to disagree. It is drawn
  // below rather than left implicit, because a key that writes itself should
  // still be a key you can see before you save it.
  function answerToSave() {
    if (!canSetAnswer) return undefined;
    const ids = clean.map(it => it.id);
    return ids.length ? ids : null;
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, items: clean },
      answerKey: answerToSave(),
    });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Put the steps in the correct order" />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Items (enter them in the correct order)</label>
      <ItemRowsEditor items={items} setItems={setItems} placeholder="Step" />
      <p className="hint">Participants see these shuffled and arrange them.</p>

      {canSetAnswer && (
        <InlineKey note="This is the order above — reorder the items to change it.">
          {clean.length < 2 ? (
            <p className="hint">Add at least two items first.</p>
          ) : (
            <ol className="inline-key-order">
              {clean.map(it => <li key={it.id}>{it.text}</li>)}
            </ol>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || clean.length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function CardSortForm({ block, onSave, onCancel, answerKey, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [cards, setCards] = useState(Array.isArray(cfg.cards) && cfg.cards.length ? cfg.cards : [{ id: newItemId('card'), text: '' }]);
  const [buckets, setBuckets] = useState(Array.isArray(cfg.buckets) && cfg.buckets.length ? cfg.buckets : [{ id: newItemId('bkt'), label: '' }, { id: newItemId('bkt'), label: '' }]);
  const [keyMap, setKeyMap] = useState(() => asKeyMap(answerKey));
  const [busy, setBusy] = useState(false);

  const cleanCards = cards.filter(c => (c.text || '').trim());
  const cleanBuckets = buckets.filter(b => (b.label || '').trim());
  const unset = cleanCards.filter(c => !keyMap[c.id]).length;

  function answerToSave() {
    if (!canSetAnswer) return undefined;
    return pruneKeyMap(keyMap, cleanCards.map(c => c.id));
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, cards: cleanCards, buckets: cleanBuckets },
      answerKey: answerToSave(),
    });
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

      {canSetAnswer && (
        <InlineKey
          missing={unset}
          note="Participants drag each card into a category. Only the cards you set a category for are marked."
        >
          {cleanCards.length === 0 || cleanBuckets.length === 0 ? (
            <p className="hint">Add at least one card and two categories first.</p>
          ) : (
            <div className="inline-key-rows">
              {cleanCards.map(c => (
                <label key={c.id} className="inline-key-row">
                  <span className="inline-key-label">{c.text}</span>
                  <select
                    className="form-input"
                    value={keyMap[c.id] || ''}
                    onChange={e => setKeyMap(prev => ({ ...prev, [c.id]: e.target.value }))}
                  >
                    <option value="">— correct category —</option>
                    {cleanBuckets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || cleanCards.length === 0 || cleanBuckets.length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function MatchPairsForm({ block, onSave, onCancel, answerKey, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [left, setLeft] = useState(Array.isArray(cfg.left) && cfg.left.length ? cfg.left : [{ id: newItemId('l'), text: '' }]);
  const [right, setRight] = useState(Array.isArray(cfg.right) && cfg.right.length ? cfg.right : [{ id: newItemId('r'), text: '' }]);
  const [keyMap, setKeyMap] = useState(() => asKeyMap(answerKey));
  const [busy, setBusy] = useState(false);

  const cleanLeft = left.filter(l => (l.text || '').trim());
  const cleanRight = right.filter(r => (r.text || '').trim());
  const unset = cleanLeft.filter(l => !keyMap[l.id]).length;

  function answerToSave() {
    if (!canSetAnswer) return undefined;
    return pruneKeyMap(keyMap, cleanLeft.map(l => l.id));
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, left: cleanLeft, right: cleanRight },
      answerKey: answerToSave(),
    });
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
      <p className="hint">Add extra right-hand choices as distractors if you like — a choice nobody is matched to is what makes the question hard.</p>

      {canSetAnswer && (
        <InlineKey
          missing={unset}
          note="Only the left-hand items you set a match for are marked."
        >
          {cleanLeft.length === 0 || cleanRight.length === 0 ? (
            <p className="hint">Add at least one item on each side first.</p>
          ) : (
            <div className="inline-key-rows">
              {cleanLeft.map(l => (
                <label key={l.id} className="inline-key-row">
                  <span className="inline-key-label">{l.text}</span>
                  <select
                    className="form-input"
                    value={keyMap[l.id] || ''}
                    onChange={e => setKeyMap(prev => ({ ...prev, [l.id]: e.target.value }))}
                  >
                    <option value="">— correct match —</option>
                    {cleanRight.map(r => <option key={r.id} value={r.id}>{r.text}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || cleanLeft.length === 0 || cleanRight.length === 0}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { PNR_FIELDS, normalisePnr } from '../../lib/pnrQuestion.js';

const INPUT_TYPES = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text (multi-line)' },
  { value: 'choice', label: 'Single choice (radio)' },
  { value: 'check_group', label: 'Multi-select (checkboxes)' },
];

export default function FieldForm({ block, onSave, onCancel, answerKey = undefined, canSetAnswer = false }) {
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

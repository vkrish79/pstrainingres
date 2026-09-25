import ReviewMark from './ReviewMark.jsx';
import { isPnrQuestion, normalisePnr, pnrSummaryRows } from '../../lib/pnrQuestion.js';

// The scenario half of a PNR question: what to build, for whom, in which classes.
// Read-only wherever it appears — it is the question, not an answer. Renders
// nothing at all for an ordinary field, so it is safe to place unconditionally.
function PnrScenario({ block }) {
  if (!isPnrQuestion(block)) return null;
  const pnr = normalisePnr(block.config.pnr);
  const rows = pnrSummaryRows(pnr);
  if (!pnr.scenario.trim() && rows.length === 0 && !pnr.prep_needed) return null;
  return (
    <div className="pnr-scenario">
      <div className="pnr-scenario-head">
        <span className="pnr-scenario-tag">PNR</span>
        {pnr.scenario.trim() && <span className="pnr-scenario-title">{pnr.scenario.trim()}</span>}
        {pnr.prep_needed && (
          <span className="pnr-scenario-prep" data-tip="This question runs on a PNR prepared in advance">
            prepared PNR
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <dl className="pnr-scenario-grid">
          {rows.map(r => (
            <div key={r.key} className="pnr-scenario-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// The field, plus its mark once the trainer has gone over it with the class.
// `preview` — draw the QUESTION as a candidate would meet it, with its controls
// visible but inert. Distinct from `readOnly`, which means "show the answer that
// was given" and renders an em-dash when there isn't one. Both are non-editable;
// they differ in what they are non-editable ABOUT. A bank picker showing "—"
// where the options should be is readOnly being asked the wrong question.
// `correct` — the question's answer key, shown only alongside `preview`. It is
// trainer-only data: every surface that passes it is behind the super-trainer
// gate, and nothing on a participant's path ever supplies it.
export default function FieldBlock({ block, value, onChange, readOnly = false, preview = false, correct = undefined, marks = null, marksAudience = 'participant' }) {
  const mark = marks?.[''];
  const { input_type, options } = block.config || {};
  // The trainer's answer comes back as text; turn it into this field's value.
  // A check group's answer is its options joined with " + " (see review_slots).
  function apply(answer) {
    if (input_type === 'check_group') {
      const wanted = answer.split(' + ').map(s => s.trim().toUpperCase());
      onChange((options || []).filter(o => wanted.includes(String(o).trim().toUpperCase())));
    } else if (input_type === 'choice') {
      const match = (options || []).find(o => String(o).trim().toUpperCase() === answer.trim().toUpperCase());
      onChange(match ?? answer);
    } else {
      onChange(answer);
    }
  }
  return (
    <>
      <FieldBody block={block} value={value} onChange={onChange} readOnly={readOnly} preview={preview} correct={correct} />
      {mark?.trainer_answer && (
        mark.right
          ? <div className="rv-field-right"><ReviewMark mark={mark} /> <span>{marksAudience === 'trainer' ? 'Matches your answer' : 'Matches your trainer'}</span></div>
          : <ReviewMark mark={mark} readOnly={readOnly} audience={marksAudience} onApply={apply} />
      )}
    </>
  );
}

// Matching is case- and space-insensitive, the same comparison assessmentScoring
// uses — so an option marked correct here is one that would actually score.
function isCorrect(correct, opt) {
  const norm = s => String(s ?? '').trim().toLowerCase();
  if (Array.isArray(correct)) return correct.some(c => norm(c) === norm(opt));
  return correct != null && norm(correct) === norm(opt);
}

function FieldBody({ block, value, onChange, readOnly = false, preview = false, correct = undefined }) {
  const { label, input_type, options } = block.config || {};
  // Answers are shown only in a preview, never on the answering path.
  const showCorrect = preview && correct != null
    && !(Array.isArray(correct) && correct.length === 0);
  const tick = <span className="wb-correct-tick" aria-label="correct answer">✓</span>;
  // A preview takes the QUESTION path and then disables it, rather than the
  // answer path. The two are both non-editable but say different things, and
  // conflating them is what put an em-dash where a bank picker should have shown
  // the options.
  const showAnswer = readOnly && !preview;
  const noop = () => {};

  if (input_type === 'short_text' || input_type === 'long_text') {
    const Tag = input_type === 'long_text' ? 'textarea' : 'input';
    // A PNR question is this same long-text field with a scenario attached. The
    // panel renders here, above the answer box, so every surface that draws a
    // block through Block.jsx gets it at once — the participant's paper, the
    // editor preview, the trainer preview, the bank picker, and the closed-session
    // report reading back from closed_summary.
    const scenario = <PnrScenario block={block} />;
    if (showAnswer) {
      const v = (value || '').toString();
      return (
        <div className="wb-field">
          {scenario}
          <label className="wb-label">{label}</label>
          <div className={`wb-readonly ${v ? '' : 'empty'}`}>{v || '—'}</div>
        </div>
      );
    }
    return (
      <div className="wb-field">
        {scenario}
        <label className="wb-label">{label}</label>
        <Tag
          {...(input_type === 'long_text' ? { rows: 6 } : { type: 'text' })}
          className={input_type === 'long_text' ? 'wb-textarea' : 'wb-input'}
          value={preview ? '' : (value || '')}
          disabled={preview}
          onChange={preview ? noop : (e => onChange(e.target.value))}
        />
        {/* A short answer has no options to tick, so the expected answer is named
            instead. Long text never has one — it is marked by hand. */}
        {showCorrect && input_type === 'short_text' && (
          <p className="wb-correct-note">
            {tick} Correct answer: <strong>{String(correct)}</strong>
          </p>
        )}
      </div>
    );
  }

  if (input_type === 'choice') {
    if (showAnswer) {
      return (
        <div className="wb-field">
          <div className="wb-label">{label}</div>
          <div className={`wb-readonly ${value ? '' : 'empty'}`}>{value || '—'}</div>
        </div>
      );
    }
    return (
      <div className="wb-field">
        <fieldset className="wb-fieldset">
          <legend className="wb-label">{label}</legend>
          {(options || []).map(opt => {
            const right = showCorrect && isCorrect(correct, opt);
            return (
              <label key={opt} className={`wb-choice ${right ? 'is-correct' : ''}`}>
                <input
                  type="radio"
                  name={block.id}
                  value={opt}
                  checked={preview ? false : value === opt}
                  disabled={preview}
                  onChange={preview ? noop : (e => onChange(e.target.value))}
                />
                <span>{opt}</span>
                {right && tick}
              </label>
            );
          })}
        </fieldset>
      </div>
    );
  }

  if (input_type === 'check_group') {
    const arr = Array.isArray(value) ? value : [];
    if (showAnswer) {
      return (
        <div className="wb-field">
          <div className="wb-label">{label}</div>
          <div className={`wb-readonly ${arr.length ? '' : 'empty'}`}>
            {arr.length ? arr.join(', ') : '—'}
          </div>
        </div>
      );
    }
    function toggle(opt) {
      onChange(arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt]);
    }
    return (
      <div className="wb-field">
        <fieldset className="wb-fieldset">
          <legend className="wb-label">{label}</legend>
          {(options || []).map(opt => {
            const right = showCorrect && isCorrect(correct, opt);
            return (
              <label key={opt} className={`wb-choice ${right ? 'is-correct' : ''}`}>
                <input
                  type="checkbox"
                  checked={preview ? false : arr.includes(opt)}
                  disabled={preview}
                  onChange={preview ? noop : (() => toggle(opt))}
                />
                <span>{opt}</span>
                {right && tick}
              </label>
            );
          })}
        </fieldset>
      </div>
    );
  }

  return null;
}

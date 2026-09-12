import { useMemo, useState } from 'react';
import '../../styles/interactive.css';
import { useAssessmentAnswerKeys } from '../../hooks/useAssessmentAnswerKeys.js';
import { isScorableBlock, isManuallyMarkable, isInactiveBlock } from '../../lib/assessmentScoring.js';
import { labelOf, inputCellsOf } from '../../lib/blockHelpers.js';
import { buildQuestions } from '../../lib/assessmentStructure.js';

// Answer-key entry for an assessment template. Lists every auto-scorable
// question (single-choice, multi-select, short text, table cells) with a
// control to set the correct answer. Saves to assessment_answer_keys. Long-text
// questions are not listed (never auto-scored). Trainer-only — participants
// never read these keys.
// unsavedCount — questions added but not yet saved. A key is stored against a
// block's database id, so a block that exists only in the editor's draft has
// nothing to attach one to. Rather than offer a control that would fail, those
// are left out and the panel says how many and why.
export default function AssessmentAnswerKeyPanel({ sections, blocks, unsavedCount = 0 }) {
  const blockIds = useMemo(() => blocks.map(b => b.id), [blocks]);
  const { keys, points, modes, setKey, setPoints, setMode, clearKey, error } = useAssessmentAnswerKeys(blockIds);
  const [open, setOpen] = useState(false);

  // Grouped by question, so the key rows sit under the same headings and
  // letters the editor and the paper show.
  const { questions, partLabelByBlockId } = useMemo(
    () => buildQuestions(sections, blocks),
    [sections, blocks]
  );

  // Every question that can carry marks at all — auto-scorable OR markable by
  // hand. long_text appears here for the first time: auto-marking refuses it
  // because no machine can judge an essay, which is exactly why manual marking
  // exists. Withdrawn questions are left out; they are not in the paper.
  const markable = useMemo(
    () => blocks.filter(b => !isInactiveBlock(b) && (isScorableBlock(b) || isManuallyMarkable(b))),
    [blocks]
  );
  const isManual = id => modes[id] === 'manual';

  // "Set up" = will actually be marked: either keyed, or marked by hand.
  const setUpCount = markable.filter(b => keys[b.id] != null || isManual(b.id)).length;
  const manualCount = markable.filter(b => isManual(b.id)).length;

  // What the whole assessment is out of. A question counts only once it will be
  // marked — an unkeyed auto question is worth nothing, because nothing decides
  // whether it is right.
  const totalMarks = markable.reduce(
    (sum, b) => sum + ((keys[b.id] != null || isManual(b.id)) ? (Number(points[b.id]) || 1) : 0), 0,
  );

  if (markable.length === 0) {
    return (
      <section className="editor-card answer-key-panel">
        <div className="answer-key-head">
          <h2>🎯 Marking</h2>
          <span className="muted">No answerable questions yet — add one and it will appear here to be marked.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-card answer-key-panel">
      <button type="button" className="answer-key-head answer-key-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="answer-key-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        <h2>🎯 Marking</h2>
        <span className={`answer-key-count ${setUpCount === markable.length ? 'full' : setUpCount === 0 ? 'none' : 'partial'}`}>
          {setUpCount}/{markable.length} set up
        </span>
        {manualCount > 0 && (
          <span className="answer-key-manualcount">✋ {manualCount} manual</span>
        )}
        {totalMarks > 0 && (
          <span className="answer-key-total">{totalMarks} mark{totalMarks === 1 ? '' : 's'} total</span>
        )}
      </button>

      {error && (
        <p className="answer-key-error" role="alert">
          ⚠️ Answer keys aren’t saving — changes won’t persist. {error}
        </p>
      )}

      {open && (
        <div className="answer-key-body">
          <p className="ce-hint">
            Set the correct answer for each objective question. Matching is case-insensitive.
            Leave blank to skip a question (it won't be auto-marked). Marks default to 1;
            questions with several parts award them proportionally, so 3 of 4 pairs right on a
            4-mark question scores 3.
          </p>
          {unsavedCount > 0 && (
            <p className="ce-hint answer-key-unsaved">
              {unsavedCount} new question{unsavedCount === 1 ? ' is' : 's are'} not listed yet —
              keys attach to a saved question. Press <strong>Save changes</strong> above and
              {unsavedCount === 1 ? ' it' : ' they'} will appear here.
            </p>
          )}
          {questions.map(q => {
            const secBlocks = q.blocks.filter(
              b => !isInactiveBlock(b) && (isScorableBlock(b) || isManuallyMarkable(b))
            );
            if (!secBlocks.length) return null;
            return (
              <div key={q.section.id} className="answer-key-section">
                <h3 className="answer-key-section-title">{q.heading}</h3>
                {secBlocks.map(b => (
                  <KeyRow
                    key={b.id}
                    block={b}
                    partLabel={partLabelByBlockId[b.id] ?? null}
                    value={keys[b.id]}
                    points={points[b.id]}
                    mode={isManual(b.id) ? 'manual' : 'auto'}
                    canAuto={isScorableBlock(b)}
                    onChange={k => setKey(b.id, k)}
                    onPoints={p => setPoints(b.id, p)}
                    onMode={m => setMode(b.id, m)}
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

function KeyRow({ block, value, points, mode = 'auto', canAuto = true, partLabel = null, onChange, onPoints, onMode, onClear }) {
  const label = labelOf(block);
  const manual = mode === 'manual';
  const hasKey = value != null;
  // A question carries marks once it will actually be marked — keyed, or set to
  // by-hand. That is the rule the total in the header uses too.
  const willBeMarked = manual || hasKey;

  return (
    <div className={`answer-key-row ${willBeMarked ? 'has-key' : ''} ${manual ? 'is-manual' : ''}`}>
      <div className="answer-key-q">
        {/* The sub-question letter, when the question has more than one part —
            without it, two rows under "Question 3" are indistinguishable. */}
        {partLabel && <span className="answer-key-part">{partLabel}</span>}
        <span className="answer-key-q-label">{label}</span>

        {/* Auto or manual. Long-text questions cannot be auto-marked at all,
            so they are shown as manual with no choice to make rather than
            being offered a switch that only has one working position. */}
        {canAuto ? (
          <div className="mark-mode" role="group" aria-label="How this question is marked">
            <button
              type="button"
              className={`mark-mode-btn ${!manual ? 'active' : ''}`}
              onClick={() => { if (manual) onMode('auto'); }}
              title="Compare the answer against a correct answer you set"
            >
              Auto
            </button>
            <button
              type="button"
              className={`mark-mode-btn ${manual ? 'active' : ''}`}
              onClick={() => { if (!manual) onMode('manual'); }}
              title="You award the marks yourself when you see the answer"
            >
              Manual
            </button>
          </div>
        ) : manual ? (
          <span className="mark-mode-fixed" title="A written answer can only be judged by a person">
            ✋ Manual
          </span>
        ) : (
          /* A written answer has no automatic option, but it is not marked
             until someone says it should be — otherwise it would silently sit
             in the paper worth nothing. One click sets it up. */
          <button
            type="button"
            className="ghost mark-mode-enable"
            onClick={() => onMode('manual')}
            title="A written answer can only be judged by a person"
          >
            + Mark this manually
          </button>
        )}

        {willBeMarked && (
          <label className="answer-key-points" title="What this question is worth">
            <input
              type="number"
              min="0.5"
              step="0.5"
              className="form-input"
              value={points ?? 1}
              onChange={e => onPoints(e.target.value)}
            />
            <span>mark{Number(points ?? 1) === 1 ? '' : 's'}</span>
          </label>
        )}
        {!manual && hasKey && (
          <button type="button" className="answer-key-clear" onClick={onClear} title="Clear key">clear</button>
        )}
      </div>

      <div className="answer-key-control">
        {manual ? (
          <p className="mark-manual-note">
            No correct answer is stored — you award up to {points ?? 1} mark
            {Number(points ?? 1) === 1 ? '' : 's'} yourself, on the session's{' '}
            <strong>📝 Assessment → Live responses</strong> view.
          </p>
        ) : canAuto ? (
          <KeyControl block={block} value={value} onChange={onChange} />
        ) : (
          <p className="mark-manual-note muted">
            Not marked. A written answer can't be checked automatically, so it
            scores nothing until you set it to manual marking.
          </p>
        )}
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

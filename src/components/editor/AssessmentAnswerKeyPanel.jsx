import { Fragment, useMemo, useState } from 'react';
import '../../styles/interactive.css';
import '../../styles/editor/scorecard.css';
import { useAssessmentAnswerKeys } from '../../hooks/useAssessmentAnswerKeys.js';
import { isScorableBlock, isManuallyMarkable, isInactiveBlock } from '../../lib/assessmentScoring.js';
import { labelOf, inputCellsOf } from '../../lib/blockHelpers.js';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { addCriterion, criteriaTotal, hasCriteria, normaliseGuidance } from '../../lib/markingCriteria.js';
import { isPnrQuestion, starterGuidance, starterCriteriaTotal } from '../../lib/pnrQuestion.js';
import MarkingCriteriaEditor from './MarkingCriteriaEditor.jsx';
import CriteriaPushModal from './CriteriaPushModal.jsx';
import { useCriteriaPush } from '../../hooks/useCriteriaPush.js';

// The Scorecard: how every part of an assessment is marked, on a screen of its
// own in the assessment editor (Questions | Scorecard). It used to live in the
// setup slide-over, where a part's label, its Auto/Manual switch, its marks and
// its criteria shared ~740px — question text was cut to a letter and marking
// notes were clipped mid-word.
//
// Layout: a band with the paper total, its split by question, warnings and the
// pass mark; a rail of questions with their sums (and the paper total, which
// stays in view); and each question as a table, one row per part. A part's
// criteria or answer open under its row at full width.
//
// Saves exactly as before — every control writes through the page's ONE shared
// useAssessmentAnswerKeys instance (keysApi). It MUST be shared: the correct
// answer is also marked on the question itself in the editor, and two instances
// would each hold their own copy of the keys, the one that did not write going
// stale. Left optional so the hook is still created here if a caller has no
// reason to share it.
//
// unsavedCount — questions added but not yet saved. A key is stored against a
// block's database id, so a draft block has nothing to attach one to; those are
// left out and the screen says how many and why.
// passMark / onPassMarkChange / onPassMarkCommit — the page's pass mark field,
// edited in the band. passMarkSet false flags a missing one (the report prints
// Result blank without it).
export default function AssessmentAnswerKeyPanel({
  sections, blocks, unsavedCount = 0, keysApi = null, passMarkSet = null,
  passMark = null, onPassMarkChange = null, onPassMarkCommit = null,
}) {
  const blockIds = useMemo(() => blocks.map(b => b.id), [blocks]);
  const ownApi = useAssessmentAnswerKeys(keysApi ? [] : blockIds);
  const { keys, points, modes, guidance, setKey, setPoints, setMode, setGuidance, clearKey, error } =
    keysApi || ownApi;

  // Which parts have their criteria / answer opened under the row.
  const [openParts, setOpenParts] = useState(() => new Set());
  const toggle = id => setOpenParts(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openPart = id => setOpenParts(prev => new Set(prev).add(id));

  // Offering the push is held back until the scorecard has ACTUALLY been
  // changed in this sitting. Saves are debounced per keystroke, so a dialog
  // that appeared on every write would appear while someone was still typing a
  // criterion's name.
  const [touched, setTouched] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const assessmentId = sections?.[0]?.assessment_id || null;
  // Returns nothing for anyone below super trainer — the function refuses them,
  // so the offer simply never appears.
  const { eligible, blocked, pushing, push } = useCriteriaPush(assessmentId, touched);

  function handleGuidance(blockId, g) {
    setTouched(true);
    setGuidance(blockId, g);
  }

  // Grouped by question, so the rows sit under the same headings and letters
  // the editor and the paper show.
  const { questions, labelByBlockId } = useMemo(
    () => buildQuestions(sections, blocks),
    [sections, blocks]
  );

  // Every part that can carry marks at all — auto-scorable OR markable by
  // hand. Withdrawn questions are left out; they are not in the paper.
  const markable = useMemo(
    () => blocks.filter(b => !isInactiveBlock(b) && (isScorableBlock(b) || isManuallyMarkable(b))),
    [blocks]
  );
  const isManual = id => modes[id] === 'manual';

  // "Set up" = will actually be marked: either keyed, or marked by hand.
  const setUpCount = markable.filter(b => keys[b.id] != null || isManual(b.id)).length;
  const manualCount = markable.filter(b => isManual(b.id)).length;

  // A part counts only once it will be marked — an unkeyed auto part is worth
  // nothing, because nothing decides whether it is right.
  const worthOf = b => ((keys[b.id] != null || isManual(b.id)) ? (Number(points[b.id]) || 1) : 0);
  const totalMarks = Math.round(markable.reduce((s, b) => s + worthOf(b), 0) * 10) / 10;

  // Question by question: what each is worth, and which of its parts score
  // nothing for anyone — the parts that quietly drop a paper from 100 to 99.
  const questionSums = questions.map(q => {
    const parts = q.parts.filter(p => !isInactiveBlock(p.block) && (isScorableBlock(p.block) || isManuallyMarkable(p.block)));
    const worth = Math.round(parts.reduce((s, p) => s + worthOf(p.block), 0) * 10) / 10;
    const unscored = parts.filter(p => worthOf(p.block) === 0);
    const withCriteria = parts.filter(p => isManual(p.block.id) && hasCriteria(guidance[p.block.id])).length;
    return { q, parts, worth, unscored, withCriteria };
  }).filter(x => x.parts.length);
  const unscoredAll = questionSums.flatMap(x => x.unscored.map(p => ({ id: p.block.id, sectionId: x.q.section.id, label: p.label })));
  const autoCount = markable.filter(b => !isManual(b.id) && keys[b.id] != null).length;
  const criteriaCount = markable.filter(b => isManual(b.id) && hasCriteria(guidance[b.id])).length;

  // Every part that already has criteria — what "Copy criteria from…" offers.
  const criteriaSources = questionSums.flatMap(x => x.parts
    .filter(p => isManual(p.block.id) && hasCriteria(guidance[p.block.id]))
    .map(p => ({ id: p.block.id, label: labelByBlockId[p.block.id], title: labelOf(p.block), guidance: normaliseGuidance(guidance[p.block.id]) })));

  function jumpTo(sectionId, blockId = null) {
    if (blockId) openPart(blockId);
    requestAnimationFrame(() => {
      const el = document.getElementById(blockId ? `sc-part-${blockId}` : `sc-q-${sectionId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (markable.length === 0) {
    return (
      <section className="sc-screen">
        <p className="sc-empty muted">No answerable questions yet — add one in Questions and it will appear here to be marked.</p>
      </section>
    );
  }

  const passPct = Number(passMark);
  const passHint = passMark === '' || passMark == null || !Number.isFinite(passPct)
    ? 'Not set — the report leaves Result blank.'
    : `${passPct}% of ${totalMarks} = ${Math.round(totalMarks * passPct) / 100} marks`;

  return (
    <section className="sc-screen">
      {/* The paper at a glance: its total, split by question to scale. */}
      <div className="sc-band">
        <div className="sc-band-total">
          <b className="num">{totalMarks}</b>
          <span>mark{totalMarks === 1 ? '' : 's'} in this paper</span>
        </div>
        <div className="sc-band-mid">
          <div className="ak-paper-stack" aria-label="Marks by question">
            {questionSums.filter(x => x.worth > 0).map((x, i) => (
              <span key={x.q.section.id} style={{ flex: x.worth }} className={i % 2 ? 'alt' : ''} data-tip={`${x.q.heading} · ${x.worth} marks`}>
                Q{x.q.number} · {x.worth}
              </span>
            ))}
          </div>
          <div className="ak-paper-chips">
            {unscoredAll.map(u => (
              <button key={u.id} type="button" className="ak-chip warn sc-chip-link" onClick={() => jumpTo(u.sectionId, u.id)}>
                {u.label} scores nothing yet
              </button>
            ))}
            {passMarkSet === false && <span className="ak-chip warn">Pass mark not set</span>}
            <span className="ak-chip">{manualCount} by hand · {autoCount} auto</span>
            {criteriaCount > 0 && <span className="ak-chip">{criteriaCount} with criteria</span>}
            <span className={`ak-chip${setUpCount === markable.length ? '' : ' warn'}`}>{setUpCount} of {markable.length} set up</span>
          </div>
        </div>
        {onPassMarkChange && (
          <div className="sc-pass">
            <label htmlFor="sc-pass-input">Pass mark</label>
            <span className="sc-pass-box">
              <input
                id="sc-pass-input"
                className="form-input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={passMark ?? ''}
                placeholder="—"
                onChange={e => onPassMarkChange(e.target.value)}
                onBlur={() => onPassMarkCommit?.()}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
              />
              %
            </span>
            <span className="sc-pass-hint">{passHint}</span>
          </div>
        )}
      </div>

      {error && (
        <p className="answer-key-error" role="alert">
          ⚠️ Answer keys aren’t saving — changes won’t persist. {error}
        </p>
      )}

      {/* Sessions that haven't started take a scorecard change on their own.
          These are the ones already running, where sending it is a decision
          somebody has to make. */}
      {touched && (eligible.length > 0 || blocked.length > 0) && (
        <div className="cp-bar">
          <span className="cp-bar-what">
            You changed the scorecard.{' '}
            {eligible.length > 0
              ? `${eligible.length} running session${eligible.length === 1 ? '' : 's'} can still take it.`
              : `${blocked.length} running session${blocked.length === 1 ? ' has' : 's have'} started marking and can’t take it.`}
          </span>
          <button type="button" className="ghost" onClick={() => setPushOpen(true)}>
            Review sessions
          </button>
        </div>
      )}
      {pushOpen && (
        <CriteriaPushModal
          eligible={eligible}
          blocked={blocked}
          pushing={pushing}
          onPush={push}
          onClose={() => setPushOpen(false)}
        />
      )}

      {unsavedCount > 0 && (
        <p className="ce-hint answer-key-unsaved">
          {unsavedCount} new question{unsavedCount === 1 ? ' is' : 's are'} not listed yet —
          marks attach to a saved question. Press <strong>Save changes</strong> above and
          {unsavedCount === 1 ? ' it' : ' they'} will appear here.
        </p>
      )}

      <div className="sc-cols">
        <nav className="sc-rail" aria-label="Questions">
          <div className="sc-rail-h">Questions</div>
          {questionSums.map(x => (
            <button key={x.q.section.id} type="button" className="sc-rq" onClick={() => jumpTo(x.q.section.id)}>
              <b>{x.q.heading}</b>
              <span className="sc-rq-sum num">{x.worth}</span>
              {x.unscored.length > 0
                ? <small className="is-warn">{x.unscored.length} part{x.unscored.length === 1 ? '' : 's'} score{x.unscored.length === 1 ? 's' : ''} nothing</small>
                : <small>{x.parts.length} part{x.parts.length === 1 ? '' : 's'}{x.withCriteria ? ` · ${x.withCriteria} with criteria` : ''}</small>}
            </button>
          ))}
          <div className="sc-rail-foot"><span>Paper</span><span className="num">{totalMarks}</span></div>
        </nav>

        <div className="sc-main">
          {questionSums.map(x => (
            <section key={x.q.section.id} id={`sc-q-${x.q.section.id}`} className="sc-q">
              <header className="sc-q-head">
                <h3>{x.q.heading}</h3>
                <span className="sc-q-stem">{stemOf(x.q)}</span>
                {x.unscored.length > 0 && (
                  <span className="ak-chip warn">{x.unscored.length} part{x.unscored.length === 1 ? '' : 's'} score{x.unscored.length === 1 ? 's' : ''} nothing</span>
                )}
                <span className="sc-q-sum num">{x.worth} mark{x.worth === 1 ? '' : 's'}</span>
              </header>
              <table className="sc-parts">
                <thead>
                  <tr><th>Part</th><th>Question</th><th>Type</th><th>Marked</th><th className="r">Marks</th><th>Correct answer / how it’s marked</th></tr>
                </thead>
                <tbody>
                  {x.parts.map(p => (
                    <PartRow
                      key={p.block.id}
                      block={p.block}
                      letter={x.parts.length > 1 ? `(${p.letter})` : ''}
                      value={keys[p.block.id]}
                      points={points[p.block.id]}
                      manual={isManual(p.block.id)}
                      guidance={guidance[p.block.id]}
                      open={openParts.has(p.block.id)}
                      onToggle={() => toggle(p.block.id)}
                      onOpen={() => openPart(p.block.id)}
                      onChange={k => setKey(p.block.id, k)}
                      onPoints={v => setPoints(p.block.id, v)}
                      onMode={m => setMode(p.block.id, m)}
                      onGuidance={g => handleGuidance(p.block.id, g)}
                      onClear={() => clearKey(p.block.id)}
                      copySources={criteriaSources.filter(s => s.id !== p.block.id)}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

// The question's opening words — the scenario a marker recognises it by.
function stemOf(q) {
  const prose = (q.narration || []).find(b => b.block_type === 'prose');
  const raw = prose?.config?.html || prose?.config?.text || '';
  const text = String(raw).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 110 ? `${text.slice(0, 110).trimEnd()}…` : text;
}

const TYPE_NAMES = {
  short_text: 'Short text', long_text: 'Written answer', choice: 'Choice', check_group: 'Tick boxes',
  table: 'Table', fill_blank: 'Fill the blanks', card_sort: 'Card sort', match_pairs: 'Match pairs', reorder: 'Reorder',
};
function typeOf(block) {
  if (block.block_type === 'field') return TYPE_NAMES[block.config?.input_type] || 'Answer box';
  return TYPE_NAMES[block.block_type] || 'Answer';
}

// The types whose correct answer is marked on the question itself. The
// interactive four (fill-blank, card sort, match pairs, reorder) and table cells
// still key here — their controls are whole widgets, not a tick beside an option,
// and moving them is a separate job.
function inlineAnswered(block) {
  if (block?.block_type !== 'field') return false;
  const t = block.config?.input_type;
  return t === 'choice' || t === 'check_group' || t === 'short_text';
}

// One part: a row, and — when opened — its criteria or answer at full width
// beneath it.
function PartRow({
  block, letter, value, points, manual, guidance, open, onToggle, onOpen,
  onChange, onPoints, onMode, onGuidance, onClear, copySources,
}) {
  const canAuto = isScorableBlock(block);
  const hasKey = value != null && !(Array.isArray(value) && value.length === 0);
  // Once a part has criteria, its marks ARE their sum: shown, not editable,
  // or the part's total and its own criteria could disagree.
  const marksFromCriteria = manual && hasCriteria(guidance);
  const nCriteria = normaliseGuidance(guidance).criteria.length;
  // An auto part with no correct answer still shows what it is worth — the
  // figure is held and saved with the answer — and says it scores nothing yet.
  const unkeyedAuto = !manual && canAuto && !hasKey;
  // A written answer nobody has set to manual: not marked at all.
  const unmarkedWritten = !manual && !canAuto;
  const warn = unkeyedAuto || unmarkedWritten;
  const inline = inlineAnswered(block);
  // Inline-answered auto parts have nothing to open: their answer is set on
  // the question in the editor.
  const canOpen = manual || (!inline && canAuto);

  return (
    <Fragment>
      <tr id={`sc-part-${block.id}`} className={`sc-part${warn ? ' is-warn' : ''}${open ? ' is-open' : ''}`}>
        <td className="sc-pl">{letter}</td>
        <td className="sc-pq">{labelOf(block) || <span className="muted">{typeOf(block)}</span>}</td>
        <td className="sc-pt">{typeOf(block)}</td>
        <td>
          {canAuto ? (
            <div className="mark-mode" role="group" aria-label="How this part is marked">
              <button type="button" className={`mark-mode-btn ${!manual ? 'active' : ''}`} onClick={() => { if (manual) onMode('auto'); }} data-tip="Compare the answer against a correct answer you set">Auto</button>
              <button type="button" className={`mark-mode-btn ${manual ? 'active' : ''}`} onClick={() => { if (!manual) onMode('manual'); }} data-tip="You award the marks yourself when you see the answer">Manual</button>
            </div>
          ) : manual ? (
            <span className="mark-mode-fixed" data-tip="A written answer can only be judged by a person">✋ Manual</span>
          ) : (
            <button type="button" className="ghost mark-mode-enable" onClick={() => onMode('manual')}>+ Mark by hand</button>
          )}
        </td>
        <td className="r">
          {!unmarkedWritten && (
            <input
              type="number"
              min="0.5"
              step="0.5"
              className={`form-input sc-marks${marksFromCriteria ? ' is-derived' : ''}`}
              value={points ?? 1}
              readOnly={marksFromCriteria}
              aria-label={marksFromCriteria ? 'Marks — adds up from the criteria' : 'What this part is worth'}
              data-tip={marksFromCriteria ? 'Adds up from the criteria' : 'What this part is worth'}
              onChange={e => { if (!marksFromCriteria) onPoints(e.target.value); }}
            />
          )}
        </td>
        <td className="sc-pa">
          {manual ? (
            nCriteria > 0
              ? <>{nCriteria} criteri{nCriteria === 1 ? 'on' : 'a'} · <button type="button" className="sc-link" onClick={onToggle}>{open ? 'hide' : 'show'}</button></>
              : <>Whole part · <button type="button" className="sc-link" onClick={onToggle}>{open ? 'hide' : 'add criteria'}</button></>
          ) : unmarkedWritten ? (
            <>Not marked — a written answer can’t be checked automatically.</>
          ) : inline ? (
            hasKey
              ? <>Answer: <b>{Array.isArray(value) ? value.join(' + ') : String(value)}</b> · set on the question</>
              : <>No correct answer, so it scores 0 · set it on the question, or mark it by hand</>
          ) : hasKey ? (
            <>Answer set · <button type="button" className="sc-link" onClick={onToggle}>{open ? 'hide' : 'show'}</button>{' '}
              <button type="button" className="sc-link" onClick={onClear}>clear</button></>
          ) : (
            <>{block.block_type === 'reorder' ? 'No order saved' : 'No answer saved'}, so it scores 0 · <button type="button" className="sc-link" onClick={onOpen}>{block.block_type === 'reorder' ? 'set the order' : 'set the answer'}</button></>
          )}
        </td>
      </tr>
      {open && canOpen && (
        <tr className="sc-part-open">
          <td />
          <td colSpan={5}>
            {manual ? (
              <>
                <MarkingCriteriaEditor
                  guidance={guidance}
                  onChange={onGuidance}
                  wide
                  starter={isPnrQuestion(block)
                    ? { label: 'ARDW scheme', guidance: starterGuidance(), total: starterCriteriaTotal() }
                    : null}
                />
                {copySources.length > 0 && <CopyCriteria sources={copySources} guidance={guidance} onCopy={onGuidance} />}
              </>
            ) : (
              <KeyControl block={block} value={value} onChange={onChange} />
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// "Copy criteria from…": every other part that has criteria, each with its
// criteria named. Picking one ADDS its criteria to this part's (new ids, so a
// participant's breakdown can never match a copied row to an old verdict), all
// of them editable afterwards.
function CopyCriteria({ sources, guidance, onCopy }) {
  const [open, setOpen] = useState(false);
  function copy(src) {
    let g = normaliseGuidance(guidance);
    for (const c of src.guidance.criteria) g = addCriterion(g, { label: c.label, marks: c.marks, note: c.note });
    onCopy(g);
    setOpen(false);
  }
  return (
    <div className="sc-copy">
      <button type="button" className="ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        Copy criteria from…
      </button>
      {open && (
        <ul className="sc-copy-list">
          {sources.map(s => (
            <li key={s.id}>
              <button type="button" onClick={() => copy(s)}>
                <b>{s.label}</b>
                <span className="sc-copy-what">{s.title ? `${s.title} · ` : ''}{s.guidance.criteria.map(c => c.label || 'Untitled').join(', ')}</span>
                <span className="num sc-copy-m">{criteriaTotal(s.guidance)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
  // The list shows the authored order whether or not one is saved, and only a
  // move used to save it — so an order written correctly first time looked set
  // and never was. This saves what is on screen.
  const saved = Array.isArray(value) && value.length > 0;
  return (
    <>
    {!saved && (
      <button type="button" className="ak-use-order" onClick={() => onChange(order)}>
        Use this order as the answer
      </button>
    )}
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
    </>
  );
}

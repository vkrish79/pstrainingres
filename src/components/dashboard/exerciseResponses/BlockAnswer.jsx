import { isAnswered, labelOf, inputCellsOf } from '../../../lib/blockHelpers.js';
import { isInteractiveBlock } from '../../../lib/interactiveBlocks.js';
import { earnedFor, pointsFor, manualResultFor } from '../../../lib/assessmentScoring.js';
import { answerKeyText } from '../../../lib/answerKeyText.js';
import Block from '../../blocks/Block.jsx';
import NoteRow from '../NoteRow.jsx';
import CriteriaMarkList from '../CriteriaMarkList.jsx';
import ManualMarkControls from './ManualMarkControls.jsx';

// One participant's answer to one part, with its marking — the tiles' layout,
// or the marking screen's split one (answer left, marking right).
// split — the marking screen's layout: the answer on the left, its marking on
// the right, with the correct answer (auto parts) and, on a part that asks for
// a PNR, the PNR they were given. who — the participant's name, on a By part row.
export default function BlockAnswer({ anchorId = null, block, entry, note, participantId, onSaveNote, onDeleteNote, showNotes = true, answerKey = null, answerPoints = null, questionNumber = null, answerModes = null, markForBlock = null, onMark = null, onComment = null, onBreakdown = null, guidanceForBlock = null, marking = false, reviewMarks = null, split = false, who = null, prepValues = null }) {
  // slot → { right, trainer } for this person and block, when the trainer has
  // right/wrong turned on.
  const review = reviewMarks && reviewMarks.size
    ? slot => reviewMarks.get(`${participantId}|${block.id}|${slot || ''}`) || null
    : null;
  const value = entry?.value;
  const baseLabel = labelOf(block);
  const label = questionNumber != null ? `Q${questionNumber}. ${baseLabel}` : baseLabel;
  const key = answerKey ? answerKey[block.id] : null;
  const points = pointsFor(block.id, answerPoints);
  const manual = answerModes?.[block.id] === 'manual';

  // { state, fraction, earned, possible } — or null when this question isn't
  // marked at all. A manual question is judged by the trainer, so its result
  // comes from what was awarded rather than from a comparison.
  // Criteria turn one verdict into a list of them. A question that has them is
  // only judged once every criterion has one, which manualResultFor reads from
  // the breakdown — so a part-marked question shows as "not marked yet" here
  // and counts as unmarked in every total.
  const criteria = manual ? guidanceForBlock : null;
  const hasCriteria = !!criteria?.criteria?.length;

  const mark = manual
    ? { ...manualResultFor(block.id, points, markForBlock ? { [block.id]: markForBlock } : {}, criteria), possible: points }
    : key != null
      ? earnedFor(block, key, value, points)
      : null;

  const chip = mark && (
        <span className={`exresp-mark exresp-mark-${mark.state}`}>
          {mark.state === 'correct' ? '✓ Correct'
            : mark.state === 'partial' ? '◐ Partly right'
              : mark.state === 'wrong' ? '✗ Incorrect'
                : mark.state === 'unmarked' ? '✋ Not marked yet' : '— Blank'}
          {mark.state !== 'unmarked' && (
            <span className="exresp-mark-score">
              {Math.round(mark.earned * 10) / 10}/{mark.possible}
            </span>
          )}
        </span>
  );

  if (split) {
    // What right looks like: the key on an auto part.
    const expected = !manual && key != null ? answerKeyText(block, key) : '';
    // A part that asks for a PNR, against the PNR they were given.
    const typed = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const given = (prepValues || []).map(v => String(v).trim()).filter(Boolean);
    const asksPnr = /\bpnr\b/i.test(baseLabel || '');
    const pnrCheck = asksPnr && typed && given.length
      ? (given.some(v => typed.includes(v.toUpperCase()))
        ? { ok: true, text: `Matches the PNR they were given (${given.join(', ')})` }
        : { ok: false, text: `They were given ${given.join(', ')}` })
      : null;
    return (
      <div id={anchorId || undefined} className={`exresp-block is-split${who ? ' has-who' : ''} ${mark ? `exresp-block-${mark.state}` : ''}`}>
        <div className="exresp-split-ans">
          {who && <div className="exresp-split-who">{who}</div>}
          {block.block_type === 'field' && <FieldRender label={label} value={value} review={null} />}
          {block.block_type === 'table' && <TableRender block={block} label={label} value={value} review={null} />}
          {isInteractiveBlock(block) && (
            <div className={`exresp-answer ${isAnswered(block, value) ? '' : 'is-blank'}`}>
              <div className="exresp-answer-label">{label}</div>
              {isAnswered(block, value)
                ? <Block block={block} value={value} onChange={() => {}} readOnly />
                : <div className="exresp-answer-value">—</div>}
            </div>
          )}
          {expected && <div className="exresp-expected">Correct answer: <b>{expected}</b></div>}
          {pnrCheck && <div className={`exresp-pnrcheck ${pnrCheck.ok ? 'is-ok' : 'is-off'}`}>{pnrCheck.ok ? '✓ ' : '⚠ '}{pnrCheck.text}</div>}
        </div>
        <div className="exresp-split-mark">
          {chip}
          {manual && onMark && (
            hasCriteria && onBreakdown ? (
              <div className={`exresp-manual ${mark?.state !== 'unmarked' ? 'is-marked' : ''}`}>
                <CriteriaMarkList
                  guidance={criteria}
                  breakdown={markForBlock?.breakdown || null}
                  busy={marking}
                  onChange={b => onBreakdown(participantId, block.id, b, criteria)}
                  onCommentChange={b => onBreakdown(participantId, block.id, b, criteria)}
                />
                {markForBlock?.marked_by_name && <span className="exresp-mark-by">by {markForBlock.marked_by_name}</span>}
              </div>
            ) : (
              <ManualMarkControls
                points={points}
                awarded={markForBlock?.awarded}
                comment={markForBlock?.comment || ''}
                markedBy={markForBlock?.marked_by_name}
                busy={marking}
                onAward={n => onMark(participantId, block.id, n)}
                onClear={() => onMark(participantId, block.id, null)}
                onComment={onComment ? text => onComment(participantId, block.id, text) : null}
              />
            )
          )}
          {!manual && !mark && <span className="muted exresp-split-none">Not marked: no correct answer set in the Scorecard.</span>}
        </div>
      </div>
    );
  }

  return (
    <div id={anchorId || undefined} className={`exresp-block ${mark ? `exresp-block-${mark.state}` : ''}`}>
      {mark && (
        <span className={`exresp-mark exresp-mark-${mark.state}`}>
          {mark.state === 'correct' ? '✓ Correct'
            : mark.state === 'partial' ? '◐ Partly right'
              : mark.state === 'wrong' ? '✗ Incorrect'
                : mark.state === 'unmarked' ? '✋ Not marked yet' : '— Blank'}
          {/* The marks matter most where they aren't all-or-nothing. */}
          {mark.state !== 'unmarked' && (
            <span className="exresp-mark-score">
              {Math.round(mark.earned * 10) / 10}/{mark.possible}
            </span>
          )}
        </span>
      )}

      {/* Marking by hand. ✓ and ✗ are the fast path because most answers are
          plainly one or the other; the box is for everything in between — a
          booking made with meals added but no seats assigned. */}
      {manual && onMark && (
        hasCriteria && onBreakdown ? (
          <div className={`exresp-manual ${mark?.state !== 'unmarked' ? 'is-marked' : ''}`}>
            <CriteriaMarkList
              guidance={criteria}
              breakdown={markForBlock?.breakdown || null}
              busy={marking}
              onChange={b => onBreakdown(participantId, block.id, b, criteria)}
              onCommentChange={b => onBreakdown(participantId, block.id, b, criteria)}
            />
            {/* No question-level comment box here, deliberately. The criteria
                carry their own reasons and the report gathers them into one
                block against the question — a second box would either duplicate
                that or compete with it for the same sentence. */}
            {markForBlock?.marked_by_name && (
              <span className="exresp-mark-by">by {markForBlock.marked_by_name}</span>
            )}
          </div>
        ) : (
          <ManualMarkControls
            points={points}
            awarded={markForBlock?.awarded}
            comment={markForBlock?.comment || ''}
            markedBy={markForBlock?.marked_by_name}
            busy={marking}
            onAward={n => onMark(participantId, block.id, n)}
            onClear={() => onMark(participantId, block.id, null)}
            onComment={onComment ? text => onComment(participantId, block.id, text) : null}
          />
        )
      )}
      {block.block_type === 'field' && <FieldRender label={label} value={value} review={review} />}
      {block.block_type === 'table' && <TableRender block={block} label={label} value={value} review={review} />}
      {isInteractiveBlock(block) && (
        <div className={`exresp-answer ${isAnswered(block, value) ? '' : 'is-blank'}`}>
          <div className="exresp-answer-label">{label}</div>
          {isAnswered(block, value)
            ? <Block block={block} value={value} onChange={() => {}} readOnly />
            : <div className="exresp-answer-value">—</div>}
        </div>
      )}
      {showNotes && (
        <NoteRow
          note={note}
          participantId={participantId}
          blockId={block.id}
          onSaveNote={onSaveNote}
          onDeleteNote={onDeleteNote}
        />
      )}
    </div>
  );
}

function FieldRender({ label, value, review = null }) {
  const display = formatFieldValue(value);
  const mark = review?.('');
  return (
    <div className={`exresp-answer ${display == null ? 'is-blank' : ''}`}>
      <div className="exresp-answer-label">{label}</div>
      <div className="exresp-answer-value">
        {display ?? '—'}
        <AnswerMark mark={mark} />
      </div>
    </div>
  );
}

// What the trainer sees beside an answer once right/wrong is on: a tick, or
// their own answer. No red cross — the trainer is reading, not marking.
function AnswerMark({ mark }) {
  if (!mark) return null;
  if (mark.right) return <span className="exresp-rv-tick" title="Matches your answer">✓</span>;
  return <span className="exresp-rv-model">yours: {mark.trainer}</span>;
}

function TableRender({ block, label, value, review = null }) {
  const cells = inputCellsOf(block);
  const cellMap = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const filledCount = cells.filter(c => cellMap[c.id] != null && String(cellMap[c.id]).trim() !== '').length;
  return (
    <div className="exresp-table-answer">
      <div className="exresp-answer-label">
        {label}
        <span className="exresp-cellcount">{filledCount}/{cells.length}</span>
      </div>
      {cells.length === 0 && <p className="muted" style={{ margin: 0 }}>No input cells.</p>}
      {cells.length > 0 && (
        <table className="exresp-cell-table">
          <tbody>
            {cells.map(c => {
              const v = cellMap[c.id];
              const blank = v == null || String(v).trim() === '';
              return (
                <tr key={c.id} className={blank ? 'is-blank' : ''}>
                  <th>{c.label}</th>
                  <td>
                    {blank ? '—' : String(v)}
                    <AnswerMark mark={review?.(c.id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatFieldValue(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

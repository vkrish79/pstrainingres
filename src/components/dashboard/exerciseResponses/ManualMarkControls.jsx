import { useEffect, useRef, useState } from 'react';

// The by-hand marking control: full, zero, or anything between.
//
// Three states, not two. A question nobody has judged yet is UNMARKED, which
// is deliberately not the same as awarding zero — a half-marked paper must
// read as unfinished rather than as a fail.
export default function ManualMarkControls({ points, awarded, comment = '', markedBy, busy, onAward, onClear, onComment = null }) {
  const [draft, setDraft] = useState('');
  const marked = awarded != null;

  function commitDraft() {
    const n = Number(draft);
    setDraft('');
    if (!Number.isFinite(n)) return;
    // Clamp here rather than trusting the input: the ceiling is the question's
    // marks, which live in another table and can be edited after the fact, so
    // the database deliberately does not enforce it.
    onAward(Math.min(points, Math.max(0, n)));
  }

  return (
    <div className={`exresp-manual ${marked ? 'is-marked' : ''}`}>
      <button
        type="button"
        className={`exresp-mark-btn full ${awarded === points ? 'active' : ''}`}
        disabled={busy}
        onClick={() => onAward(points)}
        title={`Award all ${points} mark${points === 1 ? '' : 's'}`}
      >
        ✓
      </button>
      <button
        type="button"
        className={`exresp-mark-btn none ${awarded === 0 ? 'active' : ''}`}
        disabled={busy}
        onClick={() => onAward(0)}
        title="Award nothing"
      >
        ✗
      </button>
      <label className="exresp-mark-part" title={`Award part marks out of ${points}`}>
        <input
          type="number"
          min="0"
          max={points}
          step="0.5"
          className="form-input"
          placeholder={marked ? String(awarded) : '—'}
          value={draft}
          disabled={busy}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        />
        <span>/ {points}</span>
      </label>
      {marked && (
        <button type="button" className="exresp-mark-undo" disabled={busy} onClick={onClear}>
          undo
        </button>
      )}
      {markedBy && <span className="exresp-mark-by">by {markedBy}</span>}

      {/* Why the mark is what it is. Only once something has been awarded:
          awarded is NOT NULL, so there is no row to hang a comment on until
          then, and a note with no judgement behind it would print in the
          report under a question showing no score. */}
      {marked && onComment && (
        <QuestionComment comment={comment} busy={busy} onComment={onComment} />
      )}
    </div>
  );
}

// The comment on the question as a whole, as opposed to the ones written
// against individual criteria. On a question with criteria this is the
// trainer's overall note; the criteria carry the detail.
function QuestionComment({ comment = '', busy, onComment }) {
  const [note, setNote] = useState(comment);
  const noteRef = useRef(null);
  useEffect(() => {
    if (document.activeElement !== noteRef.current) setNote(comment);
  }, [comment]);

  function commitNote() {
    const next = note.trim();
    if (next === (comment || '').trim()) return; // nothing changed — no write
    onComment(next);
  }

  return (
    <label className="exresp-mark-comment">
      <span className="exresp-mark-comment-label">Comment</span>
      <textarea
        ref={noteRef}
        className="form-input"
        rows={2}
        placeholder="Why these marks? Appears on the participant's report."
        value={note}
        disabled={busy}
        onChange={e => setNote(e.target.value)}
        onBlur={commitNote}
      />
    </label>
  );
}

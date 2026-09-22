import { useEffect, useRef, useState } from 'react';
import {
  resolveMarking, setAllAwards, setCriterionAward, setCriterionComment,
} from '../../lib/markingCriteria.js';

// Marking one question, criterion by criterion.
//
// Each criterion gets the same three verdicts the question used to get as a
// whole: all of its marks, none of them, or a figure typed in between. The
// question's mark is their sum — it is never typed, which is the point. A real
// scheme awards "1 for each name" and "0.5 for each meal", and adding that up
// in your head thirty times is where marking goes wrong.
//
// Nothing is written until the instructor acts, and the question stays UNMARKED
// until every criterion has a verdict. A part-marked question is a real state:
// it must read as unfinished, never as a low score.
export default function CriteriaMarkList({
  guidance, breakdown, busy = false, onChange, onCommentChange,
}) {
  const r = resolveMarking(guidance, breakdown);

  return (
    <div className="cm-list">
      <ul className="cm-rows">
        {r.rows.map(row => (
          <CriterionRow
            key={row.id}
            row={row}
            busy={busy}
            onAward={n => onChange(setCriterionAward(breakdown, row.id, n))}
            onComment={text => onCommentChange(setCriterionComment(breakdown, row.id, text))}
          />
        ))}
      </ul>

      <div className={`cm-foot ${r.complete ? 'is-done' : ''}`}>
        <span className="cm-progress">
          {r.complete
            ? `All ${r.count} criteri${r.count === 1 ? 'on' : 'a'} marked`
            : `${r.markedCount} of ${r.count} marked`}
        </span>
        <span className="cm-bar" aria-hidden="true">
          <i style={{ width: `${r.count ? Math.round((r.markedCount / r.count) * 100) : 0}%` }} />
        </span>
        <span className="cm-total num">
          {r.total}<small> / {r.of}</small>
        </span>
        <span className="cm-shortcuts">
          <button
            type="button"
            className="cm-all"
            disabled={busy}
            onClick={() => onChange(setAllAwards(guidance, breakdown, 1))}
            title="Give every criterion its full marks"
          >
            all ✓
          </button>
          <button
            type="button"
            className="cm-all none"
            disabled={busy}
            onClick={() => onChange(setAllAwards(guidance, breakdown, 0))}
            title="Give every criterion nothing"
          >
            all ✗
          </button>
        </span>
      </div>

      {!r.complete && (
        <p className="cm-hold">
          ✋ Nothing recorded for this question yet — the mark is written once
          every criterion has a verdict. Your marking so far is saved.
        </p>
      )}
    </div>
  );
}

function CriterionRow({ row, busy, onAward, onComment }) {
  // The part-marks box is a local draft committed on blur, like the
  // question-level control it replaces: a write per keystroke would be a write
  // per keystroke.
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(row.comment || '');
  // null = follow the mark, true/false = the instructor said so. Anything less
  // than full marks opens its own comment box: that is the moment there is
  // something to explain, and a reason nobody was asked for is a reason nobody
  // writes. Full marks doesn't, but 💬 is still there if they want to note
  // something for whoever marks next.
  const [noteToggle, setNoteToggle] = useState(null);
  const noteRef = useRef(null);
  const boxRef = useRef(null);

  // Re-sync when the stored comment changes underneath us — a reload, or the
  // focus modal moving to another participant — but never mid-sentence.
  useEffect(() => {
    if (document.activeElement !== noteRef.current) setNote(row.comment || '');
  }, [row.comment]);

  useEffect(() => { if (editing && boxRef.current) boxRef.current.focus(); }, [editing]);

  function commitDraft() {
    const text = draft.trim();
    setDraft('');
    setEditing(false);
    if (text === '') return;               // left empty — no verdict given
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    onAward(Math.min(row.marks, Math.max(0, n)));
  }

  function commitNote() {
    const next = note.trim();
    if (next === (row.comment || '').trim()) return;
    onComment(next);
  }

  const marked = row.awarded != null;
  const fellShort = marked && row.awarded < row.marks;
  const autoOpen = fellShort || !!row.comment;
  const noteOpen = noteToggle == null ? autoOpen : noteToggle;

  return (
    <li className={`cm-row cm-row-${row.state}`}>
      <div className="cm-what">
        <span className="cm-name">{row.label || 'Untitled criterion'}</span>
        {row.note && <span className="cm-note">{row.note}</span>}
      </div>

      <div className="cm-verdict">
        <button
          type="button"
          className={`cm-btn full ${row.state === 'full' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => { setEditing(false); onAward(row.marks); }}
          title={`All ${row.marks} mark${row.marks === 1 ? '' : 's'}`}
        >
          ✓
        </button>
        <button
          type="button"
          className={`cm-btn part ${editing ? 'active' : ''}`}
          disabled={busy}
          onClick={() => { setDraft(''); setEditing(e => !e); }}
          title="Part marks — type what to award"
        >
          ◐
        </button>
        <button
          type="button"
          className={`cm-btn none ${row.state === 'none' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => { setEditing(false); onAward(0); }}
          title="Nothing"
        >
          ✗
        </button>

        {/* An empty box, on purpose: it starts with no figure in it so nothing
            is assumed on the participant's behalf. */}
        {editing && (
          <input
            ref={boxRef}
            type="number"
            min="0"
            max={row.marks}
            step="0.5"
            className="form-input cm-part-input"
            placeholder="—"
            value={draft}
            disabled={busy}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setDraft(''); setEditing(false); } }}
            aria-label={`Marks for ${row.label || 'this criterion'}, out of ${row.marks}`}
          />
        )}

        <button
          type="button"
          className={`cm-btn comment ${row.comment ? 'has' : ''}`}
          disabled={busy}
          onClick={() => setNoteToggle(!noteOpen)}
          aria-expanded={noteOpen}
          title={row.comment ? 'Edit the comment on this criterion' : 'Comment on this criterion'}
        >
          💬
        </button>
      </div>

      <div className="cm-mark num">
        {marked
          ? <>{row.awarded}<small> / {row.marks}</small></>
          : <><span className="cm-todo">—</span><small> / {row.marks}</small></>}
      </div>

      {noteOpen && (
        <div className="cm-comment">
          <input
            ref={noteRef}
            type="text"
            className={`form-input ${fellShort && note.trim() === '' ? 'is-wanted' : ''}`}
            placeholder={
              row.state === 'none'
                ? `Why did ${(row.label || 'this').toLowerCase()} score nothing?`
                : `Why ${row.awarded} of ${row.marks}?`
            }
            value={note}
            disabled={busy}
            onChange={e => setNote(e.target.value)}
            onBlur={commitNote}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            aria-label={`Comment on ${row.label || 'this criterion'}`}
          />
          {/* Only criteria that fell short print on the report, so a comment on
              a full-marks criterion is a note to whoever marks next. Say so
              rather than let it look like it vanished. */}
          {marked && !fellShort && note.trim() !== '' && (
            <span className="cm-comment-hint">
              Full marks — this stays here for the next instructor and won't print
              as an error on the report.
            </span>
          )}
          {fellShort && note.trim() === '' && (
            <span className="cm-comment-hint wanted">
              This is what the participant reads against the marks they lost.
            </span>
          )}
        </div>
      )}
    </li>
  );
}

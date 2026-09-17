// A participant's mark on one answer box after the trainer has gone over it
// with the class. Right answers stay quiet (a tick); a different answer shows
// the trainer's answer, how many matched it, how many shared the participant's
// own answer (only when 2+ did), and a one-tap way to change it. Nothing here
// names or quotes anyone else.

// Slot → mark for one block, from the Map returned by useMyReviewMarks.
export function marksForBlock(marks, blockId) {
  if (!marks || marks.size === 0) return null;
  let out = null;
  for (const [key, mark] of marks) {
    const cut = key.indexOf('|');
    if (key.slice(0, cut) !== blockId) continue;
    (out ||= {})[key.slice(cut + 1)] = mark;
  }
  return out;
}

// audience 'participant' (their marks, with class counts and a way to correct)
// or 'trainer' (their own view of one person's answer: a tick, or their answer).
export default function ReviewMark({ mark, onApply, readOnly = false, compact = false, audience = 'participant' }) {
  if (!mark || !mark.trainer_answer) return null;

  if (mark.right) {
    return (
      <span className="rv-mark rv-right" data-tip={mark.note ? `Matches your trainer. ${mark.note}` : 'Matches your trainer'}>
        <span aria-hidden="true">✓</span>
        <span className="sr-only">Matches your trainer</span>
      </span>
    );
  }

  const answer = mark.trainer_answer;
  const counts = typeof mark.answered === 'number' ? `${mark.right_count} of ${mark.answered} wrote it` : null;
  const likeYou = mark.mine && mark.same_as_me >= 2 ? `${mark.same_as_me} wrote ${mark.mine}, like you.` : '';
  const action = mark.mine ? `Change mine to ${answer}` : `Fill in ${answer}`;

  if (compact) {
    return (
      <button
        type="button"
        className="rv-chip"
        disabled={readOnly}
        onClick={() => onApply?.(answer)}
        data-tip={`${audience === 'trainer' ? 'Your answer' : 'Trainer'}: ${answer}${counts ? ` · ${counts}` : ''}. ${likeYou} ${mark.note || ''}`.replace(/\s+/g, ' ').trim()}
        aria-label={`Trainer's answer ${answer}. ${action}`}
      >
        → {answer}
      </button>
    );
  }

  return (
    <div className="rv-hint" role="note">
      <span className="rv-hint-text">
        {audience === 'trainer' ? 'Your answer' : 'Trainer'}: <b className="rv-answer">{answer}</b>
        {counts && <> · {counts}.</>}{likeYou && <> {likeYou}</>}
      </span>
      {mark.note && <span className="rv-note">{mark.note}</span>}
      {!readOnly && onApply && (
        <button type="button" className="rv-apply" onClick={() => onApply(answer)}>✎ {action}</button>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { ordinal } from '../../lib/ordinal.js';

// The phone's side of "how did I do?" (Participant Experience Pass, P2).
//
// RightAnswerLine — under "Not this time" / "Partly right" at a reveal: what
//   the right answer was. quiz_reveal is a player-callable read that returns
//   nothing until the question's window has shut, so this cannot leak early.
//   A pin question has no words to give; the wall shows the target.
//
// QuizPhoneRecap — the end of the quiz: place out of everyone who played, the
//   points, how many were right, and a strip of the questions; tapping one
//   says what it asked and what the answer was (quiz_my_recap). Every read
//   here is optional: if it fails — the SQL not applied yet, a guest already
//   swept — the screen falls back to the points line it always had.

export function RightAnswerLine({ runId, kind, idx }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!runId || kind === 'pin') { setText(null); return undefined; }
    let gone = false;
    supabase.rpc('quiz_reveal', { p_run_id: runId }).then(({ data, error }) => {
      if (gone || error || !Array.isArray(data)) return;
      setText(answerText(kind, data));
    });
    return () => { gone = true; };
  }, [runId, kind, idx]);
  if (!text) return null;
  return <p className="qlive-answer">{kind === 'order' ? 'The order was' : 'It was'} <strong>{text}</strong></p>;
}

function answerText(kind, options) {
  if (kind === 'order') {
    return [...options]
      .filter(o => o.correct_rank != null)
      .sort((a, b) => a.correct_rank - b.correct_rank)
      .map(o => o.label).join(' → ') || null;
  }
  return options.filter(o => o.is_correct).map(o => o.label).join(' · ') || null;
}

// showPlace is false during the podium: the wall reveals the places one at a
// time, and a phone saying "1st" first would spoil the room's moment.
export function QuizPhoneRecap({ runId, result, showPlace }) {
  const [field, setField] = useState(null);
  const [recap, setRecap] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!runId) return undefined;
    let gone = false;
    supabase.rpc('quiz_standings', { p_run_id: runId }).then(({ data, error }) => {
      if (!gone && !error && Array.isArray(data)) setField(data.length);
    });
    supabase.rpc('quiz_my_recap', { p_run_id: runId }).then(({ data, error }) => {
      if (!gone && !error && Array.isArray(data) && data.length) setRecap(data);
    });
    return () => { gone = true; };
  }, [runId, showPlace]);

  // The placeholder matters: quiz_my_result is a round trip, and rendering the
  // number before it lands would tell everyone they finished with 0 points
  // for a moment. A wrong score is worse than a short wait.
  if (!result) return <h1 className="qlive-big">Counting up…</h1>;

  const right = recap ? recap.filter(q => q.was_correct).length : null;
  const sel = open != null ? recap?.find(q => q.order_index === open) : null;

  return (
    <div className="qlive-recap">
      <p className="qlive-sub">That's the quiz</p>
      {!showPlace ? (
        <h1 className="qlive-big">Watch the screen</h1>
      ) : result.place > 0 ? (
        <h1 className="qlive-big">{ordinal(result.place)}{field ? <span className="qlive-of"> of {field}</span> : null}</h1>
      ) : (
        <h1 className="qlive-big">You finished</h1>
      )}
      <p className="qlive-rank">
        {result.total_points.toLocaleString()} points
        {recap && <> · {right} of {recap.length} right</>}
      </p>

      {recap && (
        <>
          <div className="qlive-strip" role="list" aria-label="Your questions">
            {recap.map(q => {
              const state = !q.answered ? 'none' : q.was_correct ? 'right' : q.points > 0 ? 'part' : 'wrong';
              return (
                <button
                  key={q.order_index}
                  type="button"
                  role="listitem"
                  className={`qlive-strip-q is-${state}${open === q.order_index ? ' is-open' : ''}`}
                  aria-label={`Question ${q.order_index + 1}: ${STATE_WORD[state]}`}
                  aria-expanded={open === q.order_index}
                  onClick={() => setOpen(o => (o === q.order_index ? null : q.order_index))}
                >
                  {q.order_index + 1}
                </button>
              );
            })}
          </div>
          {sel ? (
            <div className="qlive-recap-q">
              <div className="qlive-recap-q-head">Question {sel.order_index + 1} · {STATE_WORD[!sel.answered ? 'none' : sel.was_correct ? 'right' : sel.points > 0 ? 'part' : 'wrong']}</div>
              <div className="qlive-recap-q-prompt">{sel.prompt}</div>
              {sel.answer
                ? <div className="qlive-recap-q-answer">{sel.kind === 'order' ? 'The order was' : 'Answer'}: <strong>{sel.answer}</strong></div>
                : sel.kind === 'pin' && <div className="qlive-recap-q-answer">The answer was the spot shown on the screen.</div>}
            </div>
          ) : (
            <p className="qlive-note qlive-muted">Tap a number to see the right answer.</p>
          )}
        </>
      )}
    </div>
  );
}

const STATE_WORD = { right: 'right', part: 'partly right', wrong: 'not this time', none: 'no answer' };

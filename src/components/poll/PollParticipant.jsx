import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import QuizShape from '../quiz/QuizShape.jsx';
import QuizTimer, { spanSeconds } from '../quiz/QuizTimer.jsx';
import '../../styles/poll-live.css';

// The handset during a poll: SHAPES AND NOTHING ELSE.
//
// The question is on the wall, not in their hand — same rule as the quiz, and
// for the same reason. Sixteen people reading sixteen small copies of a
// question are sixteen people looking down; the trainer wants them looking up.
// (The word cloud will break this rule, deliberately and only there, because
// typing a word means looking down anyway.)
//
// QuizShape is borrowed rather than copied: the four shapes are the room's
// shared vocabulary, so "hit the triangle" has to mean the same thing whether
// what is on the wall is a quiz or a poll. Only the stylesheet is separate.
//
// WHAT THIS SCREEN NEVER SHOWS: how anyone else voted, or how many. There is no
// code path here that could — poll_counts refuses a participant outright. Their
// own vote comes back so the shape they chose stays lit (case 04).
export default function PollParticipant({ run, secondsLeft, onRefresh }) {
  const options = Array.isArray(run?.options) ? run.options : [];
  const [picked, setPicked] = useState(run?.my_vote ?? null);
  const [note, setNote] = useState(null);
  // A vote in flight must beat the two-second refresh, or the shape they just
  // tapped un-lights itself while the server is still being told about it.
  const pending = useRef(false);

  useEffect(() => {
    if (pending.current) return;
    setPicked(run?.my_vote ?? null);
  }, [run?.my_vote, run?.run_id]);

  // A new poll is a clean slate — otherwise the last poll's choice is still lit
  // under the new one's shapes.
  useEffect(() => { setNote(null); }, [run?.run_id]);

  const vote = async (i) => {
    if (!run?.is_open) return;
    const previous = picked;
    // Local state first, before the round trip. A controlled selection that
    // waits for the server visibly snaps back on the next render — the same
    // trap documented in useQuizEditor's setCorrect.
    setPicked(i);
    setNote(null);
    pending.current = true;
    const { data, error } = await supabase.rpc('poll_vote', {
      p_run_id: run.run_id,
      p_option_index: i,
    });
    pending.current = false;
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row?.accepted) {
      setPicked(previous);
      setNote(row?.reason ?? error?.message ?? 'That vote did not go through.');
    }
    onRefresh?.();
  };

  return (
    <div className="plive plive-participant">
      <div className="plive-stage">
        <div className="plive-top">
          <span className="plive-tag">Poll</span>
          {!run?.is_open && <span className="plive-shut">Voting closed</span>}
          {run?.is_open && run?.ends_at && (
            <QuizTimer total={spanSeconds(run.opened_at, run.ends_at)} secondsLeft={secondsLeft} />
          )}
        </div>

        <div
          className={`plive-picks plive-picks-${options.length}`}
          role="group"
          aria-label="Your vote"
        >
          {options.map((label, i) => (
            <button
              key={i}
              type="button"
              // The shape is the identity; the label is what a screen reader
              // reads, since there is no text on this screen to read.
              aria-label={label}
              aria-pressed={picked === i}
              disabled={!run?.is_open}
              className={`plive-pick plive-opt-${i}`
                + (picked === i ? ' is-picked' : '')
                + (picked !== null && picked !== i ? ' is-dimmed' : '')}
              onClick={() => vote(i)}
            >
              <QuizShape index={i} title={label} />
            </button>
          ))}
        </div>

        {note && <p className="plive-note">{note}</p>}
        {!note && run?.is_open && (
          <p className="plive-note plive-muted">
            {picked === null
              ? 'Tap a shape to vote.'
              : 'Vote in. Tap another shape to change it.'}
          </p>
        )}
        {!note && !run?.is_open && (
          <p className="plive-note plive-muted">
            {picked === null
              ? 'Voting closed before you picked one.'
              : 'Voting has closed. Look up at the screen.'}
          </p>
        )}
      </div>
    </div>
  );
}

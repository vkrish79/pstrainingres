import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import QuizShape from '../quiz/QuizShape.jsx';
import QuizTimer, { spanSeconds } from '../quiz/QuizTimer.jsx';
import '../../styles/poll-live.css';

// The handset during a poll: the question, and each shape with its answer.
//
// It used to be shapes and nothing else, on the quiz's old rule that the
// question belongs on the wall. That rule was reversed for the quiz on 7 Oct
// and for the poll in the Participant Experience Pass (P4, 11 Oct): anyone at
// the back of the room, behind a pillar, or in a long room was voting blind.
// The shapes stay, and stay the identity — "hit the triangle" still means the
// same thing on the wall and in the hand.
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

        {run?.question && <h1 className="plive-q">{run.question}</h1>}

        <div
          className={`plive-picks plive-picks-${options.length}`}
          role="group"
          aria-label="Your vote"
        >
          {options.map((label, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={picked === i}
              disabled={!run?.is_open}
              className={`plive-pick plive-opt-${i}`
                + (picked === i ? ' is-picked' : '')
                + (picked !== null && picked !== i ? ' is-dimmed' : '')}
              onClick={() => vote(i)}
            >
              <QuizShape index={i} />
              <span className="plive-pick-label">{label}</span>
            </button>
          ))}
        </div>

        {note && <p className="plive-note">{note}</p>}
        {!note && run?.is_open && (
          <p className="plive-note plive-muted">
            {picked === null
              ? 'Tap an answer to vote.'
              : 'Vote in. Tap another to change it.'}
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

// The few seconds after the trainer takes a poll down, before the workbook
// comes back (ParticipantWorkbookPage holds it). Says the vote was counted;
// the results themselves are the wall's, never the handset's.
export function PollThanks({ voted, onDone }) {
  return (
    <div className="plive plive-participant">
      <div className="plive-stage plive-thanks">
        <h1 className="plive-q">{voted ? 'Thanks — your vote is in' : 'That poll has closed'}</h1>
        <p className="plive-note plive-muted">Back to your workbook in a moment.</p>
        <button type="button" className="plive-back" onClick={onDone}>Back to my workbook</button>
      </div>
    </div>
  );
}

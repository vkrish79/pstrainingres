import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import { ordinal } from '../../lib/ordinal.js';
import '../../styles/quiz-live.css';

const LETTERS = ['A', 'B', 'C', 'D'];

// What a participant sees on their own device.
//
// It always carries the question, not just the four buttons. Half the room may
// be remote with no projector, and the plan settled on ONE participant UI
// rather than two that drift apart.
//
// Nothing here can reveal the answer, because nothing here is ever told it:
// quiz_current() returns labels only, and quiz_answer() deliberately does not
// say whether you were right. Correctness arrives at the reveal, for everyone
// at once — telling an early answerer sooner lets them tell the person beside
// them while the clock is still running.
export default function QuizParticipant({ runId, onDismiss }) {
  const { run, secondsLeft } = useQuizRun(runId);
  const [picked, setPicked] = useState(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);

  const phase = run?.phase;
  const idx = run?.current_index ?? -1;

  // A new question clears the last one's answer and verdict.
  useEffect(() => { setPicked(null); setNote(''); setResult(null); }, [idx]);

  useEffect(() => {
    if (!['reveal', 'leaderboard', 'podium', 'ended'].includes(phase)) return;
    supabase.rpc('quiz_my_result', { p_run_id: runId }).then(({ data }) => {
      setResult(Array.isArray(data) ? data[0] : data);
    });
  }, [phase, runId, idx]);

  async function answer(optionId) {
    if (picked || sending) return;
    setSending(true);
    // Locked immediately, before the round trip. On a slow connection an
    // unresponsive button gets pressed again, and the second press is the one
    // that would be refused — leaving the screen saying nothing happened when
    // the first press was in fact recorded.
    setPicked(optionId);
    const { data, error } = await supabase.rpc('quiz_answer', {
      p_run_id: runId, p_option_id: optionId,
    });
    setSending(false);
    const row = Array.isArray(data) ? data[0] : data;
    if (error) { setPicked(null); setNote(error.message); return; }
    if (row && row.accepted === false) {
      // 'too late' and 'already answered' are both final; the pick stays shown.
      setNote(row.reason === 'too late' ? 'Time was up' : row.reason);
      return;
    }
    setNote('Answer locked in');
  }

  return (
    <div className="qlive qlive-participant">
      {phase === 'lobby' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">Quiz starting</h1>
          <p className="qlive-sub">Wait for the first question.</p>
        </div>
      )}

      {phase === 'ready' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-count">{Math.ceil(secondsLeft ?? 0)}</h1>
          <p className="qlive-sub">Get ready…</p>
        </div>
      )}

      {phase === 'question' && (
        <div className="qlive-stage">
          <div className="qlive-qhead">
            <h1 className="qlive-prompt">{run?.prompt}</h1>
            <div className="qlive-timer" aria-label="Seconds remaining">{Math.ceil(secondsLeft ?? 0)}</div>
          </div>
          <div className="qlive-picks">
            {(run?.options ?? []).map((o, i) => (
              <button
                key={o.id}
                type="button"
                className={`qlive-pick qlive-opt-${i}${picked === o.id ? ' is-picked' : ''}${picked && picked !== o.id ? ' is-dimmed' : ''}`}
                disabled={!!picked || sending}
                onClick={() => answer(o.id)}
              >
                <span className="qlive-letter">{LETTERS[i]}</span>
                <span className="qlive-label">{o.label}</span>
              </button>
            ))}
          </div>
          {note && <p className="qlive-note">{note}</p>}
          {!note && !picked && <p className="qlive-note qlive-muted">Answer quickly — speed counts.</p>}
        </div>
      )}

      {['reveal', 'leaderboard'].includes(phase) && (
        <div className="qlive-stage qlive-centre">
          {result?.answered === false ? (
            <>
              <h1 className="qlive-big">No answer</h1>
              <p className="qlive-sub">You did not answer that one. Zero for this question.</p>
            </>
          ) : (
            <>
              <h1 className={`qlive-big ${result?.was_correct ? 'is-right' : 'is-wrong'}`}>
                {result?.was_correct ? 'Correct' : 'Not this time'}
              </h1>
              <p className="qlive-sub">
                {result?.was_correct ? `+${result.points} points` : 'No points for that one'}
              </p>
            </>
          )}
          {/* Your own rank, on your own screen. The wall shows only the top
              five, so nobody is publicly shown to be last. */}
          {result && (
            <p className="qlive-rank">
              {result.total_points} points
              {result.place > 0 && <> · {ordinal(result.place)} so far</>}
            </p>
          )}
        </div>
      )}

      {['podium', 'ended'].includes(phase) && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">That's the quiz</h1>
          {result && (
            <p className="qlive-rank">
              You finished with {result.total_points} points.
            </p>
          )}
          <p className="qlive-sub">It was a knowledge check — the score is not recorded anywhere.</p>
          <button type="button" className="qlive-go" onClick={onDismiss}>Back to my workbook</button>
        </div>
      )}
    </div>
  );
}

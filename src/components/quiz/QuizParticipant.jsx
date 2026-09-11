import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import { ordinal } from '../../lib/ordinal.js';
import { shapeFor } from '../../lib/quizShapes.js';
import QuizShape from './QuizShape.jsx';
import '../../styles/quiz-live.css';

// What a participant sees on their own device: FOUR SHAPES. Nothing else.
//
// The question and its four answers are on the projector, where the room reads
// them together. Repeating them on sixteen handsets makes everyone look down at
// the moment they should be looking up, and turns one shared question into
// sixteen private ones.
//
// THE TRADE, stated plainly: a REMOTE participant has no projector, so they
// would see four shapes and nothing to answer. This is an in-room design, on
// instruction. If remote cohorts ever run, the labels have to come back for
// them — which is a branch here, not a rewrite.
//
// Nothing here can reveal the answer, because nothing here is ever told it:
// quiz_current() returns labels only, and quiz_answer() deliberately does not
// say whether you were right. Correctness arrives at the reveal, for everyone
// at once — telling an early answerer sooner lets them tell the person beside
// them while the clock is still running.
export default function QuizParticipant({ runId, onDismiss }) {
  const { run, secondsLeft } = useQuizRun(runId);
  const [picked, setPicked] = useState(null);
  // The sequence being built for a reorder question: option ids, in tap order.
  const [seq, setSeq] = useState([]);
  const [sending, setSending] = useState(false);
  // An ordering is sitting on the server for this question. NOT cleared by
  // "Start again": starting again clears the sequence on screen, and the
  // answer already sent goes on counting until a new one replaces it.
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);

  const phase = run?.phase;
  const idx = run?.current_index ?? -1;

  // A new question clears the last one's answer and verdict.
  useEffect(() => { setPicked(null); setSeq([]); setSubmitted(false); setNote(''); setResult(null); }, [idx]);

  useEffect(() => {
    if (!['reveal', 'leaderboard', 'podium', 'ended'].includes(phase)) return;
    supabase.rpc('quiz_my_result', { p_run_id: runId }).then(({ data }) => {
      setResult(Array.isArray(data) ? data[0] : data);
    });
  }, [phase, runId, idx]);

  // Changeable until the clock stops. Gated on `sending` alone — gating on
  // `picked` as well, as this did, means the first tap is the only tap.
  //
  // Changing is not free: the server re-stamps the clock on every change, so
  // a mind changed at nineteen seconds scores as a nineteen-second answer.
  // That is what stops the winning move being to slap a shape instantly and
  // fix it later.
  async function answer(optionId) {
    if (sending) return;
    const previous = picked;
    setSending(true);
    // Shown immediately, before the round trip. On a slow connection an
    // unresponsive button gets pressed again, and the second press is the one
    // that would be refused — leaving the screen saying nothing happened when
    // the first press was in fact recorded.
    setPicked(optionId);
    const { data, error } = await supabase.rpc('quiz_answer', {
      p_run_id: runId, p_option_id: optionId,
    });
    setSending(false);
    const row = Array.isArray(data) ? data[0] : data;
    // Back to whatever was chosen BEFORE this tap, and not to nothing: a
    // refused CHANGE must not leave the screen blank while an earlier answer
    // is still sitting on the server, counting.
    if (error) { setPicked(previous); setNote(error.message); return; }
    if (row && row.accepted === false) {
      setPicked(previous);
      setNote(row.reason === 'too late' ? 'Time was up' : row.reason);
      return;
    }
    setNote('Answer in. Tap another shape to change it.');
  }

  // TAP IN ORDER, not drag. Dragging on a phone is fiddly at the best of
  // times, and this is someone rushing under a clock in a room — a mis-drag
  // costs the question. Tapping is one gesture everybody already has.
  //
  // The fourth tap submits: with four items the last one is forced anyway, so
  // a confirm step would only add a tap to every answer. "Start again" clears
  // the sequence and is available AFTER submitting too — the ordering already
  // sent stands until a new one is finished, so an abandoned second attempt
  // costs nothing.
  async function tapItem(optionId) {
    if (sending || seq.includes(optionId)) return;
    const next = [...seq, optionId];
    setSeq(next);
    const all = run?.options ?? [];
    if (next.length < all.length) return;

    setSending(true);
    const { data, error } = await supabase.rpc('quiz_answer_order', {
      p_run_id: runId, p_option_ids: next,
    });
    setSending(false);
    const row = Array.isArray(data) ? data[0] : data;
    // The sequence stays on screen either way: it is what they built, and
    // "Start again" is right there if they want another go.
    if (error) { setNote(error.message); return; }
    if (row && row.accepted === false) {
      setNote(row.reason === 'too late' ? 'Time was up' : row.reason);
      return;
    }
    setSubmitted(true);
    setNote('Order in. Start again to change it.');
  }

  return (
    <div className="qlive qlive-participant">
      {phase === 'lobby' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">Quiz starting</h1>
          <p className="qlive-sub">Watch the screen at the front.</p>
        </div>
      )}

      {phase === 'ready' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-count">{Math.ceil(secondsLeft ?? 0)}</h1>
          <p className="qlive-sub">Get ready…</p>
        </div>
      )}

      {phase === 'question' && (
        <div className="qlive-stage qlive-answer">
          {/* The clock, and nothing else above the shapes. No question text and
              no answer wording: both are on the projector, and a participant
              should be reading them there rather than looking down. */}
          <div className="qlive-answer-top">
            <span className="qlive-qnum">Question {idx + 1}</span>
            <div className="qlive-timer" aria-label="Seconds remaining">{Math.ceil(secondsLeft ?? 0)}</div>
          </div>
          {run?.kind === 'order' ? (
            <>
              {/* The sequence so far, so a thumb can see what it has chosen
                  without reading the question — which is on the wall. */}
              <ol className="qlive-seq">
                {(run?.options ?? []).map((_, slot) => {
                  const chosenId = seq[slot];
                  const chosen = (run?.options ?? []).findIndex(o => o.id === chosenId);
                  return (
                    <li key={slot} className={`qlive-seq-slot${chosenId ? ' is-filled' : ''}`}>
                      <span className="qlive-seq-num">{slot + 1}</span>
                      {chosenId
                        ? <span className={`qlive-seq-shape qlive-opt-${chosen}`}><QuizShape index={chosen} /></span>
                        : <span className="qlive-seq-empty" aria-hidden="true" />}
                    </li>
                  );
                })}
              </ol>
              <div className="qlive-picks qlive-picks-bare">
                {(run?.options ?? []).map((o, i) => {
                  const used = seq.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`qlive-pick qlive-pick-bare qlive-opt-${i}${used ? ' is-dimmed' : ''}`}
                      disabled={used || sending}
                      onClick={() => tapItem(o.id)}
                      aria-label={`${shapeFor(i).label}${used ? `, placed ${seq.indexOf(o.id) + 1}` : ''}`}
                    >
                      <QuizShape index={i} />
                    </button>
                  );
                })}
              </div>
              {note && <p className="qlive-note">{note}</p>}
              {!note && (
                <p className="qlive-note qlive-muted">
                  {seq.length > 0
                    ? `${seq.length} of ${(run?.options ?? []).length} placed`
                    : submitted
                      // Said out loud, because an empty row of slots after
                      // "Start again" looks exactly like having no answer.
                      ? 'Your last order still counts until you finish a new one.'
                      : 'Tap the shapes in order — speed counts.'}
                </p>
              )}
              {seq.length > 0 && !sending && (
                <button
                  type="button"
                  className="ghost qlive-restart"
                  onClick={() => { setSeq([]); setNote(''); }}
                >
                  Start again
                </button>
              )}
            </>
          ) : (
            <>
              <div className="qlive-picks qlive-picks-bare">
                {(run?.options ?? []).map((o, i) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`qlive-pick qlive-pick-bare qlive-opt-${i}${picked === o.id ? ' is-picked' : ''}${picked && picked !== o.id ? ' is-dimmed' : ''}`}
                    disabled={sending}
                    onClick={() => answer(o.id)}
                    // The shape's name is now the ONLY name this control has, so
                    // it has to be the accessible one — there is no visible text
                    // left for a screen reader to fall back on.
                    aria-label={shapeFor(i).label}
                  >
                    <QuizShape index={i} />
                  </button>
                ))}
              </div>
              {note && <p className="qlive-note">{note}</p>}
              {!note && !picked && <p className="qlive-note qlive-muted">Tap your answer — speed counts.</p>}
            </>
          )}
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
          {/* The score, and the way out. Nothing else — the room is looking at
              the podium, and this screen has one thing to tell its owner.

              The placeholder matters: quiz_my_result is a round trip, and
              rendering the number before it lands would tell everyone they
              finished with 0 points for a moment. A wrong score is worse than
              a short wait. */}
          <h1 className="qlive-big">
            {result ? `You finished with ${result.total_points} points` : 'Counting up…'}
          </h1>
          <button type="button" className="qlive-go" onClick={onDismiss}>Back to my workbook</button>
        </div>
      )}
    </div>
  );
}

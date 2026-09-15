import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import { ordinal } from '../../lib/ordinal.js';
import { shapeFor } from '../../lib/quizShapes.js';
import QuizShape from './QuizShape.jsx';
import QuizPinField from './QuizPinField.jsx';
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
// `guest` marks somebody who joined a standalone quiz by scanning a code.
// They have no workbook to be sent back to, and by the time this screen is
// drawn their account has already been deleted — so the ending is a full
// stop rather than a door.
export default function QuizParticipant({ runId, onDismiss, guest = false }) {
  const { run, secondsLeft, loading } = useQuizRun(runId);
  const [picked, setPicked] = useState(null);
  // What this participant is staking on a wager question. 1 unless they raise
  // it, so doing nothing is always the ordinary question.
  const [stake, setStake] = useState(1);
  // The sequence being built for a reorder question: option ids, in tap order.
  const [seq, setSeq] = useState([]);
  // Where this person has put their pin, in the picture's own coordinates.
  const [myPin, setMyPin] = useState(null);
  // The latest place the finger was, and whether a request is already out.
  // Refs rather than state: they are read inside an async loop, where a
  // captured state value would be the one from the render that started it.
  const pendingPin = useRef(null);
  const pinInFlight = useRef(false);
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
  useEffect(() => { setPicked(null); setStake(1); setSeq([]); setMyPin(null); setSubmitted(false); setNote(''); setResult(null); pendingPin.current = null; pinInFlight.current = false; }, [idx]);

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
      p_run_id: runId, p_option_id: optionId, p_wager: stake,
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

  // DROPPING A PIN. The one type where the participant's own screen carries
  // the question — because the answer is a place on a picture, and a handset
  // showing shapes would have nothing to tap.
  //
  // Submits on the tap rather than behind a Confirm button, and the pin can be
  // moved until the clock stops. That is the same bargain every other type
  // makes: an answer can be changed, and changing it re-stamps the clock, so
  // there is no free late correction.
  // NO TAP IS EVER DROPPED. This used to open with `if (sending) return`,
  // which meant that while one position was in flight the next one was thrown
  // away — so moving the pin twice in quick succession did nothing the second
  // time, and on a phone in a room that reads as the screen being broken.
  //
  // Instead the latest position is always remembered and always drawn, and the
  // sender loops until there is nothing newer. At most ONE request is in
  // flight, and what it carries is the most recent place the finger was, not
  // the oldest one queued. A pin dragged across the map is one request on
  // release, not thirty.
  //
  // The screen is never rolled back on failure either. The pin is where they
  // put it; if the server refused the position, saying so is the note's job,
  // and moving their pin for them would be a second lie on top of the first.
  async function dropPin({ x, y }) {
    setMyPin({ x, y });                 // under the thumb at once, not a round trip later
    pendingPin.current = { x, y };
    if (pinInFlight.current) return;    // the loop below will pick this up

    pinInFlight.current = true;
    try {
      while (pendingPin.current) {
        const p = pendingPin.current;
        pendingPin.current = null;
        const { data, error } = await supabase.rpc('quiz_answer_pin', {
          p_run_id: runId, p_x: p.x, p_y: p.y, p_wager: stake,
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (error) { setNote(error.message); continue; }
        if (row && row.accepted === false) {
          setNote(row.reason === 'too late' ? 'Time was up' : row.reason);
          continue;
        }
        setNote('Pin in. Drag it to move it.');
      }
    } finally {
      pinInFlight.current = false;
    }
  }

  // Raising or lowering the stake. If an answer is already in, the stake has to
  // go back to the server with it — the score is computed there and a
  // multiplier held only on this phone would be a number nobody is counting.
  //
  // Re-sending also re-stamps the clock, which is the intended cost: raising to
  // 3x at nineteen seconds is scored as a nineteen-second answer, so there is
  // no free late nerve.
  async function chooseStake(n) {
    if (sending || n === stake) return;
    const previous = stake;
    setStake(n);
    if (!picked && !myPin) return;    // nothing to re-score until they answer
    setSending(true);
    // A pin is re-sent to the same effect: the stake is scored where the
    // answer is, and the re-send re-stamps the clock exactly as it does for a
    // shape.
    const { data, error } = myPin
      ? await supabase.rpc('quiz_answer_pin', {
        p_run_id: runId, p_x: myPin.x, p_y: myPin.y, p_wager: n,
      })
      : await supabase.rpc('quiz_answer', {
        p_run_id: runId, p_option_id: picked, p_wager: n,
      });
    setSending(false);
    const row = Array.isArray(data) ? data[0] : data;
    if (error) { setStake(previous); setNote(error.message); return; }
    if (row && row.accepted === false) {
      setStake(previous);
      setNote(row.reason === 'too late' ? 'Time was up' : row.reason);
      return;
    }
    setNote(n === 1
      ? 'Playing it safe — nothing to lose at 1×.'
      : `Staked ${n}× — win or lose ${n} times as much.`);
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

  // The stake, ABOVE the answer and available before answering. Choosing it
  // first costs nothing; choosing it after deciding what you want is the whole
  // point — the bet is on how sure you are of your OWN answer, not a blind
  // gamble.
  //
  // Written once and used by both answer shapes. A pin question is right or
  // wrong exactly as a shape is, so it takes a stake exactly as a shape does,
  // and the trainer's checkbox says nothing about which type it is on.
  const stakeRow = run?.allow_wager ? (
    <div className="qlive-stake">
      {/* Says the safe option is safe. Without it the honest read of three
          buttons is that all three are bets, and the cautious play becomes not
          answering at all. */}
      <p className="qlive-stake-label">How sure are you? <span className="qlive-muted">1× risks nothing</span></p>
      <div className="qlive-stake-row" role="group" aria-label="Your stake">
        {[1, 2, 3].map(n => (
          <button
            key={n}
            type="button"
            className={`qlive-stake-btn${stake === n ? ' is-on' : ''}`}
            disabled={sending}
            aria-pressed={stake === n}
            onClick={() => chooseStake(n)}
          >
            {n}×
          </button>
        ))}
      </div>
    </div>
  ) : null;

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

      {/* The clip is playing in the room, out loud, from the projector. NOT
          on this phone: sixteen handsets playing the same announcement a
          half-second apart is not a question, it is a noise — and quiz-audio
          is shut to participants so this screen could not fetch it anyway.
          All it has to do is stop anyone looking down. */}
      {phase === 'listen' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big" aria-hidden="true">♪</h1>
          <p className="qlive-sub">Listen — answers open when the clip ends.</p>
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
          {run?.kind === 'pin' ? (
            <>
              {stakeRow}
              {/* The exception to "the handset shows shapes and nothing else",
                  and the only one. The answer IS a place on this picture, so
                  the picture has to be here — there is nothing else to tap.
                  The question itself is still on the wall, where the room
                  reads it together. */}
              <QuizPinField
                path={run?.map_path}
                onPick={dropPin}
                myPin={myPin}
                /* NOT busy={sending}. `sending` belongs to the shape and
                   sequence answers, and passing it here made the pad go inert
                   for the length of every round trip — the third reason this
                   question felt dead in the hand. The pad is now never
                   disabled: dropPin coalesces instead of refusing. */
                className="qlive-pin-answer"
                label="Where you think it is"
              />
              {note && <p className="qlive-note">{note}</p>}
              {!note && !myPin && <p className="qlive-note qlive-muted">Press the picture, and drag to aim — speed counts.</p>}
            </>
          ) : run?.kind === 'order' ? (
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
              {stakeRow}
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
              {/* A wager can make this a LOSS, so the sign is not decoration.
                  points already carries it; the minus is rendered as a real
                  minus sign rather than a hyphen. */}
              <p className="qlive-sub">
                {result?.was_correct
                  ? `+${result.points} points`
                  : result?.points < 0
                    ? `${String(result.points).replace('-', '−')} points`
                    : 'No points for that one'}
                {result?.wager > 1 && <> · you staked {result.wager}×</>}
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
          <button type="button" className="qlive-go" onClick={onDismiss}>{guest ? 'Done' : 'Back to my workbook'}</button>
        </div>
      )}

      {/* THE WAY OUT WHEN THERE IS NO PHASE AT ALL.
          Every block above is keyed to a phase, so a run this handset can no
          longer read — deleted, retention-slimmed, or refused by RLS — rendered
          an empty dark screen with nothing on it and no way back. A participant
          could not leave without knowing to reload the page.

          The known cause was the trainer abandoning a quiz, which is fixed at
          the other end now. This is the backstop for every other cause,
          including the ones not thought of yet: if this screen cannot say what
          is happening, it must at least let go of the person reading it. */}
      {/* `loading` is load-bearing: without it this flashes "the quiz has
          finished" at everyone for the moment before the first read lands. */}
      {!phase && !loading && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">The quiz has finished</h1>
          <p className="qlive-sub">{guest ? 'Thanks for playing.' : 'Nothing more to answer here.'}</p>
          <button type="button" className="qlive-go" onClick={onDismiss}>{guest ? 'Done' : 'Back to my workbook'}</button>
        </div>
      )}
    </div>
  );
}

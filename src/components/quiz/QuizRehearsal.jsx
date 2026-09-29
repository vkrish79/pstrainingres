import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuizPlayback } from '../../hooks/useQuizPlayback.js';
import {
  scoreChoice, scorePin, scoreOrder, orderIsSubmittable, ORDER_IS_FINAL,
} from '../../lib/quizRehearsalScore.js';
import { shapeFor } from '../../lib/quizShapes.js';
import { scaleClass } from '../../lib/quizScale.js';
import QuizShape from './QuizShape.jsx';
import QuizImage from './QuizImage.jsx';
import QuizPinField from './QuizPinField.jsx';
import QuizTimer from './QuizTimer.jsx';
import '../../styles/quiz-live.css';
import '../../styles/quiz-rehearsal.css';

// Playing your own quiz, alone, before anybody else sees it.
//
// NOTHING HERE TOUCHES THE DATABASE except the one read that fetches the
// questions. There is no quiz_runs row, no join code, no guest account and no
// answer written anywhere — which is the entire point: a trainer checking
// their own slides should not have to open a room, and should not leave one
// open behind them. It also means there is nothing to end and nothing to
// clean up when they close it.
//
// WHY THIS IS NOT QuizProjector WITH A FLAG. The projector reads every fact it
// shows off useQuizRun(runId) and moves through quiz_set_phase — it is a view
// onto server state by construction, and threading a second source through it
// would put a branch in every one of those reads for the benefit of a surface
// nobody but the trainer ever sees. What the two genuinely share is the LOOK,
// and that lives in quiz-live.css, which this file uses unchanged: the same
// four answer colours, the same shapes, the same timer ring, the same reveal.
// A rehearsal that drifted from the room visually would be worthless, and the
// stylesheet is what stops it.
//
// THE CLOCK IS THE BROWSER'S, and that is correct here and nowhere else. A
// real run measures against the server because the server is the only clock
// every handset agrees on (and is ~32s ahead of this laptop — see
// project_server_clock_ahead_of_laptop). A rehearsal has exactly one clock and
// one player, so the skew has nothing to be wrong about.
//
// THERE IS NO PRE-ROLL. A real run counts a room down from three so sixteen
// people can look up from their phones. One player is already looking, so the
// wall carries a Start button instead and the question opens on the click.

export default function QuizRehearsal({ quizId, title, onExit }) {
  const { loading, error, quiz, questions } = useQuizPlayback(quizId);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState('ready');   // ready | question | reveal | done
  const [picked, setPicked] = useState(null);    // option id, for choice/boolean
  const [seq, setSeq] = useState([]);            // option ids, for order
  const [pin, setPin] = useState(null);          // { x, y }, for pin
  const [stake, setStake] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState(null);    // { points, exact, correct, … }
  const [total, setTotal] = useState(0);

  // When the clock started, and where it had got to when the answer landed.
  // Both are refs rather than state: the 200ms tick reads them and setting
  // state in there would re-render the whole wall five times a second.
  const startedRef = useRef(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef(null);

  const q = questions[idx] || null;
  const limit = q?.time_limit_seconds ?? 20;
  const total_ = questions.length;

  const stopClock = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // What the answer is worth, given when it landed. Pulled out because both
  // the clock running out and the trainer closing the question early need it,
  // and the two must not compute it differently.
  const settle = useCallback(() => {
    stopClock();
    if (!q) return;
    const elapsedMs = elapsedRef.current;
    let scored;

    if (q.kind === 'order') {
      const want = (q.quiz_options || []).slice().sort((a, b) => (a.correct_rank ?? 0) - (b.correct_rank ?? 0));
      // HALF A SEQUENCE IS NOT AN ANSWER. quiz_answer_order refuses an
      // incomplete ordering outright, so nothing is recorded and the question
      // scores nothing — it does NOT earn partial credit for the slots that
      // happened to be filled.
      const submitted = orderIsSubmittable(seq.length, want.length);
      const right = submitted
        ? seq.reduce((n, id, slot) => (want[slot]?.id === id ? n + 1 : n), 0)
        : 0;
      scored = submitted
        ? scoreOrder({ right, total: want.length, elapsedMs, limitSeconds: limit })
        : { points: 0, wager: 1 };
      setResult({
        ...scored,
        correct: submitted && right === want.length,
        right,
        of: want.length,
        answered: submitted,
      });
      setTotal(t => t + scored.points);
      setPhase('reveal');
      return;
    }

    if (q.kind === 'pin') {
      // Inside the target ellipse or outside it — binary, exactly as a shape
      // is. QuizParticipant says so where it decides a pin takes a stake:
      // "a pin question is right or wrong exactly as a shape is".
      //
      // A TARGET THAT WAS NEVER MARKED is refused by the server rather than
      // scored, so nobody is told they missed a question nobody could hit.
      const marked = q.pin_x != null && q.pin_rx != null;
      const hit = marked && pin != null
        && (((pin.x - q.pin_x) / q.pin_rx) ** 2)
         + (((pin.y - q.pin_y) / (q.pin_ry || q.pin_rx)) ** 2) <= 1;
      scored = marked && pin != null
        ? scorePin({ correct: hit, elapsedMs, limitSeconds: limit, stake, allowWager: q.allow_wager })
        : { points: 0, wager: 1 };
      setResult({ ...scored, correct: hit, answered: marked && pin != null, unmarked: !marked });
      setTotal(t => t + scored.points);
      setPhase('reveal');
      return;
    }

    const chosen = (q.quiz_options || []).find(o => o.id === picked);
    const correct = !!chosen?.is_correct;
    scored = picked != null
      ? scoreChoice({ correct, elapsedMs, limitSeconds: limit, stake, allowWager: q.allow_wager })
      : { points: 0, wager: 1 };
    setResult({ ...scored, correct, answered: picked != null });
    setTotal(t => t + scored.points);
    setPhase('reveal');
  }, [q, seq, pin, picked, stake, limit, stopClock]);

  // The clock. Kept in a ref-driven interval so the countdown can tick without
  // the answer state changing underneath it.
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const openQuestion = useCallback(() => {
    setPicked(null); setSeq([]); setPin(null); setStake(1); setResult(null);
    startedRef.current = Date.now();
    elapsedRef.current = 0;
    setSecondsLeft(limit);
    setPhase('question');
    stopClock();
    timerRef.current = setInterval(() => {
      const left = limit - (Date.now() - startedRef.current) / 1000;
      if (left <= 0) { setSecondsLeft(0); settleRef.current(); return; }
      setSecondsLeft(left);
    }, 200);
  }, [limit, stopClock]);

  useEffect(() => () => stopClock(), [stopClock]);

  // WHAT THE ANSWER COST IN TIME, measured from when the question OPENED and
  // re-measured on every change — which is exactly what quiz_answer does:
  // `v_elapsed := now() - r.phase_started_at`, and phase_started_at is not
  // re-stamped. So a late change is scored as the late answer it is, and the
  // winning move is NOT to slap any shape the instant the question opens and
  // fix it at the buzzer for free.
  //
  // startedRef IS NEVER MOVED ONCE THE QUESTION IS OPEN. It used to be reset
  // here on every tap, which re-stamped elapsed correctly and also restarted
  // the countdown ring the interval reads off the same ref — so answering put
  // 45 seconds back on a clock the room had been watching run down.
  const mark = useCallback(() => { elapsedRef.current = Date.now() - startedRef.current; }, []);

  function tapOption(id) {
    if (phase !== 'question') return;
    setPicked(id);
    mark();
  }

  function tapItem(id) {
    if (phase !== 'question' || seq.includes(id)) return;
    // ONCE THE SEQUENCE IS COMPLETE IT IS FINAL. quiz_answer_order inserts ON
    // CONFLICT DO NOTHING and answers 'already answered', where quiz_answer
    // and quiz_answer_pin both re-stamp — a reorder is the one question type
    // you cannot change your mind about, and a rehearsal that let you would
    // teach a trainer the opposite of what the room will do.
    if (ORDER_IS_FINAL && orderIsSubmittable(seq.length, (q.quiz_options || []).length)) return;
    setSeq([...seq, id]);
    // EVERY tap, not only the one that completes the sequence. Marking only on
    // the last one left an unfinished sequence settling against whatever
    // elapsed the previous question happened to leave behind.
    mark();
  }

  function dropPin(p) {
    if (phase !== 'question') return;
    setPin(p);
    mark();
  }

  function next() {
    if (idx < total_ - 1) { setIdx(i => i + 1); setPhase('ready'); setResult(null); }
    else { setPhase('done'); }
  }

  function restart() {
    stopClock();
    setIdx(0); setPhase('ready'); setTotal(0); setResult(null);
    setPicked(null); setSeq([]); setPin(null); setStake(1);
  }

  function jumpTo(n) {
    stopClock();
    setIdx(n); setPhase('ready'); setResult(null);
    setPicked(null); setSeq([]); setPin(null); setStake(1);
  }

  // Esc leaves, like every other overlay here.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onExit?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const answered = picked != null || seq.length > 0 || pin != null;
  const wagerShown = q?.allow_wager && (q.kind !== 'order');

  const correctOption = useMemo(
    () => (q?.quiz_options || []).find(o => o.is_correct) || null,
    [q],
  );

  if (loading) {
    return (
      <div className="qreh">
        <div className="qreh-wall qlive-stage qlive-centre">
          <p className="qlive-sub">Reading the quiz…</p>
        </div>
      </div>
    );
  }

  if (error || !questions.length) {
    return (
      <div className="qreh">
        <div className="qreh-bar">
          <span className="qreh-title">{title || quiz?.title || 'Rehearsal'}</span>
          <button type="button" className="qreh-btn" onClick={onExit}>Close</button>
        </div>
        <div className="qreh-wall qlive-stage qlive-centre">
          <h1 className="qlive-big">{error ? 'That did not load' : 'Nothing to rehearse'}</h1>
          <p className="qlive-sub">
            {error || 'This quiz has no questions yet. Add one in the editor and come back.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="qreh">
      <div className="qreh-bar">
        <span className="qreh-step">
          {phase === 'done' ? `Finished · ${total_} of ${total_}` : `Question ${idx + 1} of ${total_}`}
        </span>
        {/* THE MARKER. This surface looks enough like the projector that it has
            to say, permanently and exactly where a real run puts its join
            code, that nobody can walk into this room. */}
        <span className="qreh-notlive">Rehearsal · nobody can join this</span>
        <span className="qreh-title">{title || quiz?.title}</span>

        <div className="qreh-tools">
          <label className="qreh-jump">
            Jump to
            <select
              value={idx}
              onChange={e => jumpTo(Number(e.target.value))}
              aria-label="Jump to a question"
            >
              {questions.map((qq, i) => (
                <option key={qq.id} value={i}>
                  {i + 1} · {qq.prompt.length > 34 ? `${qq.prompt.slice(0, 34)}…` : qq.prompt}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="qreh-btn" onClick={restart}>Restart</button>
          <button type="button" className="qreh-btn qreh-exit" onClick={onExit}>Close rehearsal</button>
        </div>
      </div>

      <div className="qreh-split">
        {/* ── THE WALL ─────────────────────────────────────────────────── */}
        <div className="qreh-wall">
          {phase === 'ready' && (
            <div className="qlive-stage qlive-centre">
              <h1 className="qlive-big">Question {idx + 1} of {total_}</h1>
              <p className="qlive-sub">{q.prompt}</p>
              <p className="qreh-thin">
                {limit} seconds{q.allow_wager ? ' · wager round' : ''}
              </p>
              <button type="button" className="qreh-go" onClick={openQuestion}>
                {idx === 0 ? 'Start' : `Ask question ${idx + 1}`}
              </button>
            </div>
          )}

          {phase === 'question' && (
            <div className="qlive-stage">
              <div className="qlive-qhead">
                <h1 className="qlive-prompt">{q.prompt}</h1>
                <QuizTimer total={limit} secondsLeft={secondsLeft} />
              </div>
              <QuizImage path={q.image_path} className={`qlive-figure ${scaleClass(q.display_scale)}`} />
              {q.kind === 'pin' && (
                <QuizPinField
                  path={q.map_path}
                  className={`qlive-pin ${scaleClass(q.display_scale)}`}
                  label="Where the room is dropping pins"
                />
              )}
              {q.kind === 'order' && <p className="qlive-instruction">Tap the shapes in the right order</p>}
              {q.kind === 'pin' && <p className="qlive-instruction">Drop your pin on your own screen</p>}
              {q.allow_wager && (
                <p className="qlive-instruction qlive-instruction-wager">
                  Wager round — raise your stake on your handset. 1× risks nothing.
                </p>
              )}
              {q.kind !== 'pin' && (
                <ul className={`qlive-opts${q.kind === 'order' ? ' qlive-opts-list' : ''}${(q.quiz_options || []).length === 2 ? ' qlive-opts-two' : ''}`}>
                  {(q.quiz_options || []).map((o, i) => (
                    <li key={o.id} className={`qlive-opt qlive-opt-${i}`}>
                      <span className="qlive-badge"><QuizShape index={i} /></span>
                      <span className="qlive-label">{o.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* A real wall counts the room in. There is one of you, so this
                  says whether YOU are in — which is the only fact it can
                  honestly report, and still the thing that tells a trainer the
                  question is answerable. */}
              <div className="qlive-answered">
                <div className="qlive-answered-track">
                  <div
                    className={`qlive-answered-fill${answered ? ' is-full' : ''}`}
                    style={{ width: answered ? '100%' : '0%' }}
                  />
                </div>
                <p className="qlive-tally">{answered ? "You're in" : 'waiting for your tap'}</p>
              </div>
              <button type="button" className="ghost qreh-skip" onClick={settle}>
                {answered ? 'See the answer' : 'Close it now'}
              </button>
            </div>
          )}

          {phase === 'reveal' && (
            <div className="qlive-stage">
              <h1 className="qlive-prompt">{q.prompt}</h1>
              <QuizImage path={q.image_path} className="qlive-figure qlive-figure-sm" />
              {q.kind === 'pin' ? (
                <QuizPinField
                  path={q.map_path}
                  target={{ x: q.pin_x, y: q.pin_y, rx: q.pin_rx, ry: q.pin_ry }}
                  myPin={pin}
                  className={`qlive-pin ${scaleClass(q.display_scale)}`}
                  label="The target, and where you put it"
                />
              ) : (
                /* qlive-opts-reveal is the projector's own reveal idiom — the
                   right one stays lit, the rest fall back — so the two screens
                   dim identically rather than by two different rules. */
                <ul className={`qlive-opts qlive-opts-reveal${(q.quiz_options || []).length === 2 ? ' qlive-opts-two' : ''}`}>
                  {(q.quiz_options || []).map((o, i) => {
                    // An `order` question has no single right answer, so
                    // nothing is lit and nothing falls back: every item
                    // carries the rank it belonged at instead.
                    const isRight = q.kind !== 'order' && o.is_correct;
                    const mine = q.kind === 'order' ? seq.includes(o.id) : picked === o.id;
                    const fade = q.kind !== 'order' && !isRight && !mine;
                    return (
                      <li
                        key={o.id}
                        className={`qlive-opt qlive-opt-${i}${isRight ? ' is-right' : ''}${fade ? ' is-wrong' : ''}`}
                      >
                        <span className="qlive-badge"><QuizShape index={i} /></span>
                        <span className="qlive-label">{o.label}</span>
                        {q.kind === 'order' && (
                          <span className="qreh-rank">belongs at {o.correct_rank}</span>
                        )}
                        {mine && q.kind !== 'order' && <span className="qreh-yours">your tap</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Said plainly, because the missing bars are the most visible
                  difference between this and the real thing and a trainer
                  should not be left wondering whether they are broken. */}
              <p className="qreh-spread">
                In a real room the distribution bars go here. With one player there is nothing
                to distribute, so the wall marks your own answer instead.
              </p>
              <button type="button" className="qreh-go" onClick={next}>
                {idx < total_ - 1 ? 'Next question' : 'Finish'}
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div className="qlive-stage qlive-centre">
              <h1 className="qlive-big">Rehearsal finished</h1>
              <p className="qlive-count">{total}</p>
              <p className="qlive-sub">
                points, played solo across all {total_} question{total_ === 1 ? '' : 's'}.
              </p>
              <div className="qreh-done-acts">
                <button type="button" className="qreh-go" onClick={restart}>Go again</button>
                <button type="button" className="ghost qreh-skip" onClick={onExit}>Close rehearsal</button>
              </div>
            </div>
          )}
        </div>

        {/* ── THE HANDSET ──────────────────────────────────────────────── */}
        <aside className="qreh-hand">
          <p className="qreh-hand-cap">What a participant holds</p>
          <div className="qreh-phone">
            <span className="qreh-notch" aria-hidden="true" />
            <div className="qreh-phone-top">
              <span>Question {Math.min(idx + 1, total_)}</span>
              <span className="qreh-who">You</span>
            </div>

            <div className="qreh-phone-body">
              {phase === 'ready' && (
                <div className="qlive-stage qlive-centre qreh-mini">
                  <h2 className="qreh-mini-big">Get ready</h2>
                  <p className="qlive-sub">Watch the screen at the front.</p>
                </div>
              )}

              {phase === 'question' && (
                <div className="qlive-stage qlive-answer qreh-mini">
                  {wagerShown && (
                    <div className="qlive-stake">
                      <p className="qlive-stake-label">
                        How sure are you? <span className="qlive-muted">1× risks nothing</span>
                      </p>
                      <div className="qlive-stake-row" role="group" aria-label="Your stake">
                        {[1, 2, 3].map(n => (
                          <button
                            key={n}
                            type="button"
                            className={`qlive-stake-btn${stake === n ? ' is-on' : ''}`}
                            aria-pressed={stake === n}
                            onClick={() => setStake(n)}
                          >
                            {n}×
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {q.kind === 'pin' ? (
                    <QuizPinField
                      path={q.map_path}
                      onPick={dropPin}
                      myPin={pin}
                      className={`qlive-pin-answer ${scaleClass(q.display_scale)}`}
                      label="Where you think it is"
                    />
                  ) : q.kind === 'order' ? (
                    <>
                      <ol className="qlive-seq">
                        {(q.quiz_options || []).map((_, slot) => {
                          const chosenId = seq[slot];
                          const chosen = (q.quiz_options || []).findIndex(o => o.id === chosenId);
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
                        {(q.quiz_options || []).map((o, i) => {
                          const used = seq.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              className={`qlive-pick qlive-pick-bare qlive-opt-${i}${used ? ' is-dimmed' : ''}`}
                              disabled={used}
                              onClick={() => tapItem(o.id)}
                              aria-label={`${shapeFor(i).label}${used ? `, placed ${seq.indexOf(o.id) + 1}` : ''}`}
                            >
                              <QuizShape index={i} />
                            </button>
                          );
                        })}
                      </div>
                      <p className="qlive-note qlive-muted">
                        {orderIsSubmittable(seq.length, (q.quiz_options || []).length)
                          ? 'In, and locked. A sequence cannot be changed.'
                          : seq.length > 0
                            ? `${seq.length} of ${(q.quiz_options || []).length} placed — finish it or it scores nothing`
                            : 'Tap the shapes in order — speed counts.'}
                      </p>
                      {/* Gone once the sequence is complete, because by then
                          the server would already have taken it. Before that
                          it costs nothing: nothing has been sent yet. */}
                      {seq.length > 0 && !orderIsSubmittable(seq.length, (q.quiz_options || []).length) && (
                        <button type="button" className="ghost qlive-restart" onClick={() => setSeq([])}>
                          Start again
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="qlive-picks qlive-picks-bare">
                        {(q.quiz_options || []).map((o, i) => (
                          <button
                            key={o.id}
                            type="button"
                            className={`qlive-pick qlive-pick-bare qlive-opt-${i}${picked === o.id ? ' is-picked' : ''}${picked && picked !== o.id ? ' is-dimmed' : ''}`}
                            onClick={() => tapOption(o.id)}
                            aria-label={shapeFor(i).label}
                          >
                            <QuizShape index={i} />
                          </button>
                        ))}
                      </div>
                      <p className="qlive-note qlive-muted">
                        {picked
                          ? 'In. Tap another to change it — you are scored on the later tap.'
                          : q.kind === 'boolean'
                            ? 'Tap true or false — speed counts.'
                            : 'Tap your answer — speed counts.'}
                      </p>
                    </>
                  )}
                </div>
              )}

              {phase === 'reveal' && result && (
                <div className="qlive-stage qlive-centre qreh-mini">
                  {!result.answered ? (
                    <>
                      <h2 className="qreh-mini-big">No answer</h2>
                      <p className="qlive-sub">The clock ran out. Nothing for this one.</p>
                    </>
                  ) : (
                    <>
                      <h2 className={`qreh-mini-big ${result.correct ? 'is-right' : 'is-wrong'}`}>
                        {result.correct ? 'Correct' : 'Not this time'}
                      </h2>
                      <p className="qreh-pts">
                        {result.points > 0 ? `+${result.points}` : String(result.points).replace('-', '−')}
                      </p>
                      <p className="qlive-sub">
                        {q.kind === 'order' && result.of
                          ? `${result.right} of ${result.of} in the right place`
                          : result.correct
                            ? `in ${Math.round(Math.min(elapsedRef.current, limit * 1000) / 100) / 10}s of ${limit}s`
                            : correctOption
                              ? `the answer was “${correctOption.label}”`
                              : 'that was not it'}
                      </p>
                      {/* AN HONEST NUMBER OR A FLAGGED ONE, never a confident
                          wrong one. The wager multiplier is the one piece of
                          the server's arithmetic this file is guessing at. */}
                      {/* The stake is named whenever one was raised, win or
                          lose — it is the difference between a 950 and a
                          −2850, and a trainer rehearsing a wager round needs
                          to see which one they just took. */}
                      {q.allow_wager && result.wager > 1 && (
                        <p className="qlive-note qlive-muted">staked {result.wager}×</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {phase === 'done' && (
                <div className="qlive-stage qlive-centre qreh-mini">
                  <h2 className="qreh-mini-big">Done</h2>
                  <p className="qreh-pts">{total}</p>
                  <p className="qlive-sub">points</p>
                </div>
              )}
            </div>
          </div>
          <p className="qreh-runtot">
            Running total · {total} point{total === 1 ? '' : 's'}
          </p>
        </aside>
      </div>

      <p className="qreh-maths">
        Scored with the room&rsquo;s own formula — <code>1000 × (1 − (elapsed ÷ limit) ÷ 2)</code>,
        so an instant tap banks about 1000 and a buzzer-beater about 500, and a raised stake
        multiplies both the win and the loss. Change your mind and you are scored on the later
        tap, exactly as a real room would score it.
      </p>
    </div>
  );
}

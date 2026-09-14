import { useEffect, useRef, useState } from 'react';
import { SkeletonLines } from '../components/Skeleton.jsx';
import { Link, useParams } from 'react-router-dom';
import { useQuizEditor } from '../hooks/useQuizEditor.js';
import QuizShape from '../components/quiz/QuizShape.jsx';
import QuizImage from '../components/quiz/QuizImage.jsx';
import QuizPinField from '../components/quiz/QuizPinField.jsx';
import QuizProjector from '../components/quiz/QuizProjector.jsx';
import { useStandaloneRun } from '../hooks/useStandaloneRun.js';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { shapeFor } from '../lib/quizShapes.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/quiz.css';

// Kahoot-ish spread. 5s is the floor the database allows; 120 the ceiling.
const LIMITS = [10, 15, 20, 30, 45, 60, 90];

// What stops this question being usable in a room. Returned as a sentence
// rather than a boolean so the editor can say WHICH thing is missing — "not
// ready" on its own just makes a trainer hunt.
function whatsMissing(q) {
  if (!q.prompt.trim()) return 'needs a question';
  const filled = q.quiz_options.filter(o => o.label.trim());
  // A drop-pin needs its picture and its circle, and says which is missing.
  // "Not ready" on a question whose map is sitting right there would send a
  // trainer looking for the wrong thing.
  if (q.kind === 'pin') {
    if (!q.map_path) return 'needs a picture to drop pins on';
    if (q.pin_x == null) return 'needs the right spot marked';
    return null;
  }
  // A reorder question needs EVERY item: a blank step in a sequence is not a
  // shorter sequence, it is an unanswerable one.
  if (q.kind === 'order') {
    return filled.length === q.quiz_options.length ? null : 'every step needs wording';
  }
  // A true/false question has nothing that can be left blank below the
  // statement: its two answers are the type's own words, written by the
  // database, and one of them is always marked correct.
  if (q.kind === 'boolean') return null;
  if (filled.length < 2) return 'needs at least two answers';
  const correct = q.quiz_options.find(o => o.is_correct);
  if (!correct || !correct.label.trim()) return 'the correct answer is blank';
  return null;
}

// Saves on blur rather than on every keystroke. A quiz is edited in bursts and
// a write per character would be a write per character.
function BlurInput({ value, onSave, className = 'form-input', ...rest }) {
  const [draft, setDraft] = useState(value);
  // Re-sync when the row changes underneath us (reorder, refresh).
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      {...rest}
      className={className}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

// A hover bubble, drawn by this page rather than by the browser.
//
// The native `title` attribute was doing this job and doing it badly: it waits
// about a second before it appears, it is a system-styled box that has nothing
// to do with the page, and it cannot be seen at all on a touch screen. Here
// the text is an attribute the CSS reads, so it costs no extra markup, and it
// shows on FOCUS as well as hover — which is what makes the icons usable from
// the keyboard now that they have no words.
//
// The accessible name stays on the control itself (aria-label); this bubble is
// decoration on top of it, hidden from screen readers, and never the only
// place a control's meaning is written down.
function Tip({ text, children, className = '' }) {
  return (
    <span className={`tip ${className}`.trim()} data-tip={text}>
      {children}
    </span>
  );
}

// ── the icons ────────────────────────────────────────────────────────
// Inline SVG rather than a font or a library: three shapes, drawn in
// currentColor so they take the button's state without a second rule.
function IconPicture() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <circle cx="7" cy="8.5" r="1.4" />
      <path d="M3 14.5l4-3.5 3 2.5 3-3 4 4" />
    </svg>
  );
}

function IconSound() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M11.5 3.5v10" />
      <path d="M11.5 3.5l4.5-1.2v10" />
      <circle cx="9" cy="14.5" r="2.5" />
      <circle cx="13.5" cy="13.3" r="2.5" />
    </svg>
  );
}

function IconRemove() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}

// The picture and the sound clip, as two icons on one row.
//
// THEY USED TO EXPLAIN THEMSELVES. Every question carried two sentences
// saying where a picture appears and what an MP3 does, which is a thing a
// trainer needs to be told once and then has to read past on every question
// for the rest of the quiz. The words live in the tooltips now; what stays on
// screen is whether this question HAS a picture and a clip, which is the only
// part that differs from question to question.
function QuestionMedia({ q, actions, onError, hideImage = false }) {
  const { run: runBusy } = useBusyOverlay();
  const imageInput = useRef(null);
  const audioInput = useRef(null);

  const call = async (label, fn) => {
    const { error } = await runBusy(label, fn);
    if (error) onError(error.message);
  };

  async function pickImage(e) {
    const file = e.target.files?.[0];
    // Cleared immediately so choosing the SAME file again still fires change —
    // otherwise a failed upload cannot be retried without picking something
    // else first.
    e.target.value = '';
    if (!file) return;
    await call('Preparing the picture…', () => actions.setQuestionImage(q.id, file));
  }

  async function pickAudio(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await call('Uploading the clip…', () => actions.setQuestionAudio(q.id, file));
  }

  return (
    <div className="quiz-q-media">
      {/* The file inputs themselves are never shown — they cannot be styled and
          their "No file chosen" is a lie the moment something is attached. */}
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pickImage} />
      <input ref={audioInput} type="file" accept="audio/mpeg,.mp3" onChange={pickAudio} />

      {/* A PICTURE. The thumbnail replaces the icon once there is one: it
          answers "did the right file go up" in the space the button was
          occupying anyway. */}
      {!hideImage && (
        <span className={`quiz-media-slot${q.image_path ? ' is-set' : ''}`}>
          <Tip text={q.image_path
            ? 'Replace the picture — shown on the projected question, not on the handsets'
            : 'Add a picture — shown on the projected question, not on the handsets'}
          >
            <button
              type="button"
              className="quiz-media-btn"
              onClick={() => imageInput.current?.click()}
              aria-label={q.image_path ? 'Replace the picture' : 'Add a picture'}
            >
              {q.image_path ? <QuizImage path={q.image_path} alt="" /> : <IconPicture />}
            </button>
          </Tip>
          {q.image_path && (
            <Tip text="Remove the picture" className="tip-x">
              <button
                type="button"
                className="quiz-media-x"
                aria-label="Remove the picture"
                onClick={() => call('Removing the picture…', () => actions.clearQuestionImage(q.id))}
              >
                <IconRemove />
              </button>
            </Tip>
          )}
        </span>
      )}

      {/* A SOUND CLIP. Available on every kind of question: a clip is the
          question's material, not its answer shape. */}
      <span className={`quiz-media-slot${q.audio_path ? ' is-set' : ''}`}>
        <Tip text={q.audio_path
          ? 'Replace the clip — the room gets a Play button, and the timer starts when the clip ends'
          : 'Add an MP3 — the room gets a Play button, and the timer starts when the clip ends'}
        >
          <button
            type="button"
            className="quiz-media-btn"
            onClick={() => audioInput.current?.click()}
            aria-label={q.audio_path ? 'Replace the sound clip' : 'Add a sound clip'}
          >
            <IconSound />
          </button>
        </Tip>
        {q.audio_path && (
          <Tip text="Remove the clip" className="tip-x">
            <button
              type="button"
              className="quiz-media-x"
              aria-label="Remove the sound clip"
              onClick={() => call('Removing the clip…', () => actions.clearQuestionAudio(q.id))}
            >
              <IconRemove />
            </button>
          </Tip>
        )}
      </span>
    </div>
  );
}


// The map, and the circle that decides who was right.
//
// TWO STEPS, in this order, because the second is meaningless without the
// first: upload a picture, then click the spot. The radius is a slider rather
// than a drag, and that is not a shortcut — a drag has to be started
// somewhere, and on a map the only obvious place to start it is the middle,
// which is the pixel the trainer has just spent a click getting exactly right.
function QuestionPin({ q, actions, onError }) {
  const { run: runBusy } = useBusyOverlay();
  const inputRef = useRef(null);
  // Width-to-height of the picture as displayed, needed to turn one radius
  // into the two the database stores. Recovered from the stored pair when a
  // target already exists, so the slider works on a question loaded fresh
  // without waiting for a click.
  const aspectRef = useRef(null);
  if (q.pin_rx && q.pin_ry) aspectRef.current = q.pin_ry / q.pin_rx;

  // The radius WHILE IT IS BEING DRAGGED, before the write goes out. Null when
  // nothing is in flight, so the stored value is the one on screen.
  const [pctDraft, setPctDraft] = useState(null);
  const saveTimer = useRef(null);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const pct = pctDraft ?? (q.pin_rx != null ? Math.round(q.pin_rx * 100) : 8);

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { error } = await runBusy('Preparing the picture…', () => actions.setQuestionMap(q.id, file));
    if (error) onError(error.message);
  }

  async function place({ x, y, aspect }) {
    aspectRef.current = aspect;
    const rx = q.pin_rx ?? 0.08;
    const { error } = await actions.setPinTarget(q.id, { x, y, rx, ry: rx * aspect });
    if (error) onError(error.message);
  }

  // DEBOUNCED, and the reason is not the number of requests.
  //
  // A range input fires onChange once per STEP — a drag from 8% to 20% is
  // twelve of them, and holding an arrow key is more. Sent one per step they
  // race, and the one that lands last is not reliably the one the trainer let
  // go on: caught in the act here, with the slider reading 24% and the
  // database holding 0.22. A circle two points smaller than the one on screen
  // is a question that marks people wrong for pixels nobody can see.
  //
  // So the slider moves at once and the write follows the pause. The circle
  // tracks the draft, not the stored value, so nothing on screen waits.
  function resize(nextPct) {
    setPctDraft(nextPct);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const rx = nextPct / 100;
      const aspect = aspectRef.current ?? 1;
      const { error } = await actions.setPinTarget(q.id, { x: q.pin_x, y: q.pin_y, rx, ry: rx * aspect });
      if (error) onError(error.message);
      // Back to the stored value, which by now is this one. Cleared AFTER the
      // write so the slider never jumps back to the old radius mid-drag.
      setPctDraft(null);
    }, 250);
  }

  return (
    <div className="quiz-q-pin">
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pickFile} />

      {q.map_path ? (
        <>
          <QuizPinField
            path={q.map_path}
            onPick={place}
            /* The DRAFT radius, so the circle resizes under the slider rather
               than a quarter-second after it. x and y are never drafted —
               they are set by a click, which writes once. */
            target={q.pin_x != null ? {
              x: q.pin_x,
              y: q.pin_y,
              rx: pct / 100,
              ry: (pct / 100) * (aspectRef.current ?? 1),
            } : null}
            className="quiz-pin-edit"
            label="The picture participants will drop a pin on"
          />
          <div className="quiz-pin-tools">
            <label className="quiz-pin-radius">
              <span className="muted">How close counts</span>
              <input
                type="range"
                min="2"
                max="30"
                value={pct}
                disabled={q.pin_x == null}
                onChange={e => resize(Number(e.target.value))}
              />
              <span className="muted">{pct}% of the width</span>
            </label>
            {/* The SLOT is what the cross positions against. Without it the
                cross takes its coordinates from whatever ancestor happens to
                be positioned — measured at (1893, −434), which is off the top
                of the page. */}
            <span className="quiz-media-slot is-set">
              <Tip text="Replace the picture">
                <button
                  type="button"
                  className="quiz-media-btn"
                  onClick={() => inputRef.current?.click()}
                  aria-label="Replace the picture"
                >
                  <IconPicture />
                </button>
              </Tip>
              <Tip text="Remove the picture" className="tip-x">
                <button
                  type="button"
                  className="quiz-media-x"
                  aria-label="Remove the picture"
                  onClick={async () => {
                    const { error } = await actions.clearQuestionMap(q.id);
                    if (error) onError(error.message);
                  }}
                >
                  <IconRemove />
                </button>
              </Tip>
            </span>
          </div>
          {/* The ONE line that survives, and only until it has been done: a
              picture with no circle on it does not tell a trainer that
              clicking is what sets the answer. Once the spot is marked the
              circle says everything this sentence did. */}
          {q.pin_x == null && (
            <p className="muted quiz-q-hint"><strong>Click the picture</strong> to mark the right spot.</p>
          )}
        </>
      ) : (
        <>
          {/* The only word left, and it stays a word: this is the empty state
              of the question's main content, not a control beside something
              that is already there. */}
          <button type="button" onClick={() => inputRef.current?.click()}>+ Add the picture</button>
        </>
      )}
    </div>
  );
}

function QuestionCard({ q, index, total, actions, onError }) {
  const missing = whatsMissing(q);
  const call = async (fn) => { const { error } = await fn(); if (error) onError(error.message); };

  return (
    <section className="quiz-q">
      <header className="quiz-q-head">
        <span className="quiz-q-num">Q{index + 1}</span>
        {q.kind === 'order' && <span className="quiz-kind">Put in order</span>}
        {q.kind === 'boolean' && <span className="quiz-kind">True or false</span>}
        {q.kind === 'pin' && <span className="quiz-kind">Drop a pin</span>}
        {q.audio_path && <span className="quiz-kind quiz-kind-audio">♪ Clip</span>}
        {q.allow_wager && <span className="quiz-kind quiz-kind-wager">Wager</span>}
        {missing && <span className="quiz-q-flag" title="This question cannot be used yet">{missing}</span>}
        <div className="quiz-q-tools">
          <button type="button" className="ghost" title="Move up" disabled={index === 0}
            onClick={() => call(() => actions.moveQuestion(q.id, 'up'))}>↑</button>
          <button type="button" className="ghost" title="Move down" disabled={index === total - 1}
            onClick={() => call(() => actions.moveQuestion(q.id, 'down'))}>↓</button>
          <label className="quiz-q-timer">
            <span className="muted">Timer</span>
            <select
              className="form-input"
              value={q.time_limit_seconds}
              onChange={e => call(() => actions.updateQuestion(q.id, { time_limit_seconds: Number(e.target.value) }))}
            >
              {LIMITS.map(s => <option key={s} value={s}>{s}s</option>)}
            </select>
          </label>
          <button type="button" className="ghost quiz-q-del" title="Delete this question"
            onClick={() => call(() => actions.deleteQuestion(q.id))}>Delete</button>
        </div>
      </header>

      <BlurInput
        className="form-input large"
        value={q.prompt}
        placeholder="Type the question…"
        maxLength={300}
        onSave={v => call(() => actions.updateQuestion(q.id, { prompt: v }))}
      />

      {/* A drop-pin's picture IS its map, and it goes to the handsets, so it
          gets the big click-to-mark surface rather than the icon row — but the
          CLIP is the same on every kind of question, so the media row is here
          for all of them and only loses its picture half on a pin. */}
      {q.kind === 'pin' && <QuestionPin q={q} actions={actions} onError={onError} />}

      {/* ONE ROW for everything that is attached to the question rather than
          part of it: the picture, the clip, the wager. They were three stacked
          rows, each the full width of the card and each mostly empty, which is
          what made a question look like a form when it is really a sentence
          with two pictures and a checkbox beside it. */}
      <div className="quiz-q-controls">
        <QuestionMedia q={q} actions={actions} onError={onError} hideImage={q.kind === 'pin'} />

        {/* Only where the answer is simply right or wrong. A reorder question is
            scored by partial credit, so "you lost three times a partially-right
            answer" is not a sentence anyone can say to a room. */}
        {q.kind !== 'order' && (
          <Tip
            className="tip-wide"
            text={'Everyone picks 1×, 2× or 3× with their answer. At 1× nothing changes — win the '
              + 'ordinary points, lose nothing. Raise it and a right answer pays double or triple, a '
              + 'wrong one costs the same, so a score can go down. Best saved for the last question.'}
          >
            <label className="quiz-wager-opt">
              <input
                type="checkbox"
                checked={!!q.allow_wager}
                onChange={e => call(() => actions.setAllowWager(q.id, e.target.checked))}
              />
              {/* ONE LINE. The four sentences that used to sit here were the same
                  four sentences on every question in the quiz — read once, then
                  read past forever, and the longest thing on a card whose actual
                  content is the question. They are the bubble now, and the
                  checkbox is the only part that differs question to question. */}
              <span>Let the room raise the stakes</span>
              <span className="quiz-wager-why" aria-hidden="true">?</span>
            </label>
          </Tip>
        )}
      </div>

      {/* A drop-pin has no options to write — the answer is a place, and the
          circle above is all of it. */}
      {q.kind === 'pin' ? null : q.kind === 'order' ? (
        <>
          <p className="muted quiz-q-hint">
            Type the steps in the <strong>correct order</strong>. Each one carries a shape, and
            the room sees those shapes <strong>scrambled</strong> — so the shapes never give the
            answer away. Participants tap the shapes in the order they think is right.
          </p>
          <ol className="quiz-steps">
            {q.quiz_options.map((o, i) => (
              <li key={o.id} className="quiz-step">
                <span className="quiz-step-num">{i + 1}</span>
                {/* The shape this step will carry in the room — scrambled
                    against the sequence, and fixed once at creation. */}
                <span className={`quiz-opt-badge s${o.order_index}`} title={`Shown as the ${shapeFor(o.order_index).label.toLowerCase()}`}>
                  <QuizShape index={o.order_index} />
                </span>
                <BlurInput
                  value={o.label}
                  placeholder={`Step ${i + 1}`}
                  maxLength={150}
                  onSave={v => call(() => actions.updateOption(o.id, v))}
                />
                <button type="button" className="ghost" title="Move up" disabled={i === 0}
                  onClick={() => call(() => actions.moveItem(q.id, o.id, 'up'))}>↑</button>
                <button type="button" className="ghost" title="Move down" disabled={i === q.quiz_options.length - 1}
                  onClick={() => call(() => actions.moveItem(q.id, o.id, 'down'))}>↓</button>
              </li>
            ))}
          </ol>
        </>
      ) : q.kind === 'boolean' ? (
        <>
          <p className="muted quiz-q-hint">
            Write a <strong>statement</strong> above, then mark whether it is true or false.
            The two answers are fixed, so there is nothing else to fill in — the room sees them
            on the projector as these two shapes.
          </p>
          <div className="quiz-opts quiz-opts-two">
            {q.quiz_options.map((o, i) => (
              <div key={o.id} className={`quiz-opt${o.is_correct ? ' is-correct' : ''}`}>
                <label
                  className="quiz-opt-pick"
                  title={o.is_correct
                    ? `The statement is ${o.label.toLowerCase()}`
                    : `Mark the statement as ${o.label.toLowerCase()}`}
                >
                  <input
                    type="radio"
                    name={`correct-${q.id}`}
                    checked={o.is_correct}
                    onChange={() => call(() => actions.setCorrect(q.id, o.id))}
                  />
                  <span className={`quiz-opt-badge s${i}`}><QuizShape index={i} /></span>
                </label>
                {/* Text, not an input. A true/false question whose words a
                    trainer can retype is a two-option choice question wearing
                    a different hat — and one typed as "Flase" is live in a
                    room before anybody notices. */}
                <span className="quiz-opt-fixed">{o.label}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="muted quiz-q-hint">
            Mark the correct answer with the button on the left. Participants never receive it —
            only the four labels.
          </p>
          <div className="quiz-opts">
            {q.quiz_options.map((o, i) => (
              <div key={o.id} className={`quiz-opt${o.is_correct ? ' is-correct' : ''}`}>
                <label className="quiz-opt-pick" title={`${shapeFor(i).label} — ${o.is_correct ? 'this is the correct answer' : 'mark as the correct answer'}`}>
                  <input
                    type="radio"
                    name={`correct-${q.id}`}
                    checked={o.is_correct}
                    onChange={() => call(() => actions.setCorrect(q.id, o.id))}
                  />
                  <span className={`quiz-opt-badge s${i}`}><QuizShape index={i} /></span>
                </label>
                <BlurInput
                  value={o.label}
                  placeholder={`${shapeFor(i).label} answer`}
                  maxLength={150}
                  onSave={v => call(() => actions.updateOption(o.id, v))}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function QuizEditorPage() {
  const { id } = useParams();
  const editor = useQuizEditor(id);
  const { loading, error, quiz, questions } = editor;
  const [rowError, setRowError] = useState('');
  const { start } = useStandaloneRun();
  const { run: runBusy } = useBusyOverlay();
  const [running, setRunning] = useState(null);

  const notReady = questions.filter(whatsMissing).length;
  // Nothing to run until there is a question, and nothing worth running
  // until every question is finished — a half-written one on a wall is the
  // thing this page exists to prevent.
  const canRun = questions.length > 0 && notReady === 0;

  async function runNow() {
    setRowError('');
    const { data, error: e } = await runBusy('Opening the room…', () => start(id));
    if (e) { setRowError(e.message); return; }
    setRunning({ runId: data.runId, joinCode: data.joinCode });
  }

  if (running) {
    return (
      <QuizProjector
        runId={running.runId}
        joinCode={running.joinCode}
        guestRun
        onExit={() => setRunning(null)}
      />
    );
  }

  return (
    <>
      <TopBar />
      <main className="page">
        {loading && <SkeletonLines rows={5} label="Loading quiz…" />}
        {error && <p className="error">{error}</p>}

        {!loading && quiz && (
          <>
            <section className="page-bar">
              <BlurInput
                className="form-input large quiz-title"
                value={quiz.title}
                maxLength={120}
                aria-label="Quiz title"
                onSave={async v => { const { error: e } = await editor.renameQuiz(v); if (e) setRowError(e.message); }}
              />
              <div className="page-bar-actions">
                {/* RUN NOW, here as well as in the library: you finish writing a
                    question and the next thing you want is to hear it in a room.
                    Only on the library copy — a session's own copy is run from
                    that session, where it has a roster to run against. */}
                {!quiz.session_id && (
                  <button
                    type="button"
                    onClick={runNow}
                    disabled={!canRun}
                    title={canRun
                      ? 'Open a room for this quiz — people join by scanning a code'
                      : questions.length === 0
                        ? 'Add a question first'
                        : 'Finish every question first'}
                  >
                    Run now
                  </button>
                )}
                {/* A session's own copy came from its Quiz tab, so that is where
                    back means. Sending a trainer to the library instead drops
                    them somewhere they were not, next to the template they did
                    NOT just edit — which is how someone ends up editing the
                    master by mistake. */}
                {quiz.session_id ? (
                  <Link to={`/trainer/sessions/${quiz.session_id}`} className="ghost-link">← Back to session</Link>
                ) : (
                  <Link to="/trainer/quizzes" className="ghost-link">← All quizzes</Link>
                )}
              </div>
            </section>

            {/* The "this is the library copy" notice used to sit here. It said
                that editing a template does not reach a session that already
                has the quiz — true, and the trap is real (quiz_attach_to_session
                snapshots), but it was four lines of standing text on a page a
                trainer opens dozens of times. The back link still says which
                copy is open: "← Back to session" or "← All quizzes". */}

            {rowError && <p className="error">{rowError}</p>}

            {questions.length > 0 && (
              <p className="muted quiz-summary">
                {questions.length} question{questions.length === 1 ? '' : 's'}
                {notReady > 0 && <> · <strong>{notReady} not ready</strong></>}
                {' · '}
                {questions.reduce((n, q) => n + q.time_limit_seconds, 0)}s of answering time
              </p>
            )}

            {questions.length === 0 && (
              <p className="muted">
                No questions yet. A question has four answers and a timer — or make it a
                "put in order" question, where the room arranges four steps into a sequence,
                or a true/false, which is one statement and two big shapes — or drop-a-pin,
                where everyone taps a place on a map. Participants see the answers but never
                which is correct.
              </p>
            )}

            {/* AT THE TOP, because it is the thing a trainer comes to this
                page to do. At the bottom it sat under every question already
                written, so building a ten-question quiz meant scrolling past
                the whole quiz between each one. A new question still appends
                to the END of the list — the buttons moved, the order did not. */}
            <div className="quiz-add">
              <button
                type="button"
                onClick={async () => { const { error: e } = await editor.addQuestion('choice'); if (e) setRowError(e.message); }}
              >
                + Add question
              </button>
              <button
                type="button"
                className="ghost"
                onClick={async () => { const { error: e } = await editor.addQuestion('order'); if (e) setRowError(e.message); }}
              >
                + Add "put in order"
              </button>
              <button
                type="button"
                className="ghost"
                onClick={async () => { const { error: e } = await editor.addQuestion('boolean'); if (e) setRowError(e.message); }}
              >
                + Add true/false
              </button>
              <button
                type="button"
                className="ghost"
                onClick={async () => { const { error: e } = await editor.addQuestion('pin'); if (e) setRowError(e.message); }}
              >
                + Add drop-a-pin
              </button>
            </div>
            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                q={q}
                index={i}
                total={questions.length}
                actions={editor}
                onError={setRowError}
              />
            ))}

          </>
        )}
      </main>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuizEditor } from '../hooks/useQuizEditor.js';
import QuizShape from '../components/quiz/QuizShape.jsx';
import QuizImage from '../components/quiz/QuizImage.jsx';
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
  // A reorder question needs EVERY item: a blank step in a sequence is not a
  // shorter sequence, it is an unanswerable one.
  if (q.kind === 'order') {
    return filled.length === q.quiz_options.length ? null : 'every step needs wording';
  }
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

// The picture row on a question in the editor.
//
// The thumbnail is there to answer one question — did the right file go up —
// so it is small and it is not clickable. The room sees the picture at full
// size on the wall, which is the only place its detail matters.
function QuestionImage({ q, actions, onError }) {
  const { run: runBusy } = useBusyOverlay();
  const inputRef = useRef(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    // Cleared immediately so choosing the SAME file again still fires change —
    // otherwise a failed upload cannot be retried without picking something
    // else first.
    e.target.value = '';
    if (!file) return;
    const { error } = await runBusy('Preparing the picture…', () => actions.setQuestionImage(q.id, file));
    if (error) onError(error.message);
  }

  return (
    <div className="quiz-q-image">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={pick}
      />
      {q.image_path && <QuizImage path={q.image_path} alt="" />}
      <button
        type="button"
        className="ghost quiz-q-image-btn"
        onClick={() => inputRef.current?.click()}
      >
        {q.image_path ? 'Replace picture' : '+ Add a picture'}
      </button>
      {q.image_path && (
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            const { error } = await actions.clearQuestionImage(q.id);
            if (error) onError(error.message);
          }}
        >
          Remove
        </button>
      )}
      {!q.image_path && (
        <span className="muted quiz-q-hint">
          Shown on the projected question, not on the handsets. Large pictures are
          shrunk before they are uploaded.
        </span>
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

      <QuestionImage q={q} actions={actions} onError={onError} />

      {q.kind === 'order' ? (
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

  const notReady = questions.filter(whatsMissing).length;

  return (
    <>
      <TopBar />
      <main className="page">
        {loading && <div className="loading">Loading…</div>}
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

            {/* Which copy am I editing? The back link says so, but quietly,
                and getting it wrong is silent: the picture goes on the master,
                the room runs the session's copy, and nothing appears on the
                wall. quiz_attach_to_session snapshots a quiz at the moment it
                is attached — on purpose, so a trainer mid-course does not have
                their questions change underneath them — which means a master
                edit reaches nobody who already has a copy. */}
            {quiz.is_template && (
              <p className="quiz-master-note">
                This is the <strong>library copy</strong>. Sessions that already have this quiz
                keep the version they were given — edit it there, on the session's Quiz tab,
                if you need the change in a room that is already set up.
              </p>
            )}

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
                "put in order" question, where the room arranges four steps into a sequence.
                Participants see the answers but never which is correct.
              </p>
            )}

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
            </div>
          </>
        )}
      </main>
    </>
  );
}

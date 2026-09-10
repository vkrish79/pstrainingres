import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuizEditor } from '../hooks/useQuizEditor.js';
import QuizShape from '../components/quiz/QuizShape.jsx';
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

function QuestionCard({ q, index, total, actions, onError }) {
  const missing = whatsMissing(q);
  const call = async (fn) => { const { error } = await fn(); if (error) onError(error.message); };

  return (
    <section className="quiz-q">
      <header className="quiz-q-head">
        <span className="quiz-q-num">Q{index + 1}</span>
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
                No questions yet. Each one has four answers and a timer; participants
                see the answers but never which is correct.
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
                onClick={async () => { const { error: e } = await editor.addQuestion(); if (e) setRowError(e.message); }}
              >
                + Add question
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

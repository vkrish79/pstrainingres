import { shapeFor } from '../../lib/quizShapes.js';
import QuizShape from './QuizShape.jsx';

// The pieces of the answering screen that the live handset (QuizParticipant)
// and the rehearsal room's mock phone (QuizRehearsal) both draw. Shared so the
// rehearsal cannot drift from what a participant actually holds.
//
// Layout is NOT decided here. quiz-live.css switches between the laptop and
// phone arrangement with a CONTAINER query on .qlive-answer-full, because the
// rehearsal phone is a narrow box on a wide screen and a viewport query would
// hand it the laptop layout.

// "Question 3 of 8", the question, and the clock. `number` and `timer` are
// optional: the rehearsal phone already prints the number in its own frame.
export function QuizQuestionHead({ number, total, prompt, timer, pickAll = false }) {
  return (
    <div className="qlive-ahead">
      <div className="qlive-ahead-text">
        {number != null && (
          <span className="qlive-qnum">Question {number}{total ? ` of ${total}` : ''}</span>
        )}
        {pickAll && <span className="qlive-pickall">Pick all that apply</span>}
        {prompt && <h1 className="qlive-aprompt">{prompt}</h1>}
      </div>
      {timer}
    </div>
  );
}

// One answer: shape, wording, and (on a laptop) the number key that picks it.
// The shape stays on every answer so "hit the triangle" still works in a room.
export function QuizPick({ index, label, className = '', keyHint, ticked, ...buttonProps }) {
  return (
    <button
      type="button"
      className={`qlive-pick qlive-pick-labelled qlive-opt-${index} ${className}`}
      aria-label={label ? `${shapeFor(index).label}: ${label}` : shapeFor(index).label}
      {...buttonProps}
    >
      <span className="qlive-badge"><QuizShape index={index} /></span>
      <span className="qlive-label">{label}</span>
      {keyHint != null && <span className="qlive-key" aria-hidden="true">{keyHint}</span>}
      {/* Pick-all only: a tick box, filled when this answer is ticked. */}
      {ticked != null && (
        <span className="qlive-tick" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
        </span>
      )}
    </button>
  );
}

// The sequence built so far on an order question, with each placed step's
// wording, so the order can be checked without looking up at the wall.
export function QuizSeqSlots({ options, seq }) {
  return (
    <ol className="qlive-seq qlive-seq-labelled">
      {options.map((_, slot) => {
        const chosenId = seq[slot];
        const chosen = options.findIndex(o => o.id === chosenId);
        return (
          <li key={slot} className={`qlive-seq-slot${chosenId ? ' is-filled' : ''}`}>
            <span className="qlive-seq-num">{slot + 1}</span>
            {chosenId ? (
              <>
                <span className={`qlive-seq-shape qlive-opt-${chosen}`}><QuizShape index={chosen} /></span>
                <span className="qlive-seq-text">{options[chosen]?.label}</span>
              </>
            ) : <span className="qlive-seq-empty" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

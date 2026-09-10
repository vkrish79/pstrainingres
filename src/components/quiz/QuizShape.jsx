import { shapeFor } from '../../lib/quizShapes.js';

// One answer's shape badge. SVG rather than a unicode glyph (▲ ◆ ● ■) because
// those render at wildly different weights and baselines across platforms, and
// this is going on a wall at the back of a room.
//
// Sized by the CSS box it sits in — a percentage of .qlive-badge or
// .quiz-opt-badge — so the projector and the editor get the same shape at very
// different sizes without a second component.
export default function QuizShape({ index, title }) {
  const s = shapeFor(index);
  return (
    <svg
      className="quiz-shape"
      viewBox="0 0 24 24"
      role="img"
      // The shape's name, so a screen reader says "Triangle" rather than
      // reading nothing where every sighted user sees an identity.
      aria-label={title ?? s.label}
    >
      {s.circle
        ? <circle cx="12" cy="12" r="10" />
        : <polygon points={s.points} />}
    </svg>
  );
}

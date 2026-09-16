import '../../styles/quiz-timer.css';

// The countdown clock for the quiz and the poll: a gold ring that empties as
// time runs out, with the seconds in the middle. A bare number says how long is
// left; the ring says how much is gone, which is what the back of a room reads.
//
// Both numbers come from the caller, already corrected for this device's clock
// (useQuizRun / useActivePoll measure the skew against server_now). `total` is
// the whole length — ends minus started, both server stamps.
const R = 16;
const C = 2 * Math.PI * R;

// Seconds between two server timestamps, or 0 if either is missing.
export function spanSeconds(startedAt, endsAt) {
  if (!startedAt || !endsAt) return 0;
  return (new Date(endsAt) - new Date(startedAt)) / 1000;
}

export default function QuizTimer({ total, secondsLeft, className = '' }) {
  const left = secondsLeft ?? 0;
  const frac = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;

  return (
    <div className={`qlive-timer ${className}`} role="timer" aria-label="Seconds remaining">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="qlive-timer-track" cx="20" cy="20" r={R} />
        <circle
          className="qlive-timer-arc"
          cx="20"
          cy="20"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <span className="qlive-timer-num">{Math.ceil(left)}</span>
    </div>
  );
}

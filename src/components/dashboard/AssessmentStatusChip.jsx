import { useCountdown, assessmentState, STATE_LABEL } from '../../lib/assessmentTimer.js';

// Read-only assessment status, in the session header.
//
// What used to sit here was the whole lock CONTROL — five render states, one of
// them a form — injected into the header's action row. The toolbar's size
// therefore depended on the control's state: measured at a fixed 1140px
// viewport, the header swung between 215px and 341px as a side effect of
// clicking Unlock, and the "minutes" field rendered anywhere from 433px to
// 602px wide. The controls now live in the Assessment tab, where they have
// room; this is what stays behind.
//
// A STATUS IS MORE USEFUL HERE THAN A BUTTON. The question a trainer has while
// looking at the participants list is "is the assessment open, and how long is
// left" — not "let me change it". Clicking takes them to the tab that can.
//
// Its width changes by a few characters as the clock counts down and never by
// more, so it cannot reflow the row it sits in.
export default function AssessmentStatusChip({ unlockedAt, deadlineAt, onOpen }) {
  const { label, expired, urgent } = useCountdown(deadlineAt);
  const state = assessmentState(unlockedAt, expired);

  return (
    <button
      type="button"
      className={`assessment-status-chip is-${state}${urgent ? ' is-urgent' : ''}`}
      onClick={onOpen}
      title="Open the Assessment tab"
    >
      <span className="assessment-status-dot" aria-hidden />
      Assessment · {STATE_LABEL[state]}
      {state === 'open' && label && <span className="assessment-status-time">{label}</span>}
    </button>
  );
}

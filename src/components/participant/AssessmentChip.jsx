import { useEffect, useState } from 'react';
import { useServerOffset } from '../../lib/serverTime.js';

// The assessment in the participant's action bar, saying its state rather than
// being one more identical button: not open yet, open with the time left,
// or closed. Opens the assessment when it can be taken.
//
// Time left is counted on the SERVER's clock (the deadline is a server time,
// and a laptop can run most of a minute off), so the chip reaches 0:00 when
// the database stops taking answers.
export default function AssessmentChip({ unlockedAt, deadlineAt, onOpen }) {
  const deadline = deadlineAt ? new Date(deadlineAt).getTime() : null;
  const offset = useServerOffset();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!unlockedAt || !deadline) return undefined;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [unlockedAt, deadline]);

  if (!unlockedAt) {
    return (
      <span className="pab-chip is-locked" data-tip="Your trainer will open the assessment when it is time">
        🔒 Assessment · not open yet
      </span>
    );
  }

  void tick;
  const left = deadline ? deadline - (Date.now() + offset) : null;
  if (left != null && left <= 0) {
    return (
      <button type="button" className="pab-chip is-closed" onClick={onOpen} data-tip="Time is up — open it to see your answers">
        📝 Assessment · closed
      </button>
    );
  }

  const soon = left != null && left < 5 * 60000;
  return (
    <button
      type="button"
      className={`pab-chip is-open${soon ? ' is-soon' : ''}`}
      onClick={onOpen}
      data-tip="Open the assessment"
    >
      📝 Assessment · open{left != null && <> · <span className="pab-chip-time">{formatLeft(left)}</span> left</>}
    </button>
  );
}

// 42:10, or 1:05:30 past an hour.
function formatLeft(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

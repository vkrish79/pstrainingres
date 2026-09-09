import { useEffect, useMemo, useState } from 'react';
import { useServerOffset } from './serverTime.js';

// The assessment countdown, shared by the header chip and the run strip.
//
// It lived inside AssessmentLockControl when that component was the only thing
// showing a timer. Now two places show it — a status chip in the session header
// and the controls in the Assessment tab — and they must agree to the second,
// so the logic belongs in one place rather than being copied.
//
// Ticks only while there IS a deadline. A locked or untimed assessment sets no
// interval at all.
export function useCountdown(deadlineAt) {
  const deadlineMs = deadlineAt ? new Date(deadlineAt).getTime() : null;
  // Server time, not browser time. The deadline was stamped by the database,
  // so comparing it against a drifted local clock shows the wrong number —
  // see lib/serverTime.js.
  const offset = useServerOffset();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs == null) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      // Nothing changes once the deadline is past, so stop waking the page up
      // every second for the rest of the session.
      if (t + offset >= deadlineMs) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineMs, offset]);

  return useMemo(() => {
    if (deadlineMs == null) return { label: null, expired: false, remainingMs: null, urgent: false };
    const remainingMs = deadlineMs - (nowMs + offset);
    const total = Math.max(0, Math.floor(remainingMs / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return {
      label: h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`,
      expired: remainingMs <= 0,
      remainingMs,
      // Under five minutes is when a trainer might want to add time, so the
      // chip changes colour rather than waiting until it has already run out.
      urgent: remainingMs > 0 && remainingMs <= 5 * 60 * 1000,
    };
  }, [deadlineMs, nowMs, offset]);
}

// The three states an assessment can be in, named once so the chip and the
// strip cannot describe the same thing differently.
export function assessmentState(unlockedAt, expired) {
  if (!unlockedAt) return 'locked';
  return expired ? 'expired' : 'open';
}

export const STATE_LABEL = {
  locked: 'Locked',
  open: 'Open',
  expired: "Time's up",
};

import { useEffect, useState } from 'react';

// A raised hand, on whichever tab the trainer is actually on.
//
// The hands were always there — useHelpRequests is called at page level, so
// every open ask has been in scope on Workbook, Assessment, Quiz and Polls the
// whole time. What was missing was anywhere to show it: all four displays sat
// inside the Room tab, and a trainer working through the workbook never learned
// a hand had gone up. The participant had no way to tell they'd been missed
// either, which is the part that makes it worse than no feature at all.
//
// NOT DISMISSIBLE, on purpose, and following the low-prep banner's rule: the
// only thing dismissing would change is whether you are told. It goes when the
// hand goes — when you say you're coming, or when you mark it helped.
//
// It says who and where in words rather than carrying a count. A badge reading
// "2" makes you go and find out what it means; this has already told you. That
// is the same reasoning that took the count badge off the top bar.
export default function HandsBar({ hands, participants, onAcknowledge, onResolve, onShowInRoom, error }) {
  // Re-render on a slow tick so "up 4m" doesn't sit there saying "up 1m" for
  // the rest of the morning. Nothing is fetched — this only re-reads the clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hands.length) return undefined;
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, [hands.length]);

  if (!hands.length) return null;

  // Oldest first — the hook already orders them that way, and whoever has
  // waited longest is who you should be going to.
  const first = hands[0];
  const extra = hands.length - 1;
  const person = participants.find(p => p.id === first.participant_id);
  const name = person?.full_name || 'Someone';
  const coming = !!first.acknowledged_at;

  return (
    <div className={`hands-bar${coming ? ' is-coming' : ''}`} role="status">
      <span className="hands-bar-icon" aria-hidden="true">{coming ? '👋' : '✋'}</span>

      <span className="hands-bar-what">
        <strong>{name}</strong>
        {coming ? ' — you said you’re coming over' : ' needs you'}
        {first.section_title && <span className="hands-bar-where"> · {first.section_title}</span>}
        <span className="hands-bar-age"> · up {ageOf(first.raised_at)}</span>
      </span>

      {extra > 0 && (
        <button type="button" className="hands-bar-more" onClick={onShowInRoom}>
          +{extra} more
        </button>
      )}

      {/* Acknowledging from here is the point of the whole thing: a trainer
          mid-exercise can say "I'm coming" without leaving the exercise they
          were explaining. */}
      {coming ? (
        <button type="button" className="hands-bar-btn" onClick={() => onResolve(first.id)}>
          ✓ Helped
        </button>
      ) : (
        <button type="button" className="hands-bar-btn is-primary" onClick={() => onAcknowledge(first.id)}>
          👋 I’m coming over
        </button>
      )}

      {error && <span className="hands-bar-error">{error}</span>}
    </div>
  );
}

function ageOf(raisedAt) {
  const ms = Date.now() - new Date(raisedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

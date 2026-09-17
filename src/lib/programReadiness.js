import { sessionDay } from './sessionPace.js';

// What a programme has, and what its classes are doing — the facts both
// Programmes screens draw their gauges, tiles and "Needs you" from.
//
// Kept apart from the pages so the list and the programme page cannot disagree
// about what "running" or "ready" means, and so node can import it.

// A WORKBOOK IS THE ONLY REQUIRED PIECE. create_session_from_program refuses a
// programme without one; the assessment is optional (a deliberate decision —
// Overview is published without one), so a missing assessment is never drawn
// as a problem, only as "None".
export function isReady(p) {
  return !!p.workbook;
}

// One class, as a programme sees it.
//   running — today is inside its dates and it is not closed
//   upcoming — not started yet
//   ended   — past its dates and not closed (the Sessions page nudges these)
//   undated — no dates, not closed
//   closed
export function classState(s, now = new Date()) {
  if (s.closed_at) return { key: 'closed', label: 'Closed' };
  const day = sessionDay(s.starts_at, s.ends_at, now);
  if (!day) return { key: 'undated', label: 'No dates' };
  if (day.before) return { key: 'upcoming', label: `Starts in ${day.inDays} day${day.inDays === 1 ? '' : 's'}` };
  if (day.after) return { key: 'ended', label: 'Ended, still open' };
  return { key: 'running', label: `Running · day ${day.n} of ${day.total}` };
}

// A session that has passed its end date and was never closed.
export function isLeftOpen(s, now = new Date()) {
  return classState(s, now).key === 'ended';
}

// "16–22 Sep", "12 Aug – 3 Sep", "13 Jul 2025 – 2 Jan 2026".
export function shortRange(startsAt, endsAt, now = new Date()) {
  if (!startsAt && !endsAt) return 'No dates';
  const a = new Date(startsAt || endsAt);
  const b = new Date(endsAt || startsAt);
  const year = a.getFullYear() !== now.getFullYear() || b.getFullYear() !== now.getFullYear();
  const fmt = (d, opts) => d.toLocaleDateString('en-GB', opts);
  if (a.toDateString() === b.toDateString()) return fmt(a, { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) });
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()}–${fmt(b, { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) })}`;
  }
  const o = { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) };
  return `${fmt(a, o)} – ${fmt(b, o)}`;
}

export function shortDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(!sameYear && { year: 'numeric' }) });
}

// A PDF's title from its file name: no extension, underscores as spaces.
export function titleFromFile(name) {
  return (name || '').replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim() || 'Untitled';
}

// Counts for a programme's classes, newest first.
export function classSummary(sessions, now = new Date()) {
  const list = [...(sessions || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const withState = list.map(s => ({ ...s, state: classState(s, now) }));
  return {
    list: withState,
    total: withState.length,
    running: withState.filter(s => s.state.key === 'running'),
    open: withState.filter(s => s.state.key !== 'closed'),
    closed: withState.filter(s => s.state.key === 'closed'),
    lastCreated: list[0]?.created_at || null,
  };
}

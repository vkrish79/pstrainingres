// The numbers on the session cockpit: where the class is, who is behind it,
// who has gone quiet. Pure, so it can be reasoned about without a browser.
//
// Everyone here is an ACTIVE participant — dropouts are left out of every
// figure. Someone who has gone home is not behind the class, and counting them
// would drag the class pace down for the people still in the room.

// "Behind" means more than this share below class pace. A share rather than a
// fixed number of items, because five items behind is nothing in a 300-item
// workbook and most of an exercise in a 20-item one.
export const BEHIND_SHARE = 0.2;

// "Quiet" means online, but nothing answered AND not moved to another exercise
// for this long. Moving counts: someone paging through the workbook is reading,
// and listing them beside a green "live" dot in the table was a contradiction a
// trainer saw on the first real class. Deliberately NOT the dashboard's own
// "idle" dot, which means "hasn't moved in 45 seconds".
export const QUIET_MS = 10 * 60 * 1000;

// The middle value — half the class is at or past it. The middle and not the
// average, so one person far behind cannot pull everyone else's pace down.
export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// When this person last did anything: answered, or moved exercise.
export function lastActiveTs(p) {
  const a = p.lastTs ? new Date(p.lastTs).getTime() : 0;
  const m = p.movedTs ? new Date(p.movedTs).getTime() : 0;
  const t = Math.max(a, m);
  return t ? new Date(t).toISOString() : null;
}

// people: [{ id, name, answered, lastTs, movedTs, online, dropped }]
//   lastTs  — last answer saved
//   movedTs — last change of exercise (the cursor's moved_at)
export function sessionPace(people, now = Date.now()) {
  const active = people.filter(p => !p.dropped);
  const pace = median(active.map(p => p.answered));
  const line = pace * (1 - BEHIND_SHARE);

  const behind = pace > 0
    ? active.filter(p => p.answered < line).sort((a, b) => a.answered - b.answered)
    : [];
  const quiet = active
    .map(p => ({ ...p, lastActive: lastActiveTs(p) }))
    .filter(p => p.online && (!p.lastActive || now - new Date(p.lastActive).getTime() >= QUIET_MS))
    .sort((a, b) => (a.lastActive ? new Date(a.lastActive).getTime() : 0) - (b.lastActive ? new Date(b.lastActive).getTime() : 0));
  const online = active.filter(p => p.online);
  // Offline only matters once the class has started: before anyone is in, all
  // of them are "offline" and a list of the whole roster helps nobody.
  const offline = online.length > 0 ? active.filter(p => !p.online && p.answered > 0) : [];

  return { active, pace, behind, quiet, online, offline };
}

// "Day 2 of 5" from the session's dates, or null outside them. Calendar days in
// the viewer's own timezone, counting both the first and last day.
export function sessionDay(startsAt, endsAt, now = new Date()) {
  if (!startsAt || !endsAt) return null;
  const day = d => { const x = new Date(d); return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()); };
  const DAY = 86400000;
  const total = Math.round((day(endsAt) - day(startsAt)) / DAY) + 1;
  const n = Math.round((day(now) - day(startsAt)) / DAY) + 1;
  if (total < 1) return null;
  if (n < 1) return { before: true, total, inDays: 1 - n };
  if (n > total) return { after: true, total };
  return { n, total };
}

// "4 min ago", "2 h 10 min ago" — short enough for a gauge hint.
export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const m = Math.floor((now - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// The calendar's date arithmetic, kept OUT of the component.
//
// It lived in SessionCalendar.jsx, which meant none of it could be tested:
// node cannot import a file containing JSX, so .verify/calendar-logic.test.mjs
// has never actually run — it fails at the import with
// ERR_UNKNOWN_FILE_EXTENSION. Same reason lib/sessionFilters.js exists.
//
// Everything here is pure, so `node <file>` can exercise it. Which matters
// more for spans than for most things: getting the quarter wrong draws a
// perfectly good calendar of the wrong three months.
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];


// The Monday on or before the 1st, so the grid starts on a whole week.
// (getDay() is Sunday-first; +6 %7 rotates it to Monday-first.)
export function startOfMonthGrid(monthDate) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  const grid = new Date(first);
  grid.setDate(grid.getDate() - dow);
  grid.setHours(0, 0, 0, 0);
  return grid;
}

export function dayStart(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function diffDays(a, b) {
  return Math.round((b - a) / 86400000);
}

// Which sessions touch this week, where each starts, how far it runs, and
// which track it sits in. Lifted from MonthBlock.packWeek().
//
// Sorting by start then by longest-first matters: it makes the packing
// deterministic, so a session does not hop between rows when an unrelated one
// is added.
export function packWeek(weekStart, sessions) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const visible = sessions
    .map(s => {
      if (!s.starts_at && !s.ends_at) return null;
      const start = dayStart(s.starts_at || s.ends_at);
      const end = dayStart(s.ends_at || s.starts_at);
      if (end < weekStart || start >= weekEnd) return null;
      const col = Math.max(0, diffDays(weekStart, start));
      const endCol = Math.min(6, diffDays(weekStart, end));
      return {
        session: s,
        col,
        span: endCol - col + 1,
        start,
        // Whether the bar is cut off by the edge of this week, so the drawing
        // can show it continues rather than implying it stops here.
        clippedStart: start < weekStart,
        clippedEnd: end >= weekEnd,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.start - b.start) || (b.span - a.span));

  const trackEnds = [];
  return visible.map(item => {
    let track = trackEnds.findIndex(endCol => item.col > endCol);
    if (track < 0) { track = trackEnds.length; trackEnds.push(-1); }
    trackEnds[track] = item.col + item.span - 1;
    return { ...item, track };
  });
}


// The months a view covers.
//
// The quarter is the one CONTAINING the anchor, not three months starting from
// it — so September gives Jul/Aug/Sep, and a header reading "Q3" sits above
// the real Q3. Three-from-here would label Q3 and draw Q4, which renders
// perfectly and is simply wrong.
export function monthsForView(anchor, view) {
  const y = anchor.getFullYear();
  if (view === 'year') return Array.from({ length: 12 }, (_, i) => new Date(y, i, 1));
  if (view === 'quarter') {
    const first = Math.floor(anchor.getMonth() / 3) * 3;
    return [0, 1, 2].map(o => new Date(y, first + o, 1));
  }
  return [new Date(y, anchor.getMonth(), 1)];
}

// Step the anchor by one period of whatever span is on screen.
// `m` is the "2026-09" the URL carries.
export function stepSpan(m, span, delta) {
  const months = span === 'year' ? 12 : span === 'quarter' ? 3 : 1;
  const d = parseMonthKey(m);
  d.setMonth(d.getMonth() + months * delta);
  return monthKeyOf(d);
}

// What the stepper reads: "September 2026", "Q3 2026", or "2026".
export function spanLabel(m, span) {
  const d = parseMonthKey(m);
  if (span === 'year') return String(d.getFullYear());
  if (span === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Does any month on screen hold anything? Across EVERY month shown, not one —
// a quarter with sessions only in its third month would otherwise report empty.
export function hasAnyInMonths(months, sessions) {
  const list = sessions || [];
  return months.some(m => {
    const gridStart = startOfMonthGrid(m);
    for (let w = 0; w < 6; w += 1) {
      const ws = new Date(gridStart);
      ws.setDate(ws.getDate() + w * 7);
      if (packWeek(ws, list).length) return true;
    }
    return false;
  });
}

// "2026-09" ⇄ Date. Readable, sortable, and unambiguous about which month is
// meant, which a locale-formatted string is not.
export function monthKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthKey(m) {
  const [y, mo] = String(m || '').split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  return new Date(y, mo - 1, 1);
}

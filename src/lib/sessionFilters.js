// The session filter predicate and its key list, kept OUT of the component.
//
// It lived in SessionFilters.jsx, which meant it could not be tested: node
// cannot import a file containing JSX, so .verify/filters-logic.test.mjs has
// never actually run — it fails at the import with ERR_UNKNOWN_FILE_EXTENSION.
// A test that cannot run is worse than no test, because the file's presence
// says the logic is covered.
//
// Everything here is pure and dependency-free, so `node <file>` can exercise it.

// THE ONE LIST OF FILTER KEYS. It used to be written out by hand in five
// places — the predicate below, the `filters` object in SessionViews, the
// __clear__ branch of setFilter, the `active` count in SessionFilters, and a
// useMemo dependency array. Adding the vendor filter meant updating all five.
// Miss the __clear__ one and "Clear filters" silently leaves a filter applied;
// miss the count and the button says "Clear 1 filter" when two are set.
// Neither shows up in a build. So: one export, five consumers.
// `when` REPLACED `late`. The left-open nudge used to be the only thing that
// could set a time filter, and it could only set one value, so a boolean key
// was enough. The hero now offers four — all / running / upcoming / left open —
// and four states do not fit in a yes-or-nothing key. One key with four values
// also makes them mutually exclusive by construction, which is what the tab
// group promises: a session cannot be both running and still to start.
export const FILTER_KEYS = ['q', 'program', 'type', 'city', 'trainer', 'vendor', 'when'];

// The filters that live behind the "Filters" button rather than on the row.
// The badge on that button counts THESE and nothing else: `q` and `trainer`
// are inline where you can already see them, and `when` is a tab that is
// visibly pressed — counting any of the three would light the badge for a
// filter the reader is looking straight at.
export const POPOVER_KEYS = ['program', 'type', 'city', 'vendor'];

// Everything except `when`. The tab group resets itself — "All" is right there
// — so a "Clear filters" that also jumped you off the Left-open tab you
// deliberately chose would be undoing something you did not ask it to.
export const CLEARABLE_KEYS = FILTER_KEYS.filter(k => k !== 'when');

// Calendar day in local time, so that everything below compares whole days
// rather than instants. A class ending at 17:00 today has not "ended" in any
// sense a trainer means until tomorrow, and the cockpit's "Day 1 of 7" already
// counts this way.
function dayOf(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// A session whose last day is before today and that nobody closed.
export function isLeftOpen(s, now = new Date()) {
  if (!s || s.closed_at || !s.ends_at) return false;
  return dayOf(s.ends_at) < dayOf(now);
}

// In its dates today. ends_at falls back to starts_at, because a one-day class
// is stored with both set but a pre-migration row may only have the start —
// and treating a missing end as "runs forever" would make it permanently live.
export function isRunning(s, now = new Date()) {
  if (!s || s.closed_at || !s.starts_at) return false;
  const today = dayOf(now);
  return dayOf(s.starts_at) <= today && today <= dayOf(s.ends_at || s.starts_at);
}

// Still to start. An undated session is NOT upcoming: it has no position on a
// timeline, which is exactly why the calendar cannot draw it either.
export function isUpcoming(s, now = new Date()) {
  if (!s || s.closed_at || !s.starts_at) return false;
  return dayOf(s.starts_at) > dayOf(now);
}

// A session with no vendor_id is delivered by PS itself rather than by a
// vendor. That is a real category a reader wants to filter to, not an absence,
// so it gets a sentinel value rather than being lumped in with "all".
export const PS_IN_HOUSE = '__ps__';

// A session can have no program at all — the list already prints "—" in that
// column for them. They get a sentinel for the same reason in-house sessions
// do: "no program" is a real group somebody wants to pull up (those are the
// rows whose program was never set), not a gap to be silently unreachable.
export const NO_PROGRAM = '__none__';

export function filterSessions(sessions, f) {
  const q = (f.q || '').trim().toLowerCase();
  return (sessions || []).filter(s => {
    // PROGRAM AND TYPE ARE TWO AXES, not one. A program type ("Certification")
    // groups many programs; a program ("Amadeus R&T (ARDW) - Certification")
    // is the thing a session actually runs. The type filter used to wear the
    // label "All programs" and was the only one of the two that existed, which
    // is why a list could not be narrowed to one program — and why, for a
    // program with no type set, it offered nothing at all.
    if (f.program && f.program !== 'all') {
      const p = s.program?.id || NO_PROGRAM;
      if (p !== f.program) return false;
    }
    if (f.type && f.type !== 'all' && (s.program?.program_type?.id || '') !== f.type) return false;
    if (f.city && f.city !== 'all' && (s.city_code || '') !== f.city) return false;
    if (f.trainer && f.trainer !== 'all' && (s.trainer?.id || '') !== f.trainer) return false;
    if (f.vendor && f.vendor !== 'all') {
      const v = s.vendor_id || PS_IN_HOUSE;
      if (v !== f.vendor) return false;
    }
    // `when` is set from the hero's tab group, not from a select.
    if (f.when === 'running' && !isRunning(s)) return false;
    if (f.when === 'upcoming' && !isUpcoming(s)) return false;
    if (f.when === 'late' && !isLeftOpen(s)) return false;
    if (!q) return true;
    // Search covers what is on screen: the name, and the columns a reader
    // might be scanning for instead.
    return [
      s.name,
      s.program?.title,
      s.program?.program_type?.name,
      s.trainer?.full_name,
      s.city_code,
      s.vendors?.name,
      s.vendors?.code,
    ].some(v => (v || '').toLowerCase().includes(q));
  });
}

// The options each select offers, derived from the sessions in hand so a filter
// can never present a choice that would return nothing.
export function filterOptions(sessions) {
  const t = new Map();
  const c = new Set();
  const tr = new Map();
  const vn = new Map();
  const pg = new Map();

  for (const s of sessions || []) {
    const pt = s.program?.program_type;
    if (pt?.id) t.set(pt.id, pt.name || 'Untitled');
    // The program itself, by title — which is what the second line of the
    // Program column shows, so the filter offers the words already on screen.
    if (s.program?.id) pg.set(s.program.id, s.program.title || 'Untitled');
    else pg.set(NO_PROGRAM, 'No program');
    if (s.city_code) c.add(s.city_code);
    if (s.trainer?.id) tr.set(s.trainer.id, s.trainer.full_name || 'Unnamed');
    // Sessions with no vendor are delivered in-house, which is a choice worth
    // offering — not a gap to leave out of the list.
    if (s.vendor_id) vn.set(s.vendor_id, s.vendors?.name || s.vendors?.code || 'Vendor');
    else vn.set(PS_IN_HOUSE, 'PS in-house');
  }

  const byName = (a, b) => a[1].localeCompare(b[1]);
  // PS first, then vendors alphabetically. It is the house, not one of the
  // guests, and sorting it under "P" would be pedantry.
  const vendors = [...vn.entries()].filter(([id]) => id !== PS_IN_HOUSE).sort(byName);
  if (vn.has(PS_IN_HOUSE)) vendors.unshift([PS_IN_HOUSE, 'PS in-house']);

  // Same shape as vendors: the real ones alphabetically, and "No program"
  // pushed to the END rather than sorted under N. It is the absence, so it
  // belongs after the things that are there — the mirror of PS leading the
  // vendor list because it is the house.
  const programs = [...pg.entries()].filter(([id]) => id !== NO_PROGRAM).sort(byName);
  if (pg.has(NO_PROGRAM)) programs.push([NO_PROGRAM, 'No program']);

  return {
    programs,
    types: [...t.entries()].sort(byName),
    cities: [...c].sort(),
    trainers: [...tr.entries()].sort(byName),
    vendors,
  };
}

// Everything the gauge strip and the tab counts need, in ONE pass.
//
// Pure and here rather than in the component for the same reason the predicate
// is: node can run it. It is also the reason the tabs and the gauges can never
// disagree — "Left open · 4" on a tab and "4" on a gauge are the same number
// read out of the same object, not two filters written twice.
//
// Counted on EVERYTHING LOADED, never on what a filter is showing. A strip
// that re-counts itself as you filter cannot answer "how much is there", which
// is the only question it exists for — and "Left open · 0" the moment you
// click "Left open" would be absurd.
export function sessionStats(sessions, now = new Date()) {
  const rows = sessions || [];
  const programs = new Set();
  const trainers = new Set();
  let running = 0;
  let upcoming = 0;
  let leftOpen = 0;
  let undated = 0;
  let people = 0;
  let next = null;

  for (const s of rows) {
    if (isRunning(s, now)) running += 1;
    if (isLeftOpen(s, now)) leftOpen += 1;
    if (isUpcoming(s, now)) {
      upcoming += 1;
      // The soonest one, which is what "Next up" means. Sessions arrive
      // ordered by created_at, so this cannot be taken off the front.
      if (!next || dayOf(s.starts_at) < dayOf(next.starts_at)) next = s;
    }
    if (!s.starts_at && !s.ends_at) undated += 1;
    people += (s.session_participants || []).length;
    if (s.program?.id) programs.add(s.program.id);
    if (s.trainer?.id) trainers.add(s.trainer.id);
  }

  return {
    total: rows.length,
    running,
    upcoming,
    leftOpen,
    undated,
    people,
    programs: programs.size,
    trainers: trainers.size,
    next,
  };
}

// "in 6 weeks" / "ended 7 days ago" / "today". The relative half of a date
// cell: the absolute date says which class, this says whether it wants you.
//
// Whole calendar days, like everything else here, so a class that ended
// yesterday evening reads "ended 1 day ago" and not "ended 14 hours ago".
export function relativeDay(value, now = new Date()) {
  if (!value) return '';
  const days = Math.round((dayOf(value) - dayOf(now)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const n = Math.abs(days);
  const unit = n < 14
    ? `${n} days`
    : n < 60
      ? `${Math.round(n / 7)} weeks`
      : `${Math.round(n / 30)} months`;
  return days > 0 ? `in ${unit}` : `${unit} ago`;
}

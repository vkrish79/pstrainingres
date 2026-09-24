// Every figure the Analytics page shows, derived in one place.
//
// ONE SOURCE OF TRUTH: session_analytics carries both per-person rows
// (assessment_results) and pre-tallied counts (assessment_pass_count and
// friends). They disagree — a paper with no pass mark is counted in neither
// pass nor fail, but still exists as a person with a score — so everything
// here is derived from the per-person rows, and the frozen counts are used
// only as a fallback for a session whose rows were never written (sessions
// closed before close-session started recording names).
//
// Percentages are pooled over PAPERS, not sessions: a cohort of 20 weighs
// twenty times a cohort of one, which is what "average score" means to a
// reader. Completion is pooled the same way, over people.

export const PAPER_STATES = {
  pass: 'Passed',
  fail: 'Failed',
  absent: 'Absent',
  incomplete: 'Didn’t finish',
  noresult: 'No pass mark',
};

// close-session writes: { full_name, username, sat, pct, unmarked, result:'PASS'|'FAIL'|null }
function paperState(r) {
  if (!r.sat) return 'absent';
  if (r.unmarked > 0) return 'incomplete';
  if (r.result === 'PASS') return 'pass';
  if (r.result === 'FAIL') return 'fail';
  return 'noresult'; // sat and marked, but the paper has no pass mark
}

// One row per person per paper, across the sessions given.
export function papersOf(sessions) {
  const out = [];
  for (const s of sessions) {
    const a = s.assessment;
    if (!a) continue;
    for (const r of a.results || []) {
      out.push({
        session: s,
        name: r.full_name || r.username || '(unnamed)',
        username: r.username || '',
        pct: r.sat && r.pct != null ? Number(r.pct) : null,
        // The marks behind the percentage. A reader checking a borderline
        // paper wants "4 of 6", not only "67%".
        earned: r.sat ? (r.earned ?? null) : null,
        possible: r.sat ? (r.possible ?? null) : null,
        deactivated: !!r.deactivated,
        state: paperState(r),
      });
    }
  }
  return out;
}

// True when a session recorded papers but not the names behind them: the
// scores are in the frozen counts, the per-person rows were never written.
//
// The test is "are there papers?", NOT "were there participants?" —
// assessment_participant_count can be 0 on a session that still has
// pass/fail counts and scores, and those papers would then vanish from every
// figure on the page.
export function hasUnlistedPapers(s) {
  const a = s.assessment;
  if (!a || (a.results || []).length > 0) return false;
  return a.sat > 0 || a.pass + a.fail > 0 || (a.scorePcts || []).length > 0;
}

export function assessmentStats(sessions) {
  const papers = papersOf(sessions);
  let pass = 0, fail = 0, absent = 0, incomplete = 0;
  const pcts = [];
  for (const p of papers) {
    if (p.state === 'pass') pass += 1;
    else if (p.state === 'fail') fail += 1;
    else if (p.state === 'absent') absent += 1;
    else if (p.state === 'incomplete') incomplete += 1;
    if (p.pct != null) pcts.push(p.pct);
  }
  // Sessions whose per-person rows were never written still count in the
  // totals, or the gauges would under-report what the database knows.
  let unlisted = 0;
  for (const s of sessions) {
    if (!hasUnlistedPapers(s)) continue;
    const a = s.assessment;
    pass += a.pass; fail += a.fail;
    unlisted += a.sat;
    pcts.push(...a.scorePcts);
  }
  const marked = pass + fail;
  return {
    papers, pass, fail, absent, incomplete, unlisted,
    sat: pcts.length,
    marked,
    passRate: marked ? (pass / marked) * 100 : null,
    avgPct: pcts.length ? pcts.reduce((n, p) => n + p, 0) / pcts.length : null,
    pcts,
  };
}

// Completion, weighted by class size. Closed sessions only: a live session's
// progress is interim, and it has no analytics row at all.
export function completionOf(sessions) {
  let people = 0, sum = 0;
  for (const s of sessions) {
    if (!s.isClosed || s.completionPct == null) continue;
    people += s.participants;
    sum += s.completionPct * s.participants;
  }
  return people ? sum / people : null;
}

export function sessionAvgPct(s) {
  const pcts = papersOf([s]).filter(p => p.pct != null).map(p => p.pct);
  if (pcts.length) return pcts.reduce((n, p) => n + p, 0) / pcts.length;
  if (hasUnlistedPapers(s) && s.assessment.avgPct != null) return s.assessment.avgPct;
  return null;
}

export function sessionPassRate(s) {
  const st = assessmentStats([s]);
  return st.passRate;
}

export function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function sumOf(sessions, key) {
  return sessions.reduce((n, s) => n + (s[key] || 0), 0);
}

// Headline figures, shared by the gauges and the Summary download.
export function headline(sessions) {
  const closed = sessions.filter(s => s.isClosed);
  const a = assessmentStats(sessions);
  const sizes = closed.map(s => s.participants);
  return {
    total: sessions.length,
    closed: closed.length,
    open: sessions.length - closed.length,
    people: closed.reduce((n, s) => n + s.participants, 0),
    dropouts: sessions.reduce((n, s) => n + (s.dropouts || 0), 0),
    completion: completionOf(sessions),
    fullyCompleted: sumOf(closed, 'fullyCompleted'),
    belowHalf: sumOf(closed, 'belowThreshold'),
    notStarted: sumOf(closed, 'notStarted'),
    trainingDays: sumOf(closed, 'trainingDays'),
    trainers: new Set(closed.map(s => s.trainerName).filter(Boolean)).size,
    cities: new Set(closed.map(s => s.cityCode).filter(Boolean)).size,
    medianClass: median(sizes),
    largestClass: sizes.length ? Math.max(...sizes) : null,
    smallestClass: sizes.length ? Math.min(...sizes) : null,
    assessment: a,
  };
}

// Month buckets, gap-filled, over the session's own time axis (starts_at,
// falling back to created_at — both already resolved into `date`).
export function monthsOf(sessions) {
  const keys = sessions.map(s => (s.date ? String(s.date).slice(0, 7) : null)).filter(Boolean).sort();
  if (!keys.length) return [];
  const out = [];
  let [y, m] = keys[0].split('-').map(Number);
  const [ey, em] = keys[keys.length - 1].split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, long ? { month: 'short', year: 'numeric' } : { month: 'short' });
}

export function monthlyRows(sessions) {
  return monthsOf(sessions).map((key) => {
    const inMonth = sessions.filter(s => String(s.date || '').startsWith(key));
    const closed = inMonth.filter(s => s.isClosed);
    const a = assessmentStats(inMonth);
    return {
      key,
      label: monthLabel(key),
      sessions: closed.length,
      people: closed.reduce((n, s) => n + s.participants, 0),
      completion: completionOf(inMonth),
      papers: a.sat,
      passRate: a.passRate,
      avgScore: a.avgPct,
    };
  });
}

// Group sessions by one dimension, biggest group first.
export const GROUPINGS = [
  { id: 'type', label: 'Type', key: s => s.typeId ?? '__none__', name: s => s.typeName || 'Untyped' },
  { id: 'trainer', label: 'Trainer', key: s => s.trainerId ?? '__none__', name: s => s.trainerName || '(unknown trainer)' },
  { id: 'city', label: 'City', key: s => s.cityCode ?? '__none__', name: s => s.cityName || 'No city set' },
  // Grouping by the paper answers a question none of the others can: is this
  // assessment too hard, wherever it is run? Sessions without one are left
  // out rather than pooled into an "Untyped" row.
  { id: 'assessment', label: 'Assessment', key: s => s.assessment.title, name: s => s.assessment.title, only: s => !!s.assessment },
  { id: 'vendor', label: 'Vendor', key: s => s.vendorId ?? '__none__', name: s => s.vendorName || 'No vendor (super-delivered)' },
];

export function groupSessions(sessions, groupId) {
  const g = GROUPINGS.find(x => x.id === groupId) || GROUPINGS[0];
  const m = new Map();
  for (const s of (g.only ? sessions.filter(g.only) : sessions)) {
    const k = g.key(s);
    if (!m.has(k)) m.set(k, { key: k, name: g.name(s), sessions: [] });
    m.get(k).sessions.push(s);
  }
  return [...m.values()]
    .map(row => ({ ...row, ...headline(row.sessions) }))
    .sort((a, b) => b.closed - a.closed || b.people - a.people);
}

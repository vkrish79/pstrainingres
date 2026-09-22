// Marking criteria for manual questions.
//
// A manual question can carry a list of CRITERIA — "Name, 4 marks, 1 for each
// name". That comes from the way real marking schemes are written; see the ARDW
// certification score card, where question 1 is nine criteria totalling 25.
//
// The instructor gives each criterion one of three verdicts: all of its marks,
// none of them, or a figure they type with a comment saying why. There is no
// separate notion of a deduction rule — "deduct all 3 if a JVALUE fare was
// quoted" is simply that criterion marked wrong, and the comment carries the
// reason better than a rule could.
//
// Two shapes, both jsonb, both written only by trainer-tier roles:
//
//   assessment_answer_keys.guidance   what the question is marked against
//     { criteria: [ { id, label, marks, note } ] }
//
//   assessment_marks.breakdown        what one participant was awarded
//     { marks: { [criterionId]: { awarded, comment } } }
//
// `awarded` is null for a criterion nobody has judged yet, which is NOT the
// same as zero — the question's mark is not written at all until every
// criterion has a verdict. That mirrors manualResultFor's existing rule that a
// missing mark means "unmarked", never "scored nothing".
//
// Everything here is pure. The editor, the marking list and the report all read
// the same numbers from these functions so they cannot disagree.

export function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Anything can be in a jsonb column, including rows written by an older version
// of this file. Read defensively and hand back a shape the UI can render
// without checking every field again. Earlier drafts also stored a `deductions`
// list; it is ignored rather than migrated, because the feature shipped without
// one ever being authored.
export function normaliseGuidance(guidance) {
  const g = guidance && typeof guidance === 'object' && !Array.isArray(guidance) ? guidance : {};
  const rawC = Array.isArray(g.criteria) ? g.criteria : [];

  const criteria = rawC
    .filter(c => c && typeof c === 'object' && c.id)
    .map(c => ({
      id: String(c.id),
      label: typeof c.label === 'string' ? c.label : '',
      marks: Math.max(0, round1(c.marks)),
      note: typeof c.note === 'string' ? c.note : '',
    }));

  return { criteria };
}

export function emptyGuidance() {
  return { criteria: [] };
}

export function hasCriteria(guidance) {
  return normaliseGuidance(guidance).criteria.length > 0;
}

// What the criteria add up to. This is what the question is worth: `points` is
// written from it whenever the criteria change, so the two can never drift into
// a question capped at 25 holding criteria that sum to 28.
export function criteriaTotal(guidance) {
  return round1(normaliseGuidance(guidance).criteria.reduce((s, c) => s + c.marks, 0));
}

// Ids are short and local to one question ("c1", "c2"). They are what a
// participant's breakdown is keyed by, so they must never be reused for a
// different criterion — always take the next number, never fill a gap.
function nextId(prefix, existing) {
  let max = 0;
  existing.forEach(x => {
    const m = /^[a-z](\d+)$/.exec(String(x.id));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `${prefix}${max + 1}`;
}

export function addCriterion(guidance, patch = {}) {
  const g = normaliseGuidance(guidance);
  return {
    criteria: [...g.criteria, {
      id: nextId('c', g.criteria),
      label: '', marks: 1, note: '',
      ...patch,
    }],
  };
}

export function updateCriterion(guidance, id, patch) {
  const g = normaliseGuidance(guidance);
  return { criteria: g.criteria.map(c => (c.id === id ? { ...c, ...patch } : c)) };
}

export function removeCriterion(guidance, id) {
  const g = normaliseGuidance(guidance);
  return { criteria: g.criteria.filter(c => c.id !== id) };
}

// ---------------------------------------------------------------------------
// What a participant was awarded
// ---------------------------------------------------------------------------

export function normaliseBreakdown(breakdown) {
  const b = breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown) ? breakdown : {};
  const rawM = b.marks && typeof b.marks === 'object' && !Array.isArray(b.marks) ? b.marks : {};
  const marks = {};
  Object.keys(rawM).forEach(k => {
    const e = rawM[k];
    if (!e || typeof e !== 'object') return;
    const n = Number(e.awarded);
    marks[k] = {
      awarded: e.awarded == null || !Number.isFinite(n) ? null : round1(n),
      comment: typeof e.comment === 'string' ? e.comment : '',
    };
  });
  return { marks };
}

export function emptyBreakdown() {
  return { marks: {} };
}

// The one place the arithmetic lives. Returns a row per criterion plus the
// totals the marking list, the question header and the report all display.
//
//   awarded   what the instructor gave this criterion, or null if untouched
//   state     derived from the number, never stored — a stored verdict could
//             disagree with its own mark (press ◐, type 0, and the row would
//             claim "partial" while the arithmetic said "wrong")
//   complete  every criterion has a verdict, so the question's mark may be
//             written; until then the question is unmarked, not low-scoring
export function resolveMarking(guidance, breakdown) {
  const g = normaliseGuidance(guidance);
  const b = normaliseBreakdown(breakdown);

  const rows = g.criteria.map(c => {
    const entry = b.marks[c.id] || { awarded: null, comment: '' };
    const awarded = entry.awarded == null ? null : round1(clamp(entry.awarded, 0, c.marks));

    let state = 'open';
    if (awarded != null) state = awarded >= c.marks ? 'full' : (awarded <= 0 ? 'none' : 'part');

    return { ...c, awarded, comment: entry.comment, state };
  });

  const count = rows.length;
  const markedCount = rows.filter(r => r.awarded != null).length;
  const complete = count > 0 && markedCount === count;
  const total = round1(rows.reduce((s, r) => s + (r.awarded ?? 0), 0));
  const of = criteriaTotal(g);

  let state = 'open';
  if (complete) state = total >= of ? 'full' : (total <= 0 ? 'none' : 'part');

  return { rows, count, markedCount, complete, total, of, state };
}

// Write one criterion's mark into a breakdown, without disturbing the others or
// the comment already against it.
export function setCriterionAward(breakdown, criterionId, awarded) {
  const b = normaliseBreakdown(breakdown);
  const prev = b.marks[criterionId] || { awarded: null, comment: '' };
  return { marks: { ...b.marks, [criterionId]: { ...prev, awarded: awarded == null ? null : round1(awarded) } } };
}

export function setCriterionComment(breakdown, criterionId, comment) {
  const b = normaliseBreakdown(breakdown);
  const prev = b.marks[criterionId] || { awarded: null, comment: '' };
  return { marks: { ...b.marks, [criterionId]: { ...prev, comment: String(comment ?? '') } } };
}

// Every criterion at once — what the question-level ✓ and ✗ shortcuts do.
export function setAllAwards(guidance, breakdown, fraction) {
  const g = normaliseGuidance(guidance);
  const b = normaliseBreakdown(breakdown);
  const marks = { ...b.marks };
  g.criteria.forEach(c => {
    const prev = marks[c.id] || { awarded: null, comment: '' };
    marks[c.id] = { ...prev, awarded: round1(c.marks * fraction) };
  });
  return { marks };
}

// What the report prints for one question: the criteria that fell short, in
// criteria order. A comment on a full-marks criterion is a note to the next
// instructor, not a fault, and is deliberately left off.
export function areasOfError(guidance, breakdown) {
  return resolveMarking(guidance, breakdown).rows
    .filter(r => r.awarded != null && r.awarded < r.marks)
    .map(r => ({
      id: r.id,
      label: r.label,
      awarded: r.awarded,
      marks: r.marks,
      comment: (r.comment || '').trim(),
      zero: r.awarded <= 0,
    }));
}

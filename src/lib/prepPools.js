// What a prep pool holds, worked out ONCE.
//
// Three places used to do this sum separately — the Prep overview, the pool
// detail and the low-prep badge — and two of them had already drifted: a pool
// whose kits carry no values read as "as many as are available" in one and as
// zero in the other. The Prep cockpit puts a "Needs stock" count on the same
// screen as the badge, so they now share this file and cannot disagree.
//
// Pure, so node can import it.

// A pool is "low" when FEWER THAN this many more participants can be FULLY
// prepped (0 = exhausted/empty). Tune here.
export const LOW_PREP_THRESHOLD = 16;

const filled = v => v != null && String(v).trim() !== '';

// SPENT BY A CLASS — used, by a class that has since closed — is history. Its
// prep is already snapshotted in the closed session, nothing can be done to it
// here, and there is one more of it for every participant of every class that
// ever ran. Listing it would grow the Prep screens forever for no action, so
// the screens never load it. It stays in the table; it is just not shown.
//
// A kit WITHDRAWN BY HAND (used, no class) is different: a trainer pulled it
// and can put it back, so it is still loaded and still listed.
//
// Deleting a closed class blanks the class link on its spent kits (ON DELETE
// SET NULL), which would make them look withdrawn by hand. The delete trigger
// (release_prep_kits_on_session_delete) stamps them `class_deleted_at` first,
// so they are still recognised as spent.
export function isSpentByClass(k) {
  return k?.status === 'used' && (!!k.consumed_session_id || !!k.class_deleted_at);
}

// The same rule as a PostgREST filter, for every query that loads kits for
// display: `q.or(LIVE_KITS_FILTER)` — keeps anything not used, and used kits
// with no class and no deleted class behind them (withdrawn by hand).
export const LIVE_KITS_FILTER = 'status.neq.used,and(consumed_session_id.is.null,class_deleted_at.is.null)';

// kits: [{ status, payload, consumed_session_id?, consumed_at? }]
//
//   available — in the pool, never drawn
//   held      — allocated, and a class still holds it
//   stranded  — allocated, but to NO class: the session link is gone and
//               nothing handed the kit back. Defined by exactly that and
//               nothing else; a class the caller merely cannot read still has
//               its id here, so it counts as held.
//   used      — spent; `withdrawn` is the part of it a trainer pulled by hand
//               (used with no session) rather than a class closing. The screens
//               load only live kits (LIVE_KITS_FILTER), so there `used` and
//               `withdrawn` are the same number.
//   fullyPreppable — the lowest per-column availability among AVAILABLE kits.
//               A complete kit needs a value in every prep column, so the
//               emptiest column is the limit. Falls back to the available
//               count when no kit carries any value at all.
export function summariseKits(kits = []) {
  let available = 0, allocated = 0, stranded = 0, used = 0, withdrawn = 0;
  let lastDrawn = null;
  const perSection = {};            // header -> { total, available }
  const heldSessions = new Set();
  const closedSessions = new Set();

  for (const k of kits) {
    if (k.status === 'available') available++;
    else if (k.status === 'allocated') {
      allocated++;
      if (k.consumed_session_id) heldSessions.add(k.consumed_session_id);
      else stranded++;
    } else if (k.status === 'used') {
      used++;
      if (k.consumed_session_id) closedSessions.add(k.consumed_session_id);
      else withdrawn++;
    }
    if (k.consumed_at && (!lastDrawn || k.consumed_at > lastDrawn)) lastDrawn = k.consumed_at;
    for (const [h, v] of Object.entries(k.payload || {})) {
      if (!filled(v)) continue;
      const p = perSection[h] || (perSection[h] = { total: 0, available: 0 });
      p.total++;
      if (k.status === 'available') p.available++;
    }
  }

  const avs = Object.values(perSection).map(p => p.available);
  return {
    total: kits.length,
    available,
    allocated,
    held: allocated - stranded,
    stranded,
    used,
    withdrawn,
    perSection,
    fullyPreppable: avs.length ? Math.min(...avs) : available,
    lastDrawn,
    heldSessionIds: [...heldSessions],
    closedSessionIds: [...closedSessions],
  };
}

export const EMPTY_SUMMARY = summariseKits([]);

// Kits missing a value in at least one of the parent's prep columns.
export function incompleteKits(kits = [], structure = []) {
  if (!structure.length) return [];
  return kits.filter(k => structure.some(c => !filled(k.payload?.[c.header])));
}

// 'noprep' — no prep columns and no kits: a template that simply needs none
// 'empty'  — nobody can be fully prepped
// 'low'    — under the threshold
// 'ok'
export function poolState(hasTemplate, summary) {
  if (!hasTemplate && summary.total === 0) return 'noprep';
  if (summary.fullyPreppable === 0) return 'empty';
  if (summary.fullyPreppable < LOW_PREP_THRESHOLD) return 'low';
  return 'ok';
}

export function needsStock(state) {
  return state === 'empty' || state === 'low';
}

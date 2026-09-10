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
export const FILTER_KEYS = ['q', 'type', 'city', 'trainer', 'vendor'];

// A session with no vendor_id is delivered by PS itself rather than by a
// vendor. That is a real category a reader wants to filter to, not an absence,
// so it gets a sentinel value rather than being lumped in with "all".
export const PS_IN_HOUSE = '__ps__';

export function filterSessions(sessions, f) {
  const q = (f.q || '').trim().toLowerCase();
  return (sessions || []).filter(s => {
    if (f.type && f.type !== 'all' && (s.program?.program_type?.id || '') !== f.type) return false;
    if (f.city && f.city !== 'all' && (s.city_code || '') !== f.city) return false;
    if (f.trainer && f.trainer !== 'all' && (s.trainer?.id || '') !== f.trainer) return false;
    if (f.vendor && f.vendor !== 'all') {
      const v = s.vendor_id || PS_IN_HOUSE;
      if (v !== f.vendor) return false;
    }
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

  for (const s of sessions || []) {
    const pt = s.program?.program_type;
    if (pt?.id) t.set(pt.id, pt.name || 'Untitled');
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

  return {
    types: [...t.entries()].sort(byName),
    cities: [...c].sort(),
    trainers: [...tr.entries()].sort(byName),
    vendors,
  };
}

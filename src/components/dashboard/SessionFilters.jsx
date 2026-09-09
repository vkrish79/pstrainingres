import { useMemo } from 'react';

// Filters for a session list, in whichever view it is being drawn.
//
// Modelled on the archive page's .archive-toolbar, which already had this
// shape: a search box, then selects whose options come from the data rather
// than a hard-coded list. Matching it means the two surfaces behave the same
// way rather than being two different ideas about filtering.
//
// A SELECT ONLY APPEARS WHEN THERE IS SOMETHING TO CHOOSE BETWEEN. A "City"
// dropdown offering only AUH is a control that cannot do anything — it costs a
// glance every time and rewards it never. Same for programme type and trainer.
//
// Filters live ABOVE the view switch and apply to all three views, so changing
// the view changes how the same set is drawn rather than quietly widening it
// back to everything.

export function filterSessions(sessions, f) {
  const q = (f.q || '').trim().toLowerCase();
  return (sessions || []).filter(s => {
    if (f.type && f.type !== 'all' && (s.program?.program_type?.id || '') !== f.type) return false;
    if (f.city && f.city !== 'all' && (s.city_code || '') !== f.city) return false;
    if (f.trainer && f.trainer !== 'all' && (s.trainer?.id || '') !== f.trainer) return false;
    if (!q) return true;
    // Search covers what is on screen: the name, and the three columns a
    // reader might be scanning for instead.
    return [
      s.name,
      s.program?.title,
      s.program?.program_type?.name,
      s.trainer?.full_name,
      s.city_code,
    ].some(v => (v || '').toLowerCase().includes(q));
  });
}

export default function SessionFilters({ sessions, value, onChange, showTrainer = false }) {
  // Options come from the sessions in hand, so a filter can never offer
  // something that would return nothing.
  const { types, cities, trainers } = useMemo(() => {
    const t = new Map();
    const c = new Set();
    const tr = new Map();
    for (const s of sessions || []) {
      const pt = s.program?.program_type;
      if (pt?.id) t.set(pt.id, pt.name || 'Untitled');
      if (s.city_code) c.add(s.city_code);
      if (s.trainer?.id) tr.set(s.trainer.id, s.trainer.full_name || 'Unnamed');
    }
    const byName = (a, b) => a[1].localeCompare(b[1]);
    return {
      types: [...t.entries()].sort(byName),
      cities: [...c].sort(),
      trainers: [...tr.entries()].sort(byName),
    };
  }, [sessions]);

  const active = ['q', 'type', 'city', 'trainer']
    .filter(k => value[k] && value[k] !== 'all').length;

  // Nothing to filter and nothing to search — don't draw a toolbar at all.
  if ((sessions || []).length === 0) return null;

  return (
    <div className="session-filters">
      <input
        className="form-input session-filter-search"
        type="search"
        placeholder="Search sessions…"
        value={value.q || ''}
        onChange={e => onChange('q', e.target.value)}
      />

      {types.length > 1 && (
        <select
          className="form-input session-filter-select"
          value={value.type || 'all'}
          onChange={e => onChange('type', e.target.value)}
          aria-label="Programme type"
        >
          <option value="all">All programmes</option>
          {types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}

      {cities.length > 1 && (
        <select
          className="form-input session-filter-select"
          value={value.city || 'all'}
          onChange={e => onChange('city', e.target.value)}
          aria-label="City"
        >
          <option value="all">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {/* Only where the caller might be looking at other people's sessions.
          On "my sessions" every row has the same trainer. */}
      {showTrainer && trainers.length > 1 && (
        <select
          className="form-input session-filter-select"
          value={value.trainer || 'all'}
          onChange={e => onChange('trainer', e.target.value)}
          aria-label="Trainer"
        >
          <option value="all">All trainers</option>
          {trainers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}

      {active > 0 && (
        <button type="button" className="ghost session-filter-clear" onClick={() => onChange('__clear__')}>
          Clear {active === 1 ? 'filter' : `${active} filters`}
        </button>
      )}
    </div>
  );
}

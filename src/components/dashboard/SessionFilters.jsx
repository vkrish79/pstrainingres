import { useMemo } from 'react';
import { FILTER_KEYS, filterSessions, filterOptions } from '../../lib/sessionFilters.js';

// Filters for a session list, in whichever view it is being drawn.
//
// THE LOGIC IS NOT HERE. filterSessions, filterOptions and FILTER_KEYS live in
// lib/sessionFilters.js, because node cannot import a file containing JSX and
// logic that cannot be tested is logic that gets a filter key added to four of
// its five copies. This file is the markup and nothing else.
//
// Re-exported below so existing importers keep working.
//
// A SELECT ONLY APPEARS WHEN THERE IS SOMETHING TO CHOOSE BETWEEN. A "City"
// dropdown offering only AUH is a control that cannot do anything — it costs a
// glance every time and rewards it never. Same for programme type, trainer and
// vendor.
//
// Filters live ABOVE the view switch and apply to all three views, so changing
// the view changes how the same set is drawn rather than quietly widening it
// back to everything.

export { filterSessions, FILTER_KEYS, PS_IN_HOUSE } from '../../lib/sessionFilters.js';

export default function SessionFilters({ sessions, value, onChange, showTrainer = false }) {
  const { types, cities, trainers, vendors } = useMemo(
    () => filterOptions(sessions), [sessions],
  );

  const active = FILTER_KEYS.filter(k => value[k] && value[k] !== 'all').length;

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

      {/* Same rule as the rest: only when there is a choice to make. A super
          with no vendors configured sees no vendor filter, exactly as before. */}
      {vendors.length > 1 && (
        <select
          className="form-input session-filter-select"
          value={value.vendor || 'all'}
          onChange={e => onChange('vendor', e.target.value)}
          aria-label="Vendor"
        >
          <option value="all">All vendors</option>
          {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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

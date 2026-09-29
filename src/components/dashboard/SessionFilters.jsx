import { useEffect, useMemo, useRef, useState } from 'react';
// Only what this file USES. FILTER_KEYS, filterSessions, PS_IN_HOUSE and
// NO_PROGRAM reach their old importers through the re-export below, which
// needs no import of its own.
import { POPOVER_KEYS, CLEARABLE_KEYS, filterOptions } from '../../lib/sessionFilters.js';

// Filters for a session list, in whichever view it is being drawn.
//
// THE LOGIC IS NOT HERE. filterSessions, filterOptions and FILTER_KEYS live in
// lib/sessionFilters.js, because node cannot import a file containing JSX and
// logic that cannot be tested is logic that gets a filter key added to four of
// its five copies. This file is the markup and nothing else.
//
// Re-exported below so existing importers keep working.
//
// FOUR OF THE SIX ARE BEHIND A BUTTON NOW, and that is a change of mind worth
// writing down. Inline selects were right while there were two of them. There
// are six: search, program, program type, city, trainer, vendor — and they
// share a row with the four time tabs and "+ New session". That does not hold
// one line at laptop width, and this file's own history is four layouts broken
// by a row that was asked to carry one control too many.
//
// So: SEARCH AND TRAINER STAY ON THE ROW. Search is typed into constantly and
// a popover would cost a click per keystroke session; trainer is the control a
// super admin reaches for most, looking across three people's classes. The
// other four go behind "Filters", which carries a count so a set filter is
// never invisible.
//
// THE "ONLY IF MORE THAN ONE" RULE IS GONE from the four in the popover. It
// existed because a dead select cost a share of a crowded row — in a panel
// with room, that trade does not apply, and its real cost was that a list
// where every session is in AUH offered no city filter at all, which reads as
// the feature being missing rather than as having nothing to do. The rule is
// KEPT for the inline trainer select, which is still competing for the row.

export {
  filterSessions, FILTER_KEYS, PS_IN_HOUSE, NO_PROGRAM,
} from '../../lib/sessionFilters.js';

export default function SessionFilters({ sessions, value, onChange, showTrainer = false }) {
  const { programs, types, cities, trainers, vendors } = useMemo(
    () => filterOptions(sessions), [sessions],
  );

  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  // Escape closes and gives the button its focus back; a click outside closes.
  // Lifted from KebabMenu rather than reinvented — that component could not be
  // reused directly because it takes items as data and these are <select>s,
  // but the focus behaviour should be the same one users already know.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // The badge counts ONLY what the popover hides. `q` and `trainer` are on the
  // row and `when` is a pressed tab — badging those would put a number on the
  // button for a filter the reader can already see.
  const hidden = POPOVER_KEYS.filter(k => value[k] && value[k] !== 'all').length;
  // The Clear button answers for everything except the tab group, which resets
  // itself with its own "All".
  const active = CLEARABLE_KEYS.filter(k => value[k] && value[k] !== 'all').length;

  // Nothing to filter and nothing to search — don't draw a toolbar at all.
  if ((sessions || []).length === 0) return null;

  // One shape for all four, so a new axis is three lines and not a fresh
  // decision about how a labelled select looks.
  const field = (key, label, options, allLabel) => (
    <label className="session-filter-field" key={key}>
      <span>{label}</span>
      <select
        className="form-input"
        value={value[key] || 'all'}
        onChange={e => onChange(key, e.target.value)}
      >
        <option value="all">{allLabel}</option>
        {options.map(o => {
          const [id, name] = Array.isArray(o) ? o : [o, o];
          return <option key={id} value={id}>{name}</option>;
        })}
      </select>
      {/* Said rather than hidden. A list where every class is in one city has
          nothing to narrow to, and a reader who came looking for the control
          should find it explaining itself, not absent. */}
      {options.length <= 1 && (
        <em className="session-filter-only">
          {options.length === 0 ? 'nothing to choose from' : 'only one, nothing to narrow'}
        </em>
      )}
    </label>
  );

  return (
    <div className="session-filters">
      <input
        className="form-input session-filter-search"
        type="search"
        placeholder="Search sessions…"
        value={value.q || ''}
        onChange={e => onChange('q', e.target.value)}
      />

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

      <div className="session-filter-more" ref={wrapRef}>
        <button
          type="button"
          ref={triggerRef}
          className={`session-filter-toggle${open ? ' is-open' : ''}${hidden ? ' has-filters' : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen(o => !o)}
        >
          Filters
          {hidden > 0 && <span className="session-filter-badge">{hidden}</span>}
        </button>

        {open && (
          <div className="session-filter-panel" role="group" aria-label="More filters">
            {field('program', 'Program', programs, 'All programs')}
            {/* NOT "All programs" — that label belonged to this select and was
                the reason there appeared to be a program filter when there
                was only a type one. */}
            {field('type', 'Program type', types, 'All types')}
            {field('city', 'City', cities, 'All cities')}
            {field('vendor', 'Vendor', vendors, 'All vendors')}
          </div>
        )}
      </div>

      {active > 0 && (
        <button type="button" className="ghost session-filter-clear" onClick={() => onChange('__clear__')}>
          Clear {active === 1 ? 'filter' : `${active} filters`}
        </button>
      )}
    </div>
  );
}

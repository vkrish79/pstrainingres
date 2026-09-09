import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import SessionCard from './SessionCard.jsx';
import SessionList from './SessionList.jsx';
import SessionCalendar from './SessionCalendar.jsx';
import SessionFilters, { filterSessions } from './SessionFilters.jsx';

// Sessions in whichever shape suits the question: a calendar for "what is
// running and when", a list for scanning and comparing, cards for a handful.
//
// Cards are KEPT rather than replaced. They are genuinely good at four
// sessions and bad at forty; the fix is to stop making that a decision
// somebody made once for everybody.
//
// THE VIEW AND THE MONTH LIVE IN THE URL (?view=calendar&month=2026-09), which
// is the cheap thing that makes the back button work, survives a reload, and
// lets someone paste "this month's sessions" into a message. myLearning Hub's
// training plan does the same with useSearchParams. It is an hour's work now
// and stops being cheaply retrofittable once three views exist.
//
// `id` scopes the query params so two lists on one page (the super pool and
// the vendor sessions on the trainer home) do not fight over one ?view.
export default function SessionViews({
  sessions,
  showTrainer = false,
  emptyLabel = 'No sessions.',
  id = 'v',
  defaultView = 'list',
}) {
  const [params, setParams] = useSearchParams();
  const viewKey = `${id}view`;
  const monthKey = `${id}month`;

  const view = params.get(viewKey) || defaultView;
  const month = params.get(monthKey) || currentMonth();

  // Filters ride in the URL alongside the view, so they survive a reload and a
  // shared link carries them. They also survive the view switch for free —
  // this component owns them, and switching view only changes which child
  // renders.
  const filters = {
    q: params.get(`${id}q`) || '',
    type: params.get(`${id}type`) || 'all',
    city: params.get(`${id}city`) || 'all',
    trainer: params.get(`${id}trainer`) || 'all',
  };

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    // Don't leave the default in the URL — a shared link should carry what
    // somebody chose, not what they happened to land on.
    if (!value || (key === viewKey && value === defaultView)) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  function setFilter(key, value) {
    const next = new URLSearchParams(params);
    if (key === '__clear__') {
      for (const k of ['q', 'type', 'city', 'trainer']) next.delete(`${id}${k}`);
    } else if (!value || value === 'all') {
      next.delete(`${id}${key}`);
    } else {
      next.set(`${id}${key}`, value);
    }
    setParams(next, { replace: true });
  }

  const shown = useMemo(() => filterSessions(sessions, filters), [sessions, filters.q, filters.type, filters.city, filters.trainer]);
  const filtering = (sessions || []).length !== shown.length;

  // Counted on what is being SHOWN, not on everything loaded — otherwise the
  // calendar promises three unscheduled sessions the current filter excludes.
  const undatedCount = shown.filter(s => !s.starts_at && !s.ends_at).length;

  return (
    <div className="session-views">
      <SessionFilters
        sessions={sessions}
        value={filters}
        onChange={setFilter}
        showTrainer={showTrainer}
      />

      <div className="session-views-bar">
        <div className="session-view-pills" role="tablist" aria-label="View">
          {[['calendar', '▦', 'Calendar'], ['list', '☰', 'List'], ['cards', '▤', 'Cards']].map(([v, glyph, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`session-view-pill ${view === v ? 'active' : ''}`}
              onClick={() => setParam(viewKey, v)}
            >
              <span className="btn-glyph" aria-hidden>{glyph}</span> {label}
            </button>
          ))}
        </div>

        {/* The month stepper belongs to the calendar and nothing else, so it
            is not drawn when there is no month being looked at. */}
        {view === 'calendar' && (
          <div className="session-month-nav">
            <button type="button" className="icon-btn" aria-label="Previous month"
              onClick={() => setParam(monthKey, stepMonth(month, -1))}>‹</button>
            <span className="session-month-label">{monthLabel(month)}</span>
            <button type="button" className="icon-btn" aria-label="Next month"
              onClick={() => setParam(monthKey, stepMonth(month, 1))}>›</button>
            <button type="button" className="ghost session-today-btn"
              onClick={() => setParam(monthKey, currentMonth())}>Today</button>
          </div>
        )}
      </div>

      {/* An empty result from a filter is not the same as having no sessions,
          and saying "No sessions." to someone who has just typed a search is
          both wrong and unhelpful — it hides the reason. */}
      {filtering && shown.length === 0 ? (
        <p className="muted">
          No sessions match these filters.{' '}
          <button type="button" className="ghost-link session-filter-reset" onClick={() => setFilter('__clear__')}>
            Clear them
          </button>
        </p>
      ) : (
        <>
          {view === 'calendar' && (
            <SessionCalendar sessions={shown} month={month} emptyLabel={emptyLabel} />
          )}

          {view === 'list' && (
            <SessionList sessions={shown} showTrainer={showTrainer} emptyLabel={emptyLabel} />
          )}

          {view === 'cards' && (
            shown.length === 0
              ? <p className="muted">{emptyLabel}</p>
              : (
                <div className="session-grid">
                  {shown.map(s => <SessionCard key={s.id} session={s} showTrainer={showTrainer} />)}
                </div>
              )
          )}
        </>
      )}

      {/* What the filter is hiding, stated rather than left to be inferred
          from a list that looks short. */}
      {filtering && shown.length > 0 && (
        <p className="session-filter-count">
          Showing {shown.length} of {sessions.length} sessions.
        </p>
      )}

      {/* Said once, under every view. On the calendar it explains a gap the
          reader can see; on the list it points at rows they can fix. */}
      {undatedCount > 0 && view !== 'calendar' && (
        <p className="session-undated-note">
          {undatedCount} session{undatedCount === 1 ? '' : 's'} without dates —
          {' '}{undatedCount === 1 ? 'it does' : 'they do'} not appear on the calendar.
        </p>
      )}
    </div>
  );
}

// ── month helpers ─────────────────────────────────────────────────────────
// The URL carries "2026-09": readable, sortable, and unambiguous about which
// month is meant, which a locale-formatted string is not.

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonth(m) {
  const [y, mo] = String(m || '').split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  return new Date(y, mo - 1, 1);
}

function stepMonth(m, delta) {
  const d = parseMonth(m);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(m) {
  return parseMonth(m).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

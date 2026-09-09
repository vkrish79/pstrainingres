import { useSearchParams } from 'react-router-dom';
import SessionCard from './SessionCard.jsx';
import SessionList from './SessionList.jsx';
import SessionCalendar from './SessionCalendar.jsx';

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

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    // Don't leave the default in the URL — a shared link should carry what
    // somebody chose, not what they happened to land on.
    if (!value || (key === viewKey && value === defaultView)) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const undatedCount = (sessions || []).filter(s => !s.starts_at && !s.ends_at).length;

  return (
    <div className="session-views">
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

      {view === 'calendar' && (
        <SessionCalendar sessions={sessions} month={month} emptyLabel={emptyLabel} />
      )}

      {view === 'list' && (
        <SessionList sessions={sessions} showTrainer={showTrainer} emptyLabel={emptyLabel} />
      )}

      {view === 'cards' && (
        (sessions || []).length === 0
          ? <p className="muted">{emptyLabel}</p>
          : (
            <div className="session-grid">
              {sessions.map(s => <SessionCard key={s.id} session={s} showTrainer={showTrainer} />)}
            </div>
          )
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

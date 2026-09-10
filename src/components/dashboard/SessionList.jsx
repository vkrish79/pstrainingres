import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionColour } from '../../lib/programColour.js';
import { formatRange } from '../../lib/sessionDates.js';

// Sessions as a sortable table.
//
// The view a card grid cannot be. Cards are good at four sessions and bad at
// forty: you cannot sort them, cannot compare two rows without reading two
// boxes, and a missing field just leaves a smaller card rather than an obvious
// gap. Everything below comes out of the SAME useTrainerSessions select the
// cards already use — no new query.
//
// A SESSION WITH NO DATES IS MARKED ON ITS DATES CELL rather than in a column
// of its own. starts_at and ends_at are nullable, and while the form now
// requires them, sessions created before that do not have them. "No dates" is
// a state worth naming — the same reasoning as printing a blank Result on the
// L&D report rather than "FAIL": absent is not zero, and it is something to go
// and fix. But it belongs where the missing thing is.
//
// THERE IS NO STATUS COLUMN. There was, and every row in it said LIVE: each
// caller loads with includeClosed='live', so an un-closed session is the only
// kind that reaches here, and the column's only other value was "No dates" —
// which is now on the dates cell where it means something. A column whose every
// value is identical costs a header, a sort control and a share of the width,
// and tells the reader nothing. The closed case is kept as a pill beside the
// name, so pointing this at the archive one day still reads correctly.

const COLUMNS = [
  { key: 'name', label: 'Session' },
  { key: 'programme', label: 'Programme' },
  { key: 'dates', label: 'Dates' },
  { key: 'city', label: 'City' },
  { key: 'vendor', label: 'Vendor', optional: true },
  { key: 'trainer', label: 'Trainer', optional: true },
  { key: 'people', label: 'People', numeric: true },
];

export default function SessionList({
  sessions,
  showTrainer = false,
  showVendor = false,
  emptyLabel = 'No sessions.',
}) {
  // Dates descending is the useful default: the newest cohort is the one you
  // are most likely to be looking for. Undated rows sort last whichever way
  // the column is pointed — they have no position on a timeline, so pinning
  // them to one end is the only honest answer.
  const [sortKey, setSortKey] = useState('dates');
  const [dir, setDir] = useState('desc');

  const rows = useMemo(() => {
    const decorated = (sessions || []).map(s => {
      const start = s.starts_at ? new Date(s.starts_at).getTime() : null;
      return {
        session: s,
        start,
        undated: !s.starts_at && !s.ends_at,
        closed: !!s.closed_at,
        people: (s.session_participants || []).length,
        programme: s.program?.program_type?.name || s.program?.title || '',
        programmeType: s.program?.program_type?.name || '',
        programmeTitle: s.program?.title || '',
        trainer: s.trainer?.full_name || '',
        city: s.city_code || '',
        // In-house sessions sort under "PS" rather than under the empty
        // string, so they group together instead of scattering to one end.
        vendor: s.vendor_id ? (s.vendors?.name || s.vendors?.code || 'Vendor') : 'PS',
      };
    });

    const factor = dir === 'asc' ? 1 : -1;
    return decorated.sort((a, b) => {
      if (sortKey === 'dates') {
        if (a.start == null && b.start == null) return 0;
        if (a.start == null) return 1;   // undated last, always
        if (b.start == null) return -1;
        return (a.start - b.start) * factor;
      }
      if (sortKey === 'people') return (a.people - b.people) * factor;
      const av = sortKey === 'name' ? (a.session.name || '') : (a[sortKey] || '');
      const bv = sortKey === 'name' ? (b.session.name || '') : (b[sortKey] || '');
      return av.localeCompare(bv) * factor;
    });
  }, [sessions, sortKey, dir]);

  function sortBy(key) {
    if (key === sortKey) { setDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(key);
    setDir(key === 'dates' ? 'desc' : 'asc');
  }

  if (!sessions || sessions.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }

  const columns = COLUMNS.filter(c => {
    if (c.key === 'trainer') return showTrainer;
    if (c.key === 'vendor') return showVendor;
    return true;
  });

  return (
    <div className="session-list-wrap">
      <table className="session-list">
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                className={c.numeric ? 'num' : undefined}
                aria-sort={sortKey === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {/* The whole header is the control, so the hit area matches
                    what it looks like rather than being the text alone. */}
                <button type="button" className="session-list-sort" onClick={() => sortBy(c.key)}>
                  {c.label}
                  <span className="session-list-caret" aria-hidden>
                    {sortKey === c.key ? (dir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.session.id} className={r.closed ? 'is-closed' : ''}>
              <td className="session-list-name">
                <Link to={`/trainer/sessions/${r.session.id}`}>
                  <span className="session-list-swatch" style={{ background: sessionColour(r.session) }} aria-hidden />
                  {r.session.name}
                </Link>
                {r.closed && <span className="session-pill closed">Closed</span>}
              </td>
              <td>
                {/* Type on top, programme title beneath it. When there is no
                    TYPE — which is the common case for the loose "Overview"
                    programmes — this used to print an em dash and stack the
                    title under it, so the cell read as an error with a caption.
                    With no type, the title is the whole answer and takes the
                    first line itself. */}
                {r.programmeType ? (
                  <>
                    {r.programmeType}
                    {r.programmeTitle && (
                      <span className="session-list-sub">{r.programmeTitle}</span>
                    )}
                  </>
                ) : (r.programmeTitle || '—')}
              </td>
              <td className="session-list-dates">
                {r.undated
                  ? <span className="session-pill undated" title="This session has no dates, so it cannot appear on the calendar">No dates</span>
                  : (formatRange(r.session.starts_at, r.session.ends_at) || '—')}
              </td>
              <td>{r.city || '—'}</td>
              {showVendor && (
                <td>
                  {r.session.vendor_id
                    ? r.vendor
                    : <span className="session-list-inhouse">PS</span>}
                </td>
              )}
              {showTrainer && <td>{r.trainer || <span className="muted">Unassigned</span>}</td>}
              <td className="num">{r.people}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}



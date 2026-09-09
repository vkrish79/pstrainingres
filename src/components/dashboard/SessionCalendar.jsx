import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { sessionColour } from '../../lib/programColour.js';
import { parseMonth } from './SessionViews.jsx';
import { formatRange } from './SessionList.jsx';

// A month of sessions, drawn as bars.
//
// The grid shape and the packing below are adapted from myLearning Hub's
// trainingplan/MonthBlock.jsx, which had already solved the fiddly parts:
// a Monday-first 7-column grid, multi-day items clipped to each week they
// touch, and overlapping items assigned to stacked TRACKS so they cannot
// collide. Reimplementing that from scratch would have been a day of
// off-by-one errors for no gain.
//
// WHAT IS DELIBERATELY NOT COPIED: dragging a bar to reschedule, and with it
// conflict detection, room availability and three confirm modals. That is a
// resourcing tool. This is a session list that knows about dates.

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_TRACKS = 3; // beyond this a week says "+N more" rather than growing without limit

// The Monday on or before the 1st, so the grid starts on a whole week.
// (getDay() is Sunday-first; +6 %7 rotates it to Monday-first.)
function startOfMonthGrid(monthDate) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  const grid = new Date(first);
  grid.setDate(grid.getDate() - dow);
  grid.setHours(0, 0, 0, 0);
  return grid;
}

function dayStart(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffDays(a, b) {
  return Math.round((b - a) / 86400000);
}

// Which sessions touch this week, where each starts, how far it runs, and
// which track it sits in. Lifted from MonthBlock.packWeek().
//
// Sorting by start then by longest-first matters: it makes the packing
// deterministic, so a session does not hop between rows when an unrelated one
// is added.
export function packWeek(weekStart, sessions) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const visible = sessions
    .map(s => {
      if (!s.starts_at && !s.ends_at) return null;
      const start = dayStart(s.starts_at || s.ends_at);
      const end = dayStart(s.ends_at || s.starts_at);
      if (end < weekStart || start >= weekEnd) return null;
      const col = Math.max(0, diffDays(weekStart, start));
      const endCol = Math.min(6, diffDays(weekStart, end));
      return {
        session: s,
        col,
        span: endCol - col + 1,
        start,
        // Whether the bar is cut off by the edge of this week, so the drawing
        // can show it continues rather than implying it stops here.
        clippedStart: start < weekStart,
        clippedEnd: end >= weekEnd,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.start - b.start) || (b.span - a.span));

  const trackEnds = [];
  return visible.map(item => {
    let track = trackEnds.findIndex(endCol => item.col > endCol);
    if (track < 0) { track = trackEnds.length; trackEnds.push(-1); }
    trackEnds[track] = item.col + item.span - 1;
    return { ...item, track };
  });
}

export default function SessionCalendar({ sessions, month, emptyLabel = 'No sessions.' }) {
  const monthDate = parseMonth(month);

  const { weeks, undated } = useMemo(() => {
    const list = sessions || [];
    const gridStart = startOfMonthGrid(monthDate);
    const out = [];
    for (let w = 0; w < 6; w += 1) {
      const weekStart = new Date(gridStart);
      weekStart.setDate(weekStart.getDate() + w * 7);
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      });
      // A trailing week belonging entirely to the next month is dead space.
      if (w >= 4 && days[0].getMonth() !== monthDate.getMonth()
          && days[6].getMonth() !== monthDate.getMonth()) break;
      out.push({ weekStart, days, items: packWeek(weekStart, list) });
    }
    return { weeks: out, undated: list.filter(s => !s.starts_at && !s.ends_at) };
  }, [sessions, monthDate]);

  const todayISO = dayStart(new Date()).getTime();
  const thisMonth = monthDate.getMonth();
  const anyInMonth = weeks.some(w => w.items.length > 0);

  return (
    <div className="session-cal-wrap">
      <div className="session-cal">
        <div className="session-cal-dow">
          {DOW.map(d => <span key={d}>{d}</span>)}
        </div>

        {weeks.map(({ weekStart, days, items }) => {
          const shown = items.filter(i => i.track < MAX_TRACKS);
          const hidden = items.filter(i => i.track >= MAX_TRACKS);
          // "+N more" is counted per DAY, so it appears over the days that
          // actually have something behind them.
          const overflowByCol = {};
          for (const i of hidden) {
            for (let c = i.col; c < i.col + i.span; c += 1) {
              overflowByCol[c] = (overflowByCol[c] || 0) + 1;
            }
          }
          const trackCount = Math.min(MAX_TRACKS, items.reduce((m, i) => Math.max(m, i.track + 1), 0));

          return (
            <div
              key={weekStart.toISOString()}
              className="session-cal-week"
              style={{ '--tracks': trackCount }}
            >
              {days.map((d, dayIdx) => {
                const isWeekend = [5, 6].includes((d.getDay() + 6) % 7);
                const isToday = d.getTime() === todayISO;
                const outside = d.getMonth() !== thisMonth;
                return (
                  <div
                    key={d.toISOString()}
                    className={`session-cal-day${isWeekend ? ' weekend' : ''}${outside ? ' outside' : ''}${isToday ? ' today' : ''}`}
                    /* EXPLICIT column. Every item in this grid is pinned to grid-row 1
                       so the bars can overlay the days — which means auto-placed day
                       cells collide with the explicitly-placed bars and get pushed into
                       implicit columns. Measured before this: twelve columns instead of
                       seven, five of them junk. */
                    style={{ gridColumn: dayIdx + 1 }}
                  >
                    <span className="session-cal-daynum">{d.getDate()}</span>
                  </div>
                );
              })}

              {shown.map(i => (
                <Link
                  key={i.session.id}
                  to={`/trainer/sessions/${i.session.id}`}
                  className={`session-cal-bar${i.session.closed_at ? ' is-closed' : ''}${i.clippedStart ? ' clip-start' : ''}${i.clippedEnd ? ' clip-end' : ''}`}
                  style={{
                    background: sessionColour(i.session),
                    gridColumn: `${i.col + 1} / span ${i.span}`,
                    '--track': i.track,
                  }}
                  title={`${i.session.name} · ${formatRange(i.session.starts_at, i.session.ends_at)}`}
                >
                  <span className="session-cal-bar-name">{i.session.name}</span>
                  <span className="session-cal-bar-count">
                    {(i.session.session_participants || []).length}
                  </span>
                </Link>
              ))}

              {Object.entries(overflowByCol).map(([col, n]) => (
                <span
                  key={`more-${col}`}
                  className="session-cal-more"
                  style={{ gridColumn: `${Number(col) + 1}`, '--track': MAX_TRACKS }}
                >
                  +{n} more
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {!anyInMonth && (
        <p className="muted session-cal-empty">
          {(sessions || []).length === 0 ? emptyLabel : 'Nothing scheduled this month.'}
        </p>
      )}

      {/* Undated sessions cannot be drawn on a calendar, and vanishing without
          a word is the failure worth avoiding: a trainer seeing eleven of
          their fourteen sessions would have no way to know the other three
          exist. They stay visible and countable here instead. */}
      {undated.length > 0 && (
        <div className="session-unscheduled">
          <div className="session-unscheduled-head">Unscheduled · {undated.length}</div>
          <div className="session-unscheduled-items">
            {undated.map(s => (
              <Link key={s.id} to={`/trainer/sessions/${s.id}`} className="session-unscheduled-item">
                <span className="session-unscheduled-dot" style={{ background: sessionColour(s) }} aria-hidden />
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionColour } from '../../lib/programColour.js';
import SessionHoverCard from './SessionHoverCard.jsx';
import { DOW, startOfMonthGrid, dayStart, packWeek, monthsForView, hasAnyInMonths, parseMonthKey } from '../../lib/calendarSpans.js';

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

// How many stacked tracks a week will draw before it says "+N more", per
// density. A PARAMETER, not the module constant it used to be: a year-view
// cell is 28px tall, and reserving three tracks of vertical space inside it
// would leave twelve months of mostly-empty boxes.
const TRACKS = { full: 3, compact: 2, tiny: 3 };

// One month's grid. Extracted from SessionCalendar so quarter and year views
// can draw three and twelve of them — the same split myLearning Hub's training
// plan makes between TrainingPlanCanvas and MonthBlock.
//
// `density` drives the CSS custom properties for bar and date-number height,
// declared on this block so they override the wrap's full-size values by
// inheritance. At `tiny` the bars lose their text entirely and become colour
// strips: at 4px high a session name is not readable, and pretending otherwise
// would just be a smear.
function MonthBlock({
  monthDate,
  sessions,
  density = 'full',
  showTitle = false,
  onTitleClick,
  onBarEnter,
  onBarLeave,
}) {
  const maxTracks = TRACKS[density] ?? 3;
  const tiny = density === 'tiny';

  const weeks = useMemo(() => {
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
    return out;
  }, [sessions, monthDate]);

  const todayISO = dayStart(new Date()).getTime();
  const thisMonth = monthDate.getMonth();
  const monthLabel = monthDate.toLocaleDateString('en-GB', { month: 'long' });
  const fullLabel = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className={`session-cal-block density-${density}`}>
      {showTitle && (
        onTitleClick ? (
          <button
            type="button"
            className="session-cal-block-title is-clickable"
            onClick={() => onTitleClick(monthDate)}
            title={`Open ${fullLabel}`}
          >
            {monthLabel}
          </button>
        ) : (
          <div className="session-cal-block-title">{monthLabel}</div>
        )
      )}

      <div className="session-cal">
        <div className="session-cal-dow">
          {DOW.map(d => <span key={d}>{tiny ? d.charAt(0) : d}</span>)}
        </div>

        {weeks.map(({ weekStart, days, items }) => {
          const shown = items.filter(i => i.track < maxTracks);
          const hidden = items.filter(i => i.track >= maxTracks);
          // "+N more" is counted per DAY, so it appears over the days that
          // actually have something behind them.
          const overflowByCol = {};
          for (const i of hidden) {
            for (let c = i.col; c < i.col + i.span; c += 1) {
              overflowByCol[c] = (overflowByCol[c] || 0) + 1;
            }
          }
          const trackCount = Math.min(maxTracks, items.reduce((m, i) => Math.max(m, i.track + 1), 0));

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
                  /* No `title`. It waited a second, arrived as unstyled OS
                     chrome, and mostly repeated the bar. onFocus/onBlur as well
                     as the mouse handlers, so tabbing through the calendar
                     gets the same information as hovering. */
                  onMouseEnter={e => onBarEnter?.(i.session, e.currentTarget)}
                  onMouseLeave={onBarLeave}
                  onFocus={e => onBarEnter?.(i.session, e.currentTarget)}
                  onBlur={onBarLeave}
                >
                  {/* At tiny density the bar is a 4px strip. Text would be a
                      smear, and the hover card carries the detail instead. */}
                  {!tiny && (
                    <>
                      <span className="session-cal-bar-name">{i.session.name}</span>
                      <span className="session-cal-bar-count">
                        {(i.session.session_participants || []).length}
                      </span>
                    </>
                  )}
                </Link>
              ))}

              {!tiny && Object.entries(overflowByCol).map(([col, n]) => (
                <span
                  key={`more-${col}`}
                  className="session-cal-more"
                  style={{ gridColumn: `${Number(col) + 1}`, '--track': maxTracks }}
                >
                  +{n} more
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SessionCalendar({
  sessions,
  month,
  view = 'month',
  onJumpToMonth,
  emptyLabel = 'No sessions.',
}) {
  const monthDate = parseMonthKey(month);

  // The hovered bar, as a session plus the rectangle it occupies. The RECT is
  // stored rather than the element, so the card positions against a snapshot
  // and cannot end up reading a node that has since re-rendered.
  const [card, setCard] = useState(null);
  function showCard(session, el) {
    setCard({ session, anchor: el.getBoundingClientRect() });
  }
  function hideCard() { setCard(null); }

  const months = useMemo(() => monthsForView(monthDate, view), [monthDate, view]);
  const density = view === 'year' ? 'tiny' : view === 'quarter' ? 'compact' : 'full';

  const list = sessions || [];
  const undated = list.filter(s => !s.starts_at && !s.ends_at);
  const anyShown = useMemo(() => hasAnyInMonths(months, list), [months, list]);

  const periodWord = view === 'year' ? 'this year' : view === 'quarter' ? 'this quarter' : 'this month';

  return (
    <div className="session-cal-wrap">
      <div className={`session-cal-months view-${view}`}>
        {months.map(m => (
          <MonthBlock
            key={m.toISOString()}
            monthDate={m}
            sessions={list}
            density={density}
            showTitle={view !== 'month'}
            onTitleClick={view !== 'month' ? onJumpToMonth : undefined}
            onBarEnter={showCard}
            onBarLeave={hideCard}
          />
        ))}
      </div>

      {!anyShown && (
        <p className="muted session-cal-empty">
          {list.length === 0 ? emptyLabel : `Nothing scheduled ${periodWord}.`}
        </p>
      )}

      {/* Undated sessions cannot be drawn on a calendar, and vanishing without
          a word is the failure worth avoiding: a trainer seeing eleven of
          their fourteen sessions would have no way to know the other three
          exist. They stay visible and countable here instead — ONCE, under the
          whole calendar, not once per month block. */}
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

      {/* Rendered last and positioned against the viewport, so it draws over
          the grid instead of inside it — see the note in SessionHoverCard. */}
      {card && <SessionHoverCard session={card.session} anchor={card.anchor} />}
    </div>
  );
}

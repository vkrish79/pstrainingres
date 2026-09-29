import { useMemo, useRef, useState } from 'react';
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

  // The deepest stack any week in this month needs, capped at what the density
  // will draw. One number for the month, so every week reserves the same room.
  const monthTracks = useMemo(() => {
    let deepest = 0;
    for (const { items } of weeks) {
      for (const i of items) deepest = Math.max(deepest, i.track + 1);
    }
    return Math.min(maxTracks, deepest);
  }, [weeks, maxTracks]);

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

      {/* EVERY WEEK THE SAME HEIGHT, set once for the month rather than per
          week. A week used to size itself to its own track count, so an empty
          week was a third the height of a busy one and a month read as a
          staircase rather than a grid.

          The busiest week in THIS month, not the density's cap: reserving all
          three tracks everywhere would leave a quiet month mostly empty box,
          which is the opposite problem. Overflow past the cap is already
          handled by "+N more". */}
      <div className="session-cal" style={{ '--tracks': monthTracks }}>
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
          return (
            <div
              key={weekStart.toISOString()}
              className="session-cal-week"
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
                    // THE COLOUR, NOT THE FILL. The bar used to be painted
                    // solid in the program colour with white text; it is now a
                    // pale wash of it with a rail down the leading edge and
                    // dark text, so a month of sessions reads as names rather
                    // than as blocks. The tint and the text shade are derived
                    // from this one value in CSS — see .session-cal-bar.
                    '--c': sessionColour(i.session),
                    gridColumn: `${i.col + 1} / span ${i.span}`,
                    '--track': i.track,
                  }}
                  /* No `title`. It waited a second, arrived as unstyled OS
                     chrome, and mostly repeated the bar. onFocus/onBlur as well
                     as the mouse handlers, so tabbing through the calendar
                     gets the same information as hovering. */
                  onMouseEnter={e => onBarEnter?.(i.session, e.currentTarget, e.clientX)}
                  onMouseLeave={onBarLeave}
                  /* No clientX on a focus event — the card falls back to the
                     bar's own leading edge, which is where a keyboard user's
                     attention is. */
                  onFocus={e => onBarEnter?.(i.session, e.currentTarget, null)}
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
  // The calendar's own box, so the card can flip against IT rather than against
  // the window. A bar in the first week or two used to open a card straight
  // over the Month / Quarter / Year pills and the stepper, because the only
  // thing it avoided leaving was the viewport — and the toolbar is nowhere
  // near the viewport's top edge.
  const wrapRef = useRef(null);
  // pointerX is where the mouse actually entered the bar, so the card can open
  // under the cursor rather than at the bar's leading edge. On a session that
  // runs Monday to Sunday those are a screen apart, and opening seven days away
  // from the pointer reads as belonging to something else. Null from a focus
  // event, where there is no pointer.
  function showCard(session, el, pointerX) {
    setCard({
      session,
      anchor: el.getBoundingClientRect(),
      bounds: wrapRef.current?.getBoundingClientRect() ?? null,
      pointerX: typeof pointerX === 'number' ? pointerX : null,
    });
  }
  function hideCard() { setCard(null); }

  const months = useMemo(() => monthsForView(monthDate, view), [monthDate, view]);
  const density = view === 'year' ? 'tiny' : view === 'quarter' ? 'compact' : 'full';

  const list = sessions || [];
  const undated = list.filter(s => !s.starts_at && !s.ends_at);
  const anyShown = useMemo(() => hasAnyInMonths(months, list), [months, list]);

  const periodWord = view === 'year' ? 'this year' : view === 'quarter' ? 'this quarter' : 'this month';

  return (
    <div className="session-cal-wrap" ref={wrapRef}>
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
      {/* KEYED ON THE SESSION, so moving from one bar to the next REMOUNTS the
          card and plays the entrance again. Without it React reuses the same
          element: the card would keep the opacity and scale it already had and
          simply jump to the new coordinates — invisible at 160ms, and at 800ms
          a card that slides across the calendar instead of growing out of the
          bar you are pointing at. */}
      {card && (
        <SessionHoverCard
          key={card.session.id}
          session={card.session}
          anchor={card.anchor}
          bounds={card.bounds}
          pointerX={card.pointerX}
        />
      )}
    </div>
  );
}

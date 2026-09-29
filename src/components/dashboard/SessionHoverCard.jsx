import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatRange } from '../../lib/sessionDates.js';
import { sessionColour } from '../../lib/programColour.js';

// The quick-look card for a session bar on the calendar.
//
// It replaces a `title` attribute, which had three problems: it waits about a
// second before appearing, it renders as unstyled OS chrome that cannot show
// the trainer or the headcount without becoming a wall of text, and on a bar
// whose name is already ellipsised it mostly repeated what was on screen.
//
// A CALLOUT NOW, with a tail. Floating near a bar is not the same as belonging
// to it: with three bars stacked in a week, a card that merely appeared above
// them left you working out which one it described. The tail points at the
// POINTER — at where you actually are on the bar, not at the card's middle and
// not at the bar's far-off leading edge — which is what makes a stack
// unambiguous and what keeps a week-long session's card next to your cursor.
//
// POSITION: FIXED, NOT ABSOLUTE. .session-cal-wrap sets overflow-x: auto, and
// when one axis is not `visible` the other computes to auto too — so the
// calendar clips on BOTH axes and an absolutely-positioned card would be cut
// off at the grid edge, exactly as the ⋯ menu was cut off by the hero. A fixed
// element is positioned against the viewport and escapes ancestor overflow.
//
// It is pointer-events: none. The card is a read, not a target — letting the
// cursor land on it would make it flicker as the pointer crossed the gap.
// THE GAP IS THE TAIL'S HEIGHT, not an arbitrary margin — that is the whole
// fix for the point sitting off the bar. The tail hangs below the card, so the
// card has to stand its own tail-height clear of the bar for the point to land
// exactly on the bar's edge. At 10px against a 20px tail the point overshot
// into the bar by half its length.
const TAIL_H = 20;   // keep in step with .session-hovercard-tail height
const GAP = TAIL_H;
const EDGE = 8;      // keep this far off the viewport edge
const WEDGE = 26;    // the tail's width; it points from its own LEFT corner
const RADIUS = 10;   // the card's corner radius

export default function SessionHoverCard({ session, anchor, bounds, pointerX = null }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  // The entrance is a SECOND state, not the same one as the position. A
  // transition needs a previous frame to travel from, and this card is measured
  // before it is placed — so growing it in the same commit that positions it
  // would either not animate at all or animate from wherever it was measured.
  const [entered, setEntered] = useState(false);

  // Measured after paint, because where it goes depends on how big it turned
  // out to be.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const box = el.getBoundingClientRect();

    // FLIP AGAINST THE CALENDAR, NOT THE WINDOW. This used to drop below the
    // bar only when the card would leave the top of the viewport — but the
    // toolbar is nowhere near the viewport's top edge, so a bar in the first
    // week or two opened a card straight over the Month / Quarter / Year pills
    // and the stepper. The grid's own top edge is the line that matters.
    //
    // In quarter and year view the inner month labels sit below that edge, so a
    // bar in the second month can still overlap its own label. That is a
    // smaller overlap than the one this fixes, and is left alone.
    const ceiling = Math.max(EDGE, bounds ? bounds.top : EDGE);
    const above = anchor.top - box.height - GAP;
    const below = anchor.bottom + GAP;
    const flip = above < ceiling;
    const top = flip ? below : above;

    // IT OPENS UNDER THE POINTER, not at the bar's leading edge. A session
    // running Monday to Sunday is most of a screen wide, and a card opening at
    // its far end reads as belonging to a different session. Keyboard focus has
    // no pointer, so that falls back to the bar's own start.
    //
    // Read once, on the way in, rather than followed on mousemove: an 800ms
    // entrance and a card that slides as you move are fighting each other.
    const aimAt = pointerX == null ? anchor.left : pointerX;

    // The point wants to be under the cursor, so the card hangs a wedge's width
    // to its left — then slides back inside the window if it would fall off
    // either edge.
    const wanted = aimAt - RADIUS;
    const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - box.width - EDGE));

    // Where the point sits along the card's edge. Measured from the target in
    // page coordinates, so that when the card HAS been pushed sideways the tail
    // stays over the thing it describes instead of travelling with the card.
    // Clamped inside the corners: the wedge points from its own left edge, so
    // the far bound leaves room for its full width.
    const ax = Math.max(RADIUS, Math.min(aimAt - left, box.width - RADIUS - WEDGE));

    setPos({ top, left, ax, flip });
  }, [anchor, bounds, pointerX, session]);

  // Two frames after it lands: the first paints the card small and transparent
  // at its measured place, the second starts it growing. One frame is enough in
  // most browsers and not in all of them — the same pairing the slide-over
  // needs, and for the same reason.
  useEffect(() => {
    if (!pos) return undefined;
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [pos]);

  if (!session) return null;

  const people = (session.session_participants || []).length;
  const type = session.program?.program_type?.name;
  const title = session.program?.title;
  const vendor = session.vendor_id ? (session.vendors?.name || session.vendors?.code) : null;

  return (
    <div
      ref={ref}
      className={`session-hovercard${pos?.flip ? ' points-up' : ' points-down'}${entered ? ' is-in' : ''}`}
      role="tooltip"
      style={{
        top: pos ? `${pos.top}px` : 0,
        left: pos ? `${pos.left}px` : 0,
        // Hidden until measured, so it never flashes at the wrong place first.
        visibility: pos ? 'visible' : 'hidden',
        '--c': sessionColour(session),
        '--ax': `${pos?.ax ?? RADIUS}px`,
      }}
    >
      <div className="session-hovercard-cap">
        <strong className="session-hovercard-name">{session.name}</strong>
        {/* The program, said once. A session with no program has only a type,
            and printing an em dash above it reads as an error rather than as
            "Overview" — the same fix as the list's program column. */}
        {(type || title) && (
          <span className="session-hovercard-prog">
            {title || type}
            {title && type && <span className="session-hovercard-type"> · {type}</span>}
          </span>
        )}
      </div>

      <dl className="session-hovercard-rows">
        <div>
          <dt>Dates</dt>
          <dd>{formatRange(session.starts_at, session.ends_at) || '—'}</dd>
        </div>
        <div>
          <dt>Trainer</dt>
          <dd>{session.trainer?.full_name || 'Unassigned'}</dd>
        </div>
        <div>
          <dt>City</dt>
          <dd>{session.city_code || '—'}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd>{people}</dd>
        </div>
        {vendor && (
          <div>
            <dt>Vendor</dt>
            <dd>{vendor}</dd>
          </div>
        )}
      </dl>

      {/* The tail. Two stacked clip-paths — the program colour underneath, the
          card's fill on top inset by the border width — because a CSS
          border-triangle cannot carry an outline of its own, and this one has
          to continue the card's coloured edge around its point. */}
      <span className="session-hovercard-tail" aria-hidden="true">
        <span className="hc-tail-edge" />
        <span className="hc-tail-fill" />
        <span className="hc-tail-mouth" />
      </span>
    </div>
  );
}

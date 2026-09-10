import { useLayoutEffect, useRef, useState } from 'react';
import { formatRange } from '../../lib/sessionDates.js';
import { sessionColour } from '../../lib/programColour.js';

// The quick-look card for a session bar on the calendar.
//
// It replaces a `title` attribute, which had three problems: it waits about a
// second before appearing, it renders as unstyled OS chrome that cannot show
// the trainer or the headcount without becoming a wall of text, and on a bar
// whose name is already ellipsised it mostly repeated what was on screen.
//
// POSITION: FIXED, NOT ABSOLUTE. .session-cal-wrap sets overflow-x: auto, and
// when one axis is not `visible` the other computes to auto too — so the
// calendar clips on BOTH axes and an absolutely-positioned card would be cut
// off at the grid edge, exactly as the ⋯ menu was cut off by the hero. A fixed
// element is positioned against the viewport and escapes ancestor overflow.
//
// It is pointer-events: none. The card is a read, not a target — letting the
// cursor land on it would make it flicker as the pointer crossed the gap.
const GAP = 8;
const EDGE = 8;   // keep this far off the viewport edge

export default function SessionHoverCard({ session, anchor }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  // Measured after paint, because where it goes depends on how big it turned
  // out to be — a card that would run off the top flips below the bar, and one
  // near the right edge slides back in rather than being clipped.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const box = el.getBoundingClientRect();

    let top = anchor.top - box.height - GAP;
    if (top < EDGE) top = anchor.bottom + GAP;

    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE));

    setPos({ top, left });
  }, [anchor, session]);

  if (!session) return null;

  const people = (session.session_participants || []).length;
  const type = session.program?.program_type?.name;
  const title = session.program?.title;
  const vendor = session.vendor_id ? (session.vendors?.name || session.vendors?.code) : null;

  return (
    <div
      ref={ref}
      className="session-hovercard"
      role="tooltip"
      style={{
        top: pos ? `${pos.top}px` : 0,
        left: pos ? `${pos.left}px` : 0,
        // Hidden until measured, so it never flashes at the wrong place first.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="session-hovercard-head">
        <span className="session-hovercard-swatch" style={{ background: sessionColour(session) }} aria-hidden />
        <strong className="session-hovercard-name">{session.name}</strong>
        {session.closed_at && <span className="session-pill closed">Closed</span>}
      </div>

      {/* The programme, said once. A session with no programme has only a type,
          and printing an em dash above it reads as an error rather than as
          "Overview" — the same fix as the list's programme column. */}
      {(type || title) && (
        <div className="session-hovercard-prog">
          {title || type}
          {title && type && <span className="session-hovercard-type"> · {type}</span>}
        </div>
      )}

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
    </div>
  );
}

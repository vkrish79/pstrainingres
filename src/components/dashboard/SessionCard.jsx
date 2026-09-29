import { Link } from 'react-router-dom';
import { formatRange } from '../../lib/sessionDates.js';
import { sessionColour } from '../../lib/programColour.js';
import { isLeftOpen, isRunning, relativeDay } from '../../lib/sessionFilters.js';

// Card used by the trainer home, vendor drill-in, and "my sessions" strip.
// `showTrainer` adds the trainer's name to the footer; useful in views where
// the caller isn't necessarily the trainer (vendor_manager / super).
//
// THE TITLE NO LONGER SHARES A LINE WITH THE CHIPS, and that one change is
// most of this rewrite. The head was a space-between flex row holding the h3
// and two inline-block tags: the tags cannot shrink, so on a 260px card the
// title took whatever was left — about half the card — and "Venky – resit main
// session" came out as four stacked words. The chips have a row of their own
// now and the title has the full width.
//
// IT IS A COLUMN, NOT A BLOCK, which is the other half. Titles are one, two or
// three lines deep, and with `display: block` every card's dates and footer
// started at a different height, so a row of cards had nothing to read across.
// The footer takes the slack with margin-top:auto — the same fix, and the same
// reasoning, as .wb-card-facts on the workbooks grid.
//
// It also says MORE than it used to. The program was missing entirely (the
// card showed only the program TYPE as a tag, so a program with no type —
// Etihad Guest ARDW + Comarch, for one — showed nothing at all), and so was
// the state that makes a row worth looking at.
export default function SessionCard({ session, showTrainer = false }) {
  const participants = session.session_participants || [];
  const closed = !!session.closed_at;
  const late = !closed && isLeftOpen(session);
  const running = !closed && isRunning(session);

  const type = session.program?.program_type?.name;
  const program = session.program?.title;
  const dates = formatRange(session.starts_at, session.ends_at);

  // The same three states the list marks, said the same way, so switching
  // between List and Cards does not change what a session appears to be.
  const relative = late
    ? `ended ${relativeDay(session.ends_at)}`
    : running
      ? 'running now'
      : (session.starts_at ? relativeDay(session.starts_at) : null);

  return (
    <Link
      to={`/trainer/sessions/${session.id}`}
      className={`session-card${closed ? ' closed' : ''}${late ? ' is-late' : ''}`}
    >
      {/* The program's colour, as a rail down the edge — the same swatch the
          list puts beside a name, so the two views agree about which class is
          which at a glance. */}
      <span className="session-card-rail" style={{ background: sessionColour(session) }} aria-hidden />

      <h3 className="session-card-title">{session.name}</h3>

      {/* The program, which this card never showed. Clamped to one line:
          these titles run long and a card is not where you read them in full. */}
      {(program || type) && (
        <p className="session-card-prog">{program || type}</p>
      )}

      <div className="session-card-tags">
        {type && <span className="type-tag">{type}</span>}
        {session.city_code && <span className="city-tag">{session.city_code}</span>}
        {late && <span className="session-card-state is-late">left open</span>}
        {running && <span className="session-card-state is-running">running now</span>}
        {closed && <span className="closed-pill small">Closed</span>}
      </div>

      {/* Pushed to the bottom by margin-top:auto on the footer above it, so
          these two lines sit level across every card in the row whether the
          title above them took one line or three. */}
      <p className="session-card-dates">
        {dates || <span className="session-card-nodates">No dates</span>}
        {relative && (
          <span className={`session-card-rel${late ? ' is-late' : ''}${running ? ' is-running' : ''}`}>
            {relative}
          </span>
        )}
      </p>

      <p className="session-card-foot">
        {showTrainer && (
          <span>{session.trainer?.full_name || 'Unassigned'}</span>
        )}
        <span>{participants.length} participant{participants.length === 1 ? '' : 's'}</span>
      </p>
    </Link>
  );
}

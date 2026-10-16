import { Link } from 'react-router-dom';
import { formatRange } from '../../lib/sessionDates.js';
import { SessionDayLabel, CockpitClock } from './SessionCockpit.jsx';

// The session dashboard's title, the line under it (dates, trainer, join
// link), the tabs, and the clock. `children` is the right-hand actions (the
// trainer change and ⋯), which belong to the page.
// `on` — the class's feature flags (lib/sessionFeatures.js). A tab for a
// feature the class has switched off is not shown; the reasoning below for
// "always shown" is about a class that USES the feature but has none yet.
export default function SessionCockpitHeader({ session, joinUrl, joinCopied, onCopyJoin, view, setView, paperOnly, on = {}, children }) {
  return (
    <>
      {/* ONE ROW, then the tabs. The old hero stacked Back, the title, the
          dates and the join URL into ~140px above everything; the cockpit
          gives that height to the class. The join link is a small chip —
          it is read aloud and projected, so it stays one click away rather
          than hiding in a menu. The assessment's state moved into the gauges
          below, where it sits with the rest of the room's state. */}
      {/* The class's name is the page's title, above the bar rather than
          squeezed into it — which is also what gives the bar room for the
          tabs and controls on one line. Screen only: a printed L&D report
          carries its own masthead, and the class name is not part of it. */}
      <header className="cockpit-page-title no-print">
        <h1>{session?.name}</h1>
        {session?.session_type?.name && <span className="type-tag inline">{session.session_type.name}</span>}
        {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
      </header>
      <section className="page-hero compact cockpit-hero">
        <div className="cockpit-hero-row">
          <div className="page-hero-text">
            <p className="cockpit-hero-sub">
              <Link to="/trainer" className="back-link">&larr; Sessions</Link>
              {(session?.starts_at || session?.ends_at) && (
                <span className="session-dates">{formatRange(session.starts_at, session.ends_at)}</span>
              )}
              <span className="cockpit-trainer">Trainer <strong>{session?.trainer?.full_name || 'Unassigned'}</strong></span>
              {session?.join_code && (
                <button
                  type="button"
                  className="cockpit-join"
                  onClick={onCopyJoin}
                  title={`Copy the join link: ${joinUrl}`}
                >
                  Join <span className="mono">{session.join_code}</span>
                  <span className="cockpit-join-act">{joinCopied ? 'Link copied' : 'Copy link'}</span>
                </button>
              )}
            </p>
          </div>
          <div className="view-tabs">
            <button className={`view-tab ${view === 'participants' ? 'active' : ''}`} onClick={() => setView('participants')}>Room</button>
            {/* No Workbook tab on a paper-only re-sit: there is no workbook to
                show, and a tab that opens an empty shell is worse than one
                that is not there. Room, Assessment, Quiz and Polls all still
                make sense for a room sitting a paper. */}
            {!paperOnly && (
              <button className={`view-tab ${view === 'practice' ? 'active' : ''}`} onClick={() => setView('practice')}>Workbook</button>
            )}
            {/* ALWAYS SHOWN, like Quiz beside it. This tab used to hide itself
                whenever the session had no assessment — which is exactly when a
                trainer needs it, because a session scheduled before its
                program had an assessment has no other way to get one. The tab
                that disappears when there is nothing in it is the tab you cannot
                use to put something in it. */}
            {on.assessment !== false && (
              <button className={`view-tab ${view === 'assessment' ? 'active' : ''}`} onClick={() => setView('assessment')}>Assessment</button>
            )}
            {/* Always shown, unlike Assessment: a quiz is attached from this very
                tab, so hiding it until one exists would hide the only way in. */}
            {on.quiz !== false && (
              <button className={`view-tab ${view === 'quiz' ? 'active' : ''}`} onClick={() => setView('quiz')}>Quiz</button>
            )}
            {/* Same reasoning: a poll is asked from this tab, so it is always here. */}
            {on.polls !== false && (
              <button className={`view-tab ${view === 'poll' ? 'active' : ''}`} onClick={() => setView('poll')}>Polls</button>
            )}
          </div>
          <div className="page-hero-actions">
            <SessionDayLabel startsAt={session?.starts_at} endsAt={session?.ends_at} />
            <CockpitClock />
            {children}
          </div>
        </div>
      </section>
    </>
  );
}

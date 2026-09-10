import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isTrainerTier, homePathForRole, roleLabel } from '../lib/roles.js';
import GlobalSearch from './GlobalSearch.jsx';
import Sidenav from './Sidenav.jsx';

// The app bar, matching myLearning HUB: dark, full width, with where-you-are on
// the left, search in the middle and who-you-are on the right.
//
// Navigation moved OUT of here and into the left rail. What stays is the small
// set of things that are true on every page — search and identity — rather
// than a link row that grew past what a single line can hold.
//
// PARTICIPANTS KEEP THE OLD, PLAIN BAR. Their two pages are a paper to read and
// fill in; wrapping that in admin chrome would be a downgrade dressed as
// consistency. The rail and the section title are gated on being on a /trainer
// route, not on role, so a trainer previewing a participant page sees what the
// participant sees.

// Where-you-are, derived from the route rather than passed down by every page.
// Longest prefix wins, so /trainer/assessments/:id resolves to Assessments
// rather than falling back to Sessions.
const SECTIONS = [
  ['/trainer/assessments', 'Assessments'],
  ['/trainer/quizzes', 'Quizzes'],
  ['/trainer/programs', 'Programs'],
  ['/trainer/workbooks', 'Workbooks'],
  ['/trainer/sessions', 'Sessions'],
  ['/trainer/changes', 'Session changes'],
  ['/trainer/archive', 'Closed sessions'],
  ['/trainer/analytics', 'Analytics'],
  ['/trainer/vendors', 'Vendors'],
  ['/trainer/staff', 'Staff'],
  ['/trainer/settings', 'Settings'],
  ['/trainer/prep', 'Prep'],
  ['/trainer', 'Sessions'],
];

function sectionTitle(pathname) {
  const hit = SECTIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

export default function TopBar() {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const isTrainer = isTrainerTier(profile?.role);
  const homePath = homePathForRole(profile?.role);
  const chipLabel = roleLabel(profile?.role);

  const onTrainerRoute = pathname.startsWith('/trainer');
  const showShell = isTrainer && onTrainerRoute;
  const title = showShell ? sectionTitle(pathname) : null;

  return (
    <>
      {showShell && <Sidenav />}
      <header className={`topbar${showShell ? ' topbar--shell' : ''}`}>
        <div className="topbar-inner">
          {showShell ? (
            <div className="topbar-where">
              <div className="topbar-where-title">{title}</div>
              <div className="topbar-where-sub">Training resources</div>
            </div>
          ) : (
            <Link to={homePath} className="topbar-brand">
              <div className="topbar-mark">PS</div>
              <div className="topbar-brand-text">
                <div className="topbar-brand-title">pstrainingres</div>
                <div className="topbar-brand-sub">Training resources</div>
              </div>
            </Link>
          )}

          {/* Search sits in a slot of its own, between where-you-are and who-
              you-are, so it lands in the CENTRE of the bar rather than wherever
              the width of the identity block happens to leave it. See the grid
              in shell.css — three columns, the middle one fixed, which is what
              makes the centring true rather than approximate.

              THE PREP BUTTON HAS GONE from beside it. It was a second route to
              prep that the Prep item in the left rail already reaches, and it
              carried a count badge for a warning the banner on the page below
              states in words. Two doors to one room, one of them unlabelled. */}
          {isTrainer && (
            <div className="topbar-search-slot">
              <GlobalSearch />
            </div>
          )}

          <nav className="topbar-nav">
            <span className="topbar-user">
              <span className="topbar-user-avatar">{(profile?.full_name || '?').charAt(0).toUpperCase()}</span>
              <span className="topbar-user-text">
                <span className="topbar-user-name">{profile?.full_name}</span>
                {chipLabel && <span className="topbar-user-role">{chipLabel}</span>}
              </span>
            </span>
            <button className="topbar-signout" onClick={signOut} title="Sign out">⇥</button>
          </nav>
        </div>
      </header>
    </>
  );
}

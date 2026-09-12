import { Link } from 'react-router-dom';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { isSuperTrainerOrAbove, isVendorManagerOrAbove } from '../lib/roles.js';
import SessionViews from '../components/dashboard/SessionViews.jsx';
import LowPrepBanner from '../components/dashboard/LowPrepBanner.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

export default function TrainerHomePage() {
  const { profile, session: authSession } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const isManager = isVendorManagerOrAbove(profile?.role) && !isSuper;

  return (
    <>
      <TopBar />
      <main className="page">
        {/* The prep warning comes before the hero because it is the only thing
            on this page that is asking for something. */}
        <LowPrepBanner profile={profile} />

        {isSuper && <SuperHome userId={authSession?.user.id} />}
        {isManager && <VendorManagerHome userId={authSession?.user.id} />}
        {!isSuper && !isManager && <VendorTrainerHome userId={authSession?.user.id} />}
      </main>
    </>
  );
}

// ----- super_admin / super_trainer -----------------------------------------

function SuperHome({ userId }) {

  // EVERY session, not just the PS-delivered ones.
  //
  // This was scope='super' — vendor_id IS NULL — so vendor sessions were never
  // loaded at all, and the only way to see one was to click through a vendor
  // card. That made the calendar structurally unable to answer "what is running
  // the week of the 12th", because half the answer was not in the page.
  //
  // scope='all' adds no explicit filter and lets RLS scope it: a super gets
  // everything, a vendor manager only their own vendor. The vendor filter below
  // is what narrows it back down on demand.
  //
  // `error` is read HERE and not dropped, unlike before. scope='super' was a
  // narrow, reliably-permitted query; scope='all' pulls every session in the
  // system through RLS, so it is the branch most likely to be refused. Without
  // this the refusal renders as a hero reading "0 sessions" and nothing else —
  // the same silent shape as an update() with no .select().
  const { loading: msl, error, sessions } = useTrainerSessions(userId, 'all');

  return (
    <>
      {msl && <SkeletonCards count={6} label="Loading sessions…" />}
      {error && <div className="error">{error}</div>}
      {/* With no sessions there is no filter row, so the action has to be
          drawn here or there is no way to make the first one. */}
      {!msl && !error && sessions.length === 0 && (
        <EmptySessions>No sessions yet.</EmptySessions>
      )}
      {!msl && sessions.length > 0 && (
        <SessionViews
          id="sup"
          sessions={sessions}
          showTrainer
          showVendor
          action={<NewSessionLink />}
          emptyLabel="No sessions yet."
        />
      )}

      {/* THE VENDOR CARD GRID HAS GONE. It was navigation dressed as content:
          a card per vendor whose only job was to reach that vendor's sessions
          — which are now in the list above, filterable by vendor, on the same
          screen. Vendors is already in the rail for managing them, and the
          Sessions count on that page is the drill-in link the grid used to be.
          Removing it also removes the "No vendors yet" band, which spent a
          whole section of the page on an empty state. */}
    </>
  );
}

// ----- vendor_manager -------------------------------------------------------

function VendorManagerHome({ userId }) {
  // scope='all' relies on RLS: vendor_manager naturally sees only their vendor.
  const { loading: sl, error, sessions } = useTrainerSessions(userId, 'all');

  return (
    <>
      {sl && <SkeletonCards count={6} label="Loading sessions…" />}
      {error && <div className="error">{error}</div>}
      {!sl && !error && sessions.length === 0 && (
        <EmptySessions>No sessions in this vendor yet.</EmptySessions>
      )}
      {!sl && sessions.length > 0 && (
        <SessionViews
          id="ven"
          sessions={sessions}
          showTrainer
          action={<NewSessionLink />}
          emptyLabel="No sessions in this vendor yet."
        />
      )}
    </>
  );
}

// ----- vendor_trainer (and pre-migration "trainer") ------------------------

function VendorTrainerHome({ userId }) {
  const { loading: sl, error, sessions } = useTrainerSessions(userId, 'own');

  return (
    <>
      {sl && <SkeletonCards count={6} label="Loading sessions…" />}
      {error && <div className="error">{error}</div>}
      {!sl && !error && sessions.length === 0 && (
        <EmptySessions>You have no sessions yet.</EmptySessions>
      )}
      {!sl && sessions.length > 0 && (
        <SessionViews
          id="my"
          sessions={sessions}
          action={<NewSessionLink />}
          emptyLabel="You have no sessions yet."
        />
      )}
    </>
  );
}

// ----- shared bits ----------------------------------------------------------

// NO PAGE HEADING AT ALL, and that is deliberate.
//
// This page has had three in a row: a dark hero banner with an h1, then a
// section-row with an h2 and a count. Both said "Sessions" — which the app
// bar's where-you-are strip already says, two inches above, on every trainer
// route. A heading that repeats the chrome is a line everybody reads past.
//
// So the action moved into the filter row, where the other controls for this
// list live, and the heading went with the block that was carrying it. What is
// left above the list is exactly the things you can act on.
function NewSessionLink() {
  return <Link to="/trainer/sessions/new" className="primary-link">+ New session</Link>;
}

// The empty state carries the action itself. The filter row is where it
// normally lives, and SessionFilters draws nothing when there is nothing to
// filter — so without this, a trainer with no sessions has no button to make
// their first one.
function EmptySessions({ children }) {
  return (
    <div className="session-empty">
      <p className="muted">{children}</p>
      <NewSessionLink />
    </div>
  );
}

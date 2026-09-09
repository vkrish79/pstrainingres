import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { useTrainerWorkbooks } from '../hooks/useTrainerWorkbooks.js';
import { useVendors } from '../hooks/useVendors.js';
import { isSuperTrainerOrAbove, isVendorManagerOrAbove, ROLES } from '../lib/roles.js';
import { heatLevel } from '../lib/configDiff.js';
import SessionViews from '../components/dashboard/SessionViews.jsx';
import LowPrepBanner from '../components/dashboard/LowPrepBanner.jsx';
import TopBar from '../components/TopBar.jsx';
import { useEditHeatTotals } from '../hooks/useWorkbookEditHeat.js';
import '../styles/dashboard.css';
import '../styles/edit-heat.css';

export default function TrainerHomePage() {
  const { profile, session: authSession } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const isManager = isVendorManagerOrAbove(profile?.role) && !isSuper;

  const firstName = (profile?.full_name || '').split(' ')[0] || 'there';

  return (
    <>
      <TopBar />
      <main className="page">
        {/* No welcome banner. The rail says where you are and the bar says who
            you are, so a block whose only content was a greeting was spending
            the most valuable strip of the page on nothing.
            Programs and Assessments left with it — they are destinations, and
            destinations belong in the rail. What stays here is the things you
            DO from this page, which have nowhere else to live. */}
        <section className="page-bar">
          <div className="page-bar-actions">
            {isSuper && (
              <>
                <Link to="/trainer/workbooks/new" className="ghost-link">+ New workbook</Link>
                <Link to="/trainer/workbooks/import" className="ghost-link">↑ Import .docx</Link>
              </>
            )}
            <Link to="/trainer/sessions/new" className="primary-link">+ New session</Link>
          </div>
        </section>

        <LowPrepBanner profile={profile} />

        {isSuper && <SuperHome userId={authSession?.user.id} role={profile?.role} />}
        {isManager && <VendorManagerHome userId={authSession?.user.id} role={profile?.role} />}
        {!isSuper && !isManager && <VendorTrainerHome userId={authSession?.user.id} role={profile?.role} />}
      </main>
    </>
  );
}

// ----- super_admin / super_trainer -----------------------------------------

function SuperHome({ userId, role }) {
  const { loading: vl, vendors } = useVendors();
  // All super-trainer-delivered sessions (vendor_id is null), not just the
  // caller's own — every super sees the shared super pool of sessions.
  const { loading: msl, sessions: superSessions } = useTrainerSessions(userId, 'super');
  const { loading: wl, workbooks } = useTrainerWorkbooks(userId, role);

  return (
    <>
      {!msl && superSessions.length > 0 && (
        <>
          <SectionHeader title="PS training sessions" />
          <SessionViews
            id="sup"
            sessions={superSessions}
            showTrainer
            emptyLabel="No super-trainer sessions yet."
          />
        </>
      )}

      <SectionHeader title="Vendors" topGap />
      {vl && <div className="loading">Loading…</div>}
      {!vl && vendors.length === 0 && (
        <p className="muted">No vendors yet. <Link to="/trainer/vendors">Add one</Link>.</p>
      )}
      {!vl && vendors.length > 0 && (
        <div className="session-grid">
          {vendors.map(v => (
            <Link key={v.id} to={`/trainer/vendors/${v.id}/sessions`} className="session-card vendor-card">
              <div className="session-card-head">
                <h3>{v.name}</h3>
                <span className="city-tag">{v.code}</span>
              </div>
              <p className="session-card-meta">
                {v.session_count} session{v.session_count === 1 ? '' : 's'} ·
                {' '}{v.trainer_count} trainer{v.trainer_count === 1 ? '' : 's'}
              </p>
            </Link>
          ))}
        </div>
      )}

      <WorkbookLibrary loading={wl} workbooks={workbooks} />
    </>
  );
}

// ----- vendor_manager -------------------------------------------------------

function VendorManagerHome({ userId, role }) {
  // scope='all' relies on RLS: vendor_manager naturally sees only their vendor.
  const { loading: sl, error, sessions } = useTrainerSessions(userId, 'all');
  const { loading: wl, workbooks } = useTrainerWorkbooks(userId, role);

  const totalParticipants = sessions.reduce(
    (sum, s) => sum + (s.session_participants?.length || 0), 0,
  );

  return (
    <>
      <div className="stat-strip">
        <StatCard icon="S" num={sl ? '—' : sessions.length} label="Vendor session" />
        <StatCard icon="P" num={sl ? '—' : totalParticipants} label="Enrolled participant" />
        <StatCard icon="W" num={wl ? '—' : workbooks.length} label="Workbook" />
      </div>

      <SectionHeader title="Vendor sessions" />
      {sl && <div className="loading">Loading…</div>}
      {error && <div className="error">{error}</div>}
      {!sl && !error && sessions.length === 0 && (
        <p className="muted">No sessions yet. Click "New session" above to create one.</p>
      )}
      {!sl && sessions.length > 0 && (
        <SessionViews
          id="ven"
          sessions={sessions}
          showTrainer
          emptyLabel="No sessions in this vendor yet."
        />
      )}
      <WorkbookLibrary loading={wl} workbooks={workbooks} />
    </>
  );
}

// ----- vendor_trainer (and pre-migration "trainer") ------------------------

function VendorTrainerHome({ userId, role }) {
  const { loading: sl, error, sessions } = useTrainerSessions(userId, 'own');
  const { loading: wl, workbooks } = useTrainerWorkbooks(userId, role);

  const totalParticipants = sessions.reduce(
    (sum, s) => sum + (s.session_participants?.length || 0), 0,
  );

  return (
    <>
      <div className="stat-strip">
        <StatCard icon="S" num={sl ? '—' : sessions.length} label="Session" />
        <StatCard icon="P" num={sl ? '—' : totalParticipants} label="Enrolled participant" />
        <StatCard icon="W" num={wl ? '—' : workbooks.length} label="Workbook" />
      </div>

      <SectionHeader title="Your sessions" />
      {sl && <div className="loading">Loading…</div>}
      {error && <div className="error">{error}</div>}
      {!sl && !error && sessions.length === 0 && (
        <p className="muted">No sessions yet. Click "New session" above to create one.</p>
      )}
      {!sl && sessions.length > 0 && (
        <SessionViews
          id="my"
          sessions={sessions}
          emptyLabel="You have no sessions yet."
        />
      )}
      <WorkbookLibrary loading={wl} workbooks={workbooks} />
    </>
  );
}

// ----- shared bits ----------------------------------------------------------

function StatCard({ icon, num, label }) {
  const plural = String(num) !== '1' ? 's' : '';
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-num">{num}</div>
        <div className="stat-label">{label}{plural}</div>
      </div>
    </div>
  );
}

function SectionHeader({ title, topGap = false }) {
  return (
    <div className="section-row" style={topGap ? { marginTop: '2rem' } : undefined}>
      <h2 className="section-title">{title}</h2>
    </div>
  );
}

function WorkbookLibrary({ loading, workbooks }) {
  // Read the role here rather than threading it through three call sites.
  // Non-super trainers make no call at all — they cannot read the log.
  const { profile } = useAuth();
  const heatTotals = useEditHeatTotals(isSuperTrainerOrAbove(profile?.role));

  return (
    <>
      <SectionHeader title="Workbooks" topGap />
      {loading && <div className="loading">Loading…</div>}
      {!loading && workbooks.length === 0 && <p className="muted">No workbooks yet.</p>}
      {!loading && workbooks.length > 0 && (
        <div className="session-grid">
          {workbooks.map(w => (
            <Link key={w.id} to={`/trainer/workbooks/${w.id}`} className="session-card">
              <h3>{w.title}</h3>
              {w.description && <p className="session-card-workbook">{w.description}</p>}
              <p className="session-card-meta">Updated {new Date(w.updated_at).toLocaleDateString()}</p>
              {heatTotals.get(w.id) && (
                <p className="wb-card-heat">
                  <span className={`heat-dot heat-l${heatLevel(heatTotals.get(w.id).sessionCount)}`} aria-hidden />
                  {heatTotals.get(w.id).sectionCount} to review
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { useTrainerWorkbooks } from '../hooks/useTrainerWorkbooks.js';
import { useVendors } from '../hooks/useVendors.js';
import { isSuperTrainerOrAbove, isVendorManagerOrAbove, ROLES } from '../lib/roles.js';
import SessionCard from '../components/dashboard/SessionCard.jsx';
import LowPrepBanner from '../components/dashboard/LowPrepBanner.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

export default function TrainerHomePage() {
  const { profile, session: authSession } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const isManager = isVendorManagerOrAbove(profile?.role) && !isSuper;

  const firstName = (profile?.full_name || '').split(' ')[0] || 'there';

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero">
          <div className="page-hero-text">
            <h1>Welcome back, {firstName}</h1>
          </div>
          <div className="page-hero-actions">
            {isSuper && (
              <>
                <Link to="/trainer/workbooks/new" className="ghost-link">+ New workbook</Link>
                <Link to="/trainer/workbooks/import" className="ghost-link">↑ Import .docx</Link>
              </>
            )}
            <Link to="/trainer/sessions/new">+ New session</Link>
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

  const totalSessions = vendors.reduce((s, v) => s + (v.session_count || 0), 0);
  const totalTrainers = vendors.reduce((s, v) => s + (v.trainer_count || 0), 0);

  return (
    <>
      <div className="stat-strip">
        <StatCard icon="V" num={vl ? '—' : vendors.length} label="Vendor" />
        <StatCard icon="S" num={vl ? '—' : totalSessions} label="Session" />
        <StatCard icon="T" num={vl ? '—' : totalTrainers} label="Trainer" />
        <StatCard icon="W" num={wl ? '—' : workbooks.length} label="Workbook" />
      </div>

      {!msl && superSessions.length > 0 && (
        <>
          <SectionHeader title="Super trainer sessions" />
          <div className="session-grid">
            {superSessions.map(s => <SessionCard key={s.id} session={s} showTrainer />)}
          </div>
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
        <div className="session-grid">
          {sessions.map(s => <SessionCard key={s.id} session={s} showTrainer />)}
        </div>
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
        <div className="session-grid">
          {sessions.map(s => <SessionCard key={s.id} session={s} />)}
        </div>
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
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

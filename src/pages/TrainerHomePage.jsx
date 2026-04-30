import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { useTrainerWorkbooks } from '../hooks/useTrainerWorkbooks.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

export default function TrainerHomePage() {
  const { profile, session: authSession } = useAuth();
  const { loading: sl, error: se, sessions } = useTrainerSessions(authSession?.user.id);
  const { loading: wl, workbooks } = useTrainerWorkbooks(authSession?.user.id);

  const firstName = (profile?.full_name || '').split(' ')[0] || 'there';
  const totalParticipants = sessions.reduce(
    (sum, s) => sum + (s.session_participants?.length || 0),
    0
  );

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero">
          <div className="page-hero-text">
            <h1>Welcome back, {firstName}</h1>
            <p>Manage workbooks, run sessions, and watch participants progress live.</p>
          </div>
          <div className="page-hero-actions">
            <Link to="/trainer/sessions/new">+ New session</Link>
          </div>
        </section>

        <div className="stat-strip">
          <div className="stat-card">
            <div className="stat-icon">W</div>
            <div>
              <div className="stat-num">{wl ? '—' : workbooks.length}</div>
              <div className="stat-label">Workbook{workbooks.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">S</div>
            <div>
              <div className="stat-num">{sl ? '—' : sessions.length}</div>
              <div className="stat-label">Session{sessions.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">P</div>
            <div>
              <div className="stat-num">{sl ? '—' : totalParticipants}</div>
              <div className="stat-label">Enrolled participants</div>
            </div>
          </div>
        </div>

        <div className="section-row">
          <h2 className="section-title">Workbooks</h2>
        </div>
        {wl && <div className="loading">Loading…</div>}
        {!wl && workbooks.length === 0 && <p className="muted">No workbooks yet.</p>}
        {!wl && workbooks.length > 0 && (
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

        <div className="section-row" style={{ marginTop: '2rem' }}>
          <h2 className="section-title">Your sessions</h2>
        </div>
        {sl && <div className="loading">Loading…</div>}
        {se && <div className="error">{se}</div>}
        {!sl && !se && sessions.length === 0 && (
          <p className="muted">No sessions yet. Click "New session" above to create one.</p>
        )}
        {!sl && sessions.length > 0 && (
          <div className="session-grid">
            {sessions.map(s => (
              <Link key={s.id} to={`/trainer/sessions/${s.id}`} className="session-card">
                <h3>{s.name}</h3>
                <p className="session-card-workbook">{s.workbooks?.title}</p>
                <p className="session-card-meta">
                  {(s.session_participants || []).length} participant{(s.session_participants || []).length === 1 ? '' : 's'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

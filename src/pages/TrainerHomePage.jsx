import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { useTrainerWorkbooks } from '../hooks/useTrainerWorkbooks.js';
import '../styles/dashboard.css';

export default function TrainerHomePage() {
  const { profile, signOut, session: authSession } = useAuth();
  const { loading: sl, error: se, sessions } = useTrainerSessions(authSession?.user.id);
  const { loading: wl, workbooks } = useTrainerWorkbooks(authSession?.user.id);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Trainer home</h1>
        <div>
          <Link to="/trainer/people" className="ghost-link">People</Link>
          <span>{profile?.full_name}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

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
        <Link to="/trainer/sessions/new" className="primary-link">+ New session</Link>
      </div>
      {sl && <div className="loading">Loading…</div>}
      {se && <div className="error">{se}</div>}
      {!sl && !se && sessions.length === 0 && (
        <p className="muted">No sessions yet. Click "New session" to create one.</p>
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
    </div>
  );
}

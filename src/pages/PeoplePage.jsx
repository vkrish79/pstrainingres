import { Link } from 'react-router-dom';
import { useParticipants } from '../hooks/useParticipants.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function PeoplePage() {
  const { loading, error, participants } = useParticipants();

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>People</h1>
            <p>Roster of all participant accounts. To add or enrol a participant, open the relevant session and use <strong>+ Add</strong> there.</p>
          </div>
        </section>

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Participants ({participants.length})</h2>
          {loading && <div className="loading">Loading…</div>}
          {error && <p className="error">{error}</p>}
          {!loading && participants.length === 0 && <p className="muted">No participants yet. Create a session and add participants from there.</p>}
          {!loading && participants.length > 0 && (
            <table className="participants-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {participants.map(p => (
                  <tr key={p.id}>
                    <td>{p.full_name || '—'}</td>
                    <td>{p.email || '—'}</td>
                    <td>{p.must_change_password ? <span className="status-pill warn">Awaiting first login</span> : <span className="status-pill ok">Active</span>}</td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}

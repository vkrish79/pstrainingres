import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useParticipants, generateTempPassword } from '../hooks/useParticipants.js';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function PeoplePage() {
  const { profile, signOut } = useAuth();
  const { loading, error, participants, createParticipant } = useParticipants();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [lastCreated, setLastCreated] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(''); setBusy(true);
    const { data, error } = await createParticipant({
      email: email.trim(),
      full_name: fullName.trim(),
      temp_password: tempPassword,
    });
    setBusy(false);
    if (error) { setFormError(error.message); return; }
    setLastCreated({ email: data.email, full_name: data.full_name, temp_password: tempPassword });
    setEmail(''); setFullName(''); setTempPassword(generateTempPassword());
  }

  return (
    <div className="page editor">
      <header className="page-header">
        <div>
          <Link to="/trainer" className="back-link">&larr; Back</Link>
          <h1>People</h1>
          <p className="muted">Create participant accounts and view the roster.</p>
        </div>
        <div>
          <span>{profile?.full_name}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

      <section className="editor-card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Add a participant</h2>
        <form onSubmit={handleSubmit} className="add-person-form">
          <div className="form-grid">
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Full name</label>
              <input className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="form-label">Temporary password</label>
              <div className="password-row">
                <input className="form-input" required value={tempPassword} onChange={e => setTempPassword(e.target.value)} />
                <button type="button" className="ghost" onClick={() => setTempPassword(generateTempPassword())}>Generate</button>
              </div>
              <p className="hint">Share this with the participant — they'll change it on first login.</p>
            </div>
          </div>
          {formError && <p className="error">{formError}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy || !email || tempPassword.length < 8}>
              {busy ? 'Creating…' : 'Create participant'}
            </button>
          </div>
        </form>

        {lastCreated && (
          <div className="created-card">
            <strong>Created.</strong> Share these credentials with <em>{lastCreated.full_name}</em>:
            <div className="credentials">
              <span>{lastCreated.email}</span>
              <span className="mono">{lastCreated.temp_password}</span>
            </div>
          </div>
        )}
      </section>

      <section className="editor-card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Participants ({participants.length})</h2>
        {loading && <div className="loading">Loading…</div>}
        {error && <p className="error">{error}</p>}
        {!loading && participants.length === 0 && <p className="muted">No participants yet.</p>}
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
    </div>
  );
}

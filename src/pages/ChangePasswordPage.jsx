import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ChangePasswordPage() {
  const { profile, changePassword } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    if (pw !== pw2) return setError('Passwords do not match.');
    setBusy(true);
    const { error } = await changePassword(pw);
    setBusy(false);
    if (error) return setError(error.message);
    navigate(profile?.role === 'trainer' ? '/trainer' : '/workbook', { replace: true });
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <div className="auth-brand-mark">PS</div>
          <div>
            <div className="auth-brand-title">pstrainingres</div>
            <div className="auth-brand-sub">Training resources</div>
          </div>
        </div>
        <h1>Set a new password</h1>
        <p className="auth-hint">First-time login — please choose your own password.</p>
        <label>New password
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoFocus />
        </label>
        <label>Confirm new password
          <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} required />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  );
}

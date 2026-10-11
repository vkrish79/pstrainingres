import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { homePathForRole } from '../lib/roles.js';
import AuthBrand from '../components/auth/AuthBrand.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';

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
    navigate(homePathForRole(profile?.role), { replace: true });
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <AuthBrand />
        <h1>Set a new password</h1>
        <p className="auth-hint">First-time login — please choose your own password.</p>
        <label>New password
          <PasswordInput value={pw} onChange={e => setPw(e.target.value)} required autoFocus aria-describedby="pw-rule" />
          <span id="pw-rule" className="auth-rule">At least 8 characters</span>
        </label>
        <label>Confirm new password
          <PasswordInput value={pw2} onChange={e => setPw2(e.target.value)} required />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  );
}

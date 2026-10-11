import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { takeIdleNotice } from '../components/IdleSignOut.jsx';
import { friendlySignInError } from '../lib/authMessages.js';
import AuthBrand from '../components/auth/AuthBrand.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Read once: after an inactivity sign-out, say so, rather than leaving someone
  // wondering why they are looking at the login page.
  const [idleNotice] = useState(() => takeIdleNotice('staff'));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setError(friendlySignInError(error));
    else navigate('/trainer'); // ProtectedRoute will redirect participants/forced-change as needed
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <AuthBrand />
        <h1>Sign in</h1>
        {idleNotice && (
          <div className="auth-notice" role="status">You were signed out after an hour of inactivity.</div>
        )}
        <label>Email
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Password
          <PasswordInput value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="auth-meta">
          <Link to="/forgot-password" className="auth-link">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}

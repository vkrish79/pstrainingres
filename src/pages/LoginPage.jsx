import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setError(error.message);
    else navigate('/trainer'); // ProtectedRoute will redirect participants/forced-change as needed
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
        <h1>Sign in</h1>
        <label>Email
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="auth-meta">
          <Link to="/forgot-password" className="auth-link">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error: sendErr } = await sendPasswordReset(email.trim());
    setBusy(false);
    // Always show "sent" — never reveal whether the address has an account.
    if (sendErr && !/rate/i.test(sendErr.message)) {
      setError(sendErr.message);
      return;
    }
    setSent(true);
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
        <h1>Reset your password</h1>

        {sent ? (
          <>
            <p className="auth-hint">
              If an account exists for <strong>{email}</strong>, a password-reset link has been sent.
              Check your inbox (and spam) and click the link to set a new password.
            </p>
            <div className="auth-meta">
              <Link to="/login" className="auth-link">Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
            <p className="auth-hint">Enter your email — we'll send you a link to set a new password.</p>
            <label>Email
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <div className="auth-meta">
              <Link to="/login" className="auth-link">Back to sign in</Link>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

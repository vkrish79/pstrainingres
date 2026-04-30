import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// Landing page for the password-reset email link. The Supabase client
// detects the recovery token in the URL on load and creates a session,
// so by the time the user gets here, updateUser({ password }) works.
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { changePassword, profile } = useAuth();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The recovery session is established asynchronously when the URL is parsed.
    // Listen for PASSWORD_RECOVERY (fired explicitly for recovery links) or for
    // any session that's now active. Also poll once after a short delay in case
    // the event already fired before this listener was attached.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || session) {
        setRecoveryReady(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setRecoveryReady(true);
      setChecking(false);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    if (pw !== pw2) return setError('Passwords do not match.');
    setBusy(true);
    const { error: upErr } = await changePassword(pw);
    setBusy(false);
    if (upErr) return setError(upErr.message);
    setDone(true);
    // Send them straight in — they're authenticated.
    setTimeout(() => {
      const home = profile?.role === 'trainer' ? '/trainer' : '/workbook';
      navigate(home, { replace: true });
    }, 1200);
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

        {checking && <p className="auth-hint">Verifying reset link…</p>}

        {!checking && !recoveryReady && (
          <>
            <p className="auth-hint">
              This reset link is invalid or has expired. Request a new one from the forgot-password page.
            </p>
            <div className="auth-meta">
              <Link to="/forgot-password" className="auth-link">Request a new link</Link>
            </div>
          </>
        )}

        {!checking && recoveryReady && !done && (
          <>
            <label>New password
              <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoFocus minLength={8} />
            </label>
            <label>Confirm new password
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} required minLength={8} />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</button>
          </>
        )}

        {done && <p className="auth-hint">Password updated — taking you in…</p>}
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { takeIdleNotice } from '../components/IdleSignOut.jsx';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import AuthBrand from '../components/auth/AuthBrand.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';
import { friendlySignInError } from '../lib/authMessages.js';

const SENTINEL_DOMAIN = 'pstrainingres.local';

function formatDateRange(starts, ends) {
  if (!starts && !ends) return '';
  const fmt = (s) => s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
  return fmt(starts || ends);
}

export default function JoinSessionLoginPage() {
  const { code } = useParams();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [lookupState, setLookupState] = useState('loading'); // loading | found | notfound | error
  const [session, setSession] = useState(null);
  const [lookupError, setLookupError] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idleNotice] = useState(() => takeIdleNotice('join'));

  const normalizedCode = (code || '').toUpperCase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLookupState('loading');
      const { data, error: e } = await supabase.rpc('get_session_by_join_code', { p_code: normalizedCode });
      if (cancelled) return;
      if (e) { setLookupError(e.message); setLookupState('error'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setLookupState('notfound'); return; }
      setSession(row);
      setLookupState('found');
    })();
    return () => { cancelled = true; };
  }, [normalizedCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const u = username.trim().toLowerCase();
    const authEmail = u.includes('@') ? u : `${u}@${normalizedCode.toLowerCase()}.${SENTINEL_DOMAIN}`;
    const { error: signErr } = await signIn(authEmail, password);
    setBusy(false);
    if (signErr) {
      // Only a credentials refusal is "wrong password"; offline or a rate
      // limit keeps its own words (lib/authMessages.js).
      setError(/invalid login credentials/i.test(signErr.message || '')
        ? 'WRONG'
        : friendlySignInError(signErr));
      return;
    }
    navigate('/workbook');
  }

  if (lookupState === 'loading') {
    return (
      <div className="auth-shell">
        <div className="auth-card"><p>Looking up session…</p></div>
      </div>
    );
  }

  if (lookupState === 'found' && session?.closed_at) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <AuthBrand />
          <h1>This session has ended</h1>
          <div className="session-header-meta">
            <div style={{ fontWeight: 600 }}>{session.name}</div>
            {(session.starts_at || session.ends_at) && <div className="hint">{formatDateRange(session.starts_at, session.ends_at)}</div>}
          </div>
          <p>It closed on {new Date(session.closed_at).toLocaleDateString()}. Your answers were kept with the class record — there is nothing more to do here. If you need a copy of your workbook, ask your trainer.</p>
          <StaffLink />
        </div>
      </div>
    );
  }

  if (lookupState === 'notfound' || lookupState === 'error') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <AuthBrand />
          <h1>Session not found</h1>
          <p>No session matches the code <span className="mono">{normalizedCode}</span>. Check the link from your trainer — or ask them for it again, the code is six letters and numbers.</p>
          {lookupState === 'error' && lookupError && <p className="auth-error" role="alert">{lookupError}</p>}
          <StaffLink />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <AuthBrand />
        <h1>Join session</h1>
        {idleNotice && (
          <div className="auth-notice" role="status">You were signed out after an hour of inactivity. Sign in again to carry on — your answers are saved.</div>
        )}
        <div className="session-header-meta" style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 600 }}>{session.name}</div>
          {(session.starts_at || session.ends_at) && (
            <div className="hint">{formatDateRange(session.starts_at, session.ends_at)}</div>
          )}
          <div className="hint">Code: <span className="mono">{normalizedCode}</span></div>
        </div>
        <label>Username
          <input value={username} onChange={e => setUsername(e.target.value)} required autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </label>
        <label>Password
          <PasswordInput value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && (
          <div className="auth-error" role="alert">
            {error === 'WRONG'
              ? <>That username and password don't match for this session. <strong>Forgotten it?</strong> Your trainer can reset it for you from the class.</>
              : error}
          </div>
        )}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <StaffLink />
      </form>
    </div>
  );
}

// For a trainer who opened a participant link. Kept, but quiet: on these
// screens the reader is almost always a participant, for whom "Staff sign in"
// is a door that goes nowhere.
function StaffLink() {
  return (
    <div className="auth-meta auth-meta-quiet">
      Trainer? <Link to="/login" className="auth-link">Staff sign in</Link>
    </div>
  );
}

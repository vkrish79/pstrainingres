import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';

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
      setError('Username or password is incorrect for this session.');
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
          <div className="auth-brand">
            <div className="auth-brand-mark">PS</div>
            <div>
              <div className="auth-brand-title">pstrainingres</div>
              <div className="auth-brand-sub">Training resources</div>
            </div>
          </div>
          <h1>This session has ended</h1>
          <p>{session.name} closed on {new Date(session.closed_at).toLocaleDateString()}. Your workbook and answers have been archived by your trainer.</p>
          <div className="auth-meta">
            <Link to="/login" className="auth-link">Staff sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  if (lookupState === 'notfound' || lookupState === 'error') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-brand-mark">PS</div>
            <div>
              <div className="auth-brand-title">pstrainingres</div>
              <div className="auth-brand-sub">Training resources</div>
            </div>
          </div>
          <h1>Session not found</h1>
          <p>No session matches the code <span className="mono">{normalizedCode}</span>. Check the link from your trainer.</p>
          {lookupState === 'error' && lookupError && <p className="auth-error">{lookupError}</p>}
          <div className="auth-meta">
            <Link to="/login" className="auth-link">Staff sign in</Link>
          </div>
        </div>
      </div>
    );
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
        <h1>Join session</h1>
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
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="auth-meta">
          <Link to="/login" className="auth-link">Staff sign in</Link>
        </div>
      </form>
    </div>
  );
}

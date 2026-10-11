import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { homePathForRole } from '../lib/roles.js';
import AuthBrand from '../components/auth/AuthBrand.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';

const MIN = 8;

export default function ChangePasswordPage() {
  const { profile, changePassword } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // The two rules, ticked as they type rather than discovered on Save.
  const longEnough = pw.length >= MIN;
  const matches = pw2.length > 0 && pw === pw2;
  const isParticipant = profile?.role === 'participant';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!longEnough) return setError(`Password must be at least ${MIN} characters.`);
    if (!matches) return setError('Passwords do not match.');
    setBusy(true);
    const { error } = await changePassword(pw);
    setBusy(false);
    if (error) return setError(error.message);
    // Said out loud before the page changes, so the new password is known to
    // have taken rather than assumed.
    setSaved(true);
    setTimeout(() => navigate(homePathForRole(profile?.role), { replace: true }), 900);
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <AuthBrand />
        <h1>Set a new password</h1>
        <p className="auth-hint">First-time login — please choose your own password.</p>
        <label>New password
          <PasswordInput value={pw} onChange={e => setPw(e.target.value)} required autoFocus aria-describedby="pw-rules" disabled={saved} />
        </label>
        <label>Confirm new password
          <PasswordInput value={pw2} onChange={e => setPw2(e.target.value)} required aria-describedby="pw-rules" disabled={saved} />
        </label>
        <ul id="pw-rules" className="auth-checks" aria-live="polite">
          <li className={longEnough ? 'is-met' : ''}>{longEnough ? '✓' : '○'} At least {MIN} characters</li>
          <li className={matches ? 'is-met' : ''}>{matches ? '✓' : '○'} Both boxes match</li>
        </ul>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {saved ? (
          <div className="auth-notice auth-saved" role="status">
            ✓ Password saved — {isParticipant ? 'opening your workbook' : 'signing you in'}…
          </div>
        ) : (
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        )}
      </form>
    </div>
  );
}

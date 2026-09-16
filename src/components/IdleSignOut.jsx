import { useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useIdleSignOut } from '../hooks/useIdleSignOut.js';
import '../styles/idle-signout.css';

// Set just before an inactivity sign-out: 'staff', or 'join:CODE' for a
// participant. The route guard reads it to pick the right sign-in page, and
// that page reads it once to say why.
const IDLE_FLAG = 'pst-signed-out-idle';
function readFlag() {
  try { return sessionStorage.getItem(IDLE_FLAG) || ''; } catch { return ''; }
}

// Where ProtectedRoute should send someone with no session. Only differs from
// /login for a participant signed out for inactivity: they sign in through
// their class's join link, and the staff page cannot sign them in.
export function signedOutPath() {
  const v = readFlag();
  return v.startsWith('join:') ? `/join/${v.slice(5)}` : '/login';
}

export function takeIdleNotice(page) {
  const v = readFlag();
  if (!(page === 'join' ? v.startsWith('join:') : v === page)) return false;
  try { sessionStorage.removeItem(IDLE_FLAG); } catch { /* fine */ }
  return true;
}

// Participants have no mailbox: they sign in as username@CODE.pstrainingres.local
// through their class's join link, and the staff page cannot sign them in. So
// an idle participant goes back to that link, not to /login.
function joinCodeOf(email) {
  const m = /@([a-z0-9]+)\.pstrainingres\.local$/i.exec(email || '');
  return m ? m[1].toUpperCase() : null;
}

// Mounted once, inside AuthProvider. Its own component rather than state in the
// provider, so the countdown ticking every second re-renders this warning and
// nothing else — not every page that reads useAuth().
//
// Quiz guests are left alone: they are anonymous accounts on a phone, deleted
// when the quiz ends, and a guest signed out mid-question has nobody to sign
// back in as.
export default function IdleSignOut() {
  const { session } = useAuth();
  const enabled = !!session && !session.user?.is_anonymous;

  const email = session?.user?.email;
  const signOut = useCallback(async () => {
    const code = joinCodeOf(email);
    try { sessionStorage.setItem(IDLE_FLAG, code ? `join:${code}` : 'staff'); } catch { /* the notice is a nicety */ }
    // 'local': this browser only. The default signs the person out on every
    // device, which would end a trainer's projector session because their
    // own laptop went quiet.
    await supabase.auth.signOut({ scope: 'local' });
  }, [email]);

  const { msLeft, stay } = useIdleSignOut({
    enabled,
    signedInAt: session?.user?.last_sign_in_at,
    onSignOut: signOut,
  });

  if (!enabled || msLeft == null) return null;

  const secs = Math.ceil(msLeft / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div className="idle-signout" role="alertdialog" aria-labelledby="idle-signout-title" aria-describedby="idle-signout-body">
      <div className="idle-signout-card">
        <h2 id="idle-signout-title">Still there?</h2>
        <p id="idle-signout-body">
          You have been inactive for a while. For security you will be signed out in{' '}
          <strong className="idle-signout-clock">{clock}</strong>.
        </p>
        <div className="idle-signout-actions">
          <button type="button" onClick={stay} autoFocus>Stay signed in</button>
          <button type="button" className="ghost" onClick={signOut}>Sign out now</button>
        </div>
      </div>
    </div>
  );
}

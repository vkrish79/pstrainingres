import { useCallback, useEffect, useRef, useState } from 'react';

// Signs a person out after an hour with no activity, with a warning first.
//
// "Activity" is anything a person does with the page: a key, a click, a tap,
// the wheel, moving the mouse. Watching a page is not activity — that is the
// point of the rule: a laptop left open in a training room should not stay
// signed in to someone's account.
//
// ACROSS TABS. The last activity is kept in localStorage, so working in one tab
// keeps every tab signed in, and no background tab signs out a person who is
// busy in another. Signing out clears the shared Supabase session, which the
// other tabs notice on their own.
//
// A LAPTOP THAT SLEPT. The check reads the stored time, not a running timer,
// so a lid closed for three hours signs out on waking rather than counting a
// fresh hour from when the timers resumed.
export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const IDLE_WARN_MS = 5 * 60 * 1000;
const KEY = 'pst-last-activity';
// Writing on every mousemove would hit storage hundreds of times a second. The
// cost of throttling is that another tab sees activity up to this late — so it
// is kept short, and a tab being hidden or closed writes at once.
const WRITE_EVERY_MS = 5 * 1000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'];

// For the verification harness only: a SHORTER limit, never a longer one, so
// it cannot be used to stay signed in past the hour.
function limitMs() {
  try {
    const v = Number(localStorage.getItem('pst-idle-test-limit-ms'));
    if (v > 0) return Math.min(v, IDLE_LIMIT_MS);
  } catch { /* storage blocked — use the real limit */ }
  return IDLE_LIMIT_MS;
}

function readLast() {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}
function writeLast(t) {
  try { localStorage.setItem(KEY, String(t)); } catch { /* private window — this tab still tracks it */ }
}

export function useIdleSignOut({ enabled, signedInAt, onSignOut }) {
  const [msLeft, setMsLeft] = useState(null);   // set only inside the warning window
  const localLast = useRef(0);
  const lastWrite = useRef(0);
  const signingOut = useRef(false);

  const touch = useCallback(() => {
    const now = Date.now();
    localLast.current = now;
    if (now - lastWrite.current >= WRITE_EVERY_MS) {
      lastWrite.current = now;
      writeLast(now);
    }
  }, []);

  // "Stay signed in" must count at once, not after the write throttle.
  const stay = useCallback(() => {
    const now = Date.now();
    localLast.current = now;
    lastWrite.current = now;
    writeLast(now);
    setMsLeft(null);
  }, []);

  useEffect(() => {
    if (!enabled) { setMsLeft(null); return undefined; }
    signingOut.current = false;

    // A sign-in is activity. Without this, a stored time from yesterday's
    // session would sign out someone who has just typed their password.
    const signIn = signedInAt ? new Date(signedInAt).getTime() : 0;
    if (signIn > readLast()) writeLast(signIn);

    const check = () => {
      if (signingOut.current) return;
      const last = Math.max(localLast.current, readLast());
      // Nothing recorded at all (storage blocked, first load): start now.
      if (!last) { stay(); return; }
      const left = limitMs() - (Date.now() - last);
      if (left <= 0) {
        signingOut.current = true;
        setMsLeft(null);
        onSignOut();
        return;
      }
      setMsLeft(left <= IDLE_WARN_MS ? left : null);
    };

    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true, capture: true });
    // Coming back to the tab is checked straight away, before any timer fires.
    const flush = () => { if (localLast.current > readLast()) writeLast(localLast.current); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); else flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisible);
    check();
    const t = setInterval(check, 1000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', flush);
      flush();
      clearInterval(t);
    };
  }, [enabled, signedInAt, onSignOut, touch, stay]);

  return { msLeft, stay };
}

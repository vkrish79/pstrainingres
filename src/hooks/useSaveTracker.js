import { useCallback, useEffect, useRef, useState } from 'react';

// "Is my work safe?" for an editor that saves as it goes.
//
// Editors here write each change the moment it is made — a title on blur, a
// block on its own Save, a move on click — and until this, nothing on screen
// said whether that write landed. A rename that RLS refused looked exactly
// like one that worked until the next reload put the old name back.
//
// track(key, label, fn) runs one save. `fn` follows the house convention: it
// resolves to `{ error }` on failure (a throw counts too) and anything else on
// success, and track hands that result straight back so callers that already
// check `res.error` keep working unchanged.
//
//   key    — what the save is OF ('title', `block:${id}`). A later save of the
//            same key that succeeds clears that key's failure: the newer value
//            is now the stored one, so the old failure no longer matters.
//   label  — how the chip names it: 'the title', 'a block in "EMD"'.
//   opts.retry — false for saves that must not be replayed as they were. A
//            move computed from an order that has since changed would put a
//            block somewhere nobody asked for; those offer a reload instead.
//
// Returns { pending, failures, savedAt, track }. A page passes the whole
// object to <SaveStatus>. While anything is in flight or has failed, closing
// or reloading the tab asks first (the router here cannot intercept in-app
// links, so this guards the tab, not every route change).
export function useSaveTracker() {
  const [pending, setPending] = useState(0);
  const [failures, setFailures] = useState([]);   // [{ key, label, message, retry|null }]
  const [savedAt, setSavedAt] = useState(null);
  const trackRef = useRef(null);

  const track = useCallback(async (key, label, fn, opts = {}) => {
    setPending(n => n + 1);
    let res;
    try {
      res = await fn();
    } catch (err) {
      res = { error: err };
    }
    setPending(n => n - 1);
    if (res?.error) {
      const message = res.error.message || String(res.error);
      const retry = opts.retry === false ? null : () => trackRef.current(key, label, fn, opts);
      setFailures(f => [...f.filter(x => x.key !== key), { key, label, message, retry }]);
    } else {
      setFailures(f => (f.some(x => x.key === key) ? f.filter(x => x.key !== key) : f));
      setSavedAt(Date.now());
    }
    return res;
  }, []);
  trackRef.current = track;

  const unsafe = pending > 0 || failures.length > 0;
  useEffect(() => {
    if (!unsafe) return undefined;
    const onLeave = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [unsafe]);

  return { pending, failures, savedAt, track };
}

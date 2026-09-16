import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Is a poll on the wall in this session right now?
//
// Used by BOTH surfaces — the participant's handset and the trainer's own Polls
// tab — because they are asking the same question and two hooks would drift.
// The trainer half is also what makes case 10 work: their laptop dies, they log
// back in, and the poll is still there, because it lives in the database rather
// than in the page they lost.
//
//
// WHY THIS POLLS INSTEAD OF SUBSCRIBING, which is not how the quiz does it.
//
// The quiz syncs sixteen screens by having them subscribe to one poll_runs-like
// row. A poll cannot copy that. Supabase realtime enforces RLS, so a
// participant could only subscribe to poll_runs if they were allowed to SELECT
// it — and `tally` is a COLUMN on that table. RLS is row-level, not
// column-level, so opening the row to let a subscription through would hand
// every participant the live counts and break the one promise the database is
// asked to keep.
//
// So the handset asks a function instead. poll_current() returns the wording,
// the answers and the caller's OWN vote, and there is no argument to it that
// produces a tally. Sixteen clients on one indexed lookup every two seconds is
// nothing, and by the time a trainer has said "have a look at your phones" it
// has arrived.
//
// Do not "optimise" this into a subscription.
const EVERY_MS = 2000;

export function useActivePoll(sessionId) {
  const [run, setRun] = useState(null);
  const [checked, setChecked] = useState(false);
  // A poll landing while an older reply is still in flight would otherwise be
  // overwritten by that reply — the handset would flicker back to "nothing on".
  const seq = useRef(0);
  // Server-minus-client, measured on every read. This laptop runs ~32s behind
  // the server, and a timed poll's deadline is a server time.
  const skewRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId) return null;
    const mine = ++seq.current;
    const { data } = await supabase.rpc('poll_current', { p_session_id: sessionId });
    if (mine !== seq.current) return null;
    const row = Array.isArray(data) ? data[0] ?? null : null;
    if (row?.server_now) skewRef.current = new Date(row.server_now).getTime() - Date.now();
    setRun(row);
    setChecked(true);
    return row;
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!sessionId) return undefined;
    const t = setInterval(refresh, EVERY_MS);
    return () => clearInterval(t);
  }, [sessionId, refresh]);

  // A timed poll re-renders five times a second so the ring sweeps rather than
  // jumping every two seconds with the refresh. Untimed polls do not tick.
  const [, force] = useState(0);
  const ticking = Boolean(run?.ends_at && run?.is_open);
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => force(n => n + 1), 200);
    return () => clearInterval(t);
  }, [ticking]);

  // null for a poll with no timer. At zero the poll reads as shut here at
  // once, rather than up to two seconds later when the server next says so —
  // poll_vote refuses from the same moment anyway.
  const secondsLeft = run?.ends_at
    ? Math.max(0, (new Date(run.ends_at).getTime() - (Date.now() + skewRef.current)) / 1000)
    : null;
  const shown = run && secondsLeft === 0 && run.is_open ? { ...run, is_open: false } : run;

  return { run: shown, checked, refresh, secondsLeft };
}

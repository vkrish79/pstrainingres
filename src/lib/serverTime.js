import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// What time the SERVER thinks it is.
//
// Assessment deadlines are stamped by the database (now() + N minutes), but
// every countdown in this app subtracted the BROWSER's clock — so the time
// shown was wrong by however far that machine had drifted. Measured on one
// developer machine: 26 seconds slow, which turned a 1-minute unlock into a
// countdown starting at 1:26.
//
// For the trainer that is cosmetic. For a PARTICIPANT it is not: a fast clock
// shows the assessment expiring while they can still answer, and a slow one
// shows time remaining after the server has stopped accepting writes. The real
// cutoff is enforced server-side, so nothing is lost or wrongly accepted — but
// the number on screen should agree with it.
//
// WHY AN RPC AND NOT THE Date RESPONSE HEADER, which would have needed no
// schema change: `Date` is not a CORS-safelisted response header. A browser
// only lets script read Cache-Control, Content-Language, Content-Type,
// Expires, Last-Modified and Pragma across origins, so headers.get('date')
// returns null and the measurement silently yields zero. That version looked
// like it worked and changed nothing.
//
// See supabase/migrations/20260915000000_server_now.sql.

let cachedOffset = null;   // ms to add to Date.now() to get server time
let inflight = null;

async function measure() {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('server_now');
  const t1 = Date.now();

  if (error || !data) return 0;
  const serverMs = new Date(data).getTime();
  if (!Number.isFinite(serverMs)) return 0;

  // The server answered somewhere inside the round trip; its midpoint is the
  // best single estimate of when. A round trip of even half a second leaves
  // this accurate to ~250ms, far finer than a timer measured in minutes needs.
  return serverMs - (t0 + t1) / 2;
}

// Server time, for code outside React.
export function serverNow() {
  return Date.now() + (cachedOffset ?? 0);
}

// The offset, measured once and shared. Returns 0 until the first measurement
// lands — which is the behaviour this replaced, so a countdown is never blank,
// it just becomes correct a moment later.
export function useServerOffset() {
  const [offset, setOffset] = useState(cachedOffset ?? 0);

  useEffect(() => {
    if (cachedOffset != null) { setOffset(cachedOffset); return undefined; }
    let alive = true;
    if (!inflight) {
      inflight = measure()
        .then(o => { cachedOffset = o; return o; })
        // A failed measurement — the function not yet created, or offline —
        // must not break a timer. Fall back to the browser clock, which is
        // what every countdown used before this existed.
        .catch(() => { cachedOffset = 0; return 0; })
        .finally(() => { inflight = null; });
    }
    inflight.then(o => { if (alive) setOffset(o); });
    return () => { alive = false; };
  }, []);

  return offset;
}

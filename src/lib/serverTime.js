import { useEffect, useState } from 'react';

// What time the SERVER thinks it is.
//
// Assessment deadlines are stamped by the database (now() + N minutes), but
// every countdown in this app subtracted the BROWSER's clock — so the time
// shown was wrong by however far that machine had drifted. Measured on one
// developer machine: 26 seconds slow, which turned a 1-minute unlock into a
// countdown starting at 1:26.
//
// For the trainer that is a cosmetic annoyance. For a PARTICIPANT it is not:
// a fast clock shows the assessment expiring while they can still answer, and
// a slow one shows time remaining after the server has stopped accepting
// writes. The real cutoff is enforced server-side, so nothing is lost or
// wrongly accepted — but the number on screen should agree with it.
//
// Measured once per page load from the Date header on a Supabase response,
// which is NTP-synced. One HEAD request, no schema change, and it works for
// anyone loading the page rather than only for whoever set the deadline.

let cachedOffset = null;   // ms to add to Date.now() to get server time
let inflight = null;

async function measure() {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base) return 0;

  const t0 = Date.now();
  // HEAD, so no body is transferred; the status does not matter, only the
  // Date header, which is present on every response.
  const res = await fetch(`${base}/rest/v1/`, {
    method: 'HEAD',
    headers: key ? { apikey: key } : undefined,
    cache: 'no-store',
  });
  const t1 = Date.now();

  const header = res.headers.get('date');
  if (!header) return 0;
  const serverMs = new Date(header).getTime();
  if (!Number.isFinite(serverMs)) return 0;

  // The header was generated somewhere inside the round trip; its midpoint is
  // the best single estimate of when. The Date header has one-second
  // resolution, so this is accurate to a fraction of a second — far finer than
  // a timer measured in minutes needs.
  return serverMs - (t0 + t1) / 2;
}

// Server time, for code outside React.
export function serverNow() {
  return Date.now() + (cachedOffset ?? 0);
}

// The offset, measured once and shared. Returns 0 until the first measurement
// lands, which is the same as today's behaviour — so a countdown is never
// blank, it just becomes correct a moment later.
export function useServerOffset() {
  const [offset, setOffset] = useState(cachedOffset ?? 0);

  useEffect(() => {
    if (cachedOffset != null) { setOffset(cachedOffset); return undefined; }
    let alive = true;
    if (!inflight) {
      inflight = measure()
        .then(o => { cachedOffset = o; return o; })
        // A failed measurement must not break a timer: fall back to the
        // browser clock, which is what every countdown used before this.
        .catch(() => { cachedOffset = 0; return 0; })
        .finally(() => { inflight = null; });
    }
    inflight.then(o => { if (alive) setOffset(o); });
    return () => { alive = false; };
  }, []);

  return offset;
}

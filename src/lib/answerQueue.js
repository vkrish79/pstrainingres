// Answers that have not reached the server yet, kept in this browser so a
// dropped connection, a reload or a closed tab does not cost anyone their work.
//
// One localStorage entry per (kind, session, person):
//   { [blockId]: { value, at } }   at = when it was typed, this laptop's clock
//
// An answer goes in the moment it is typed and comes out only when the server
// has confirmed THAT version (see drop: a newer edit queued while the old one
// was in flight stays put). Every access is wrapped: private windows and
// blocked storage throw, and the workbook must still work without a queue.

const PREFIX = 'pstr-pending-answers';
// Anything older than this is from a class long gone; never resend it.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function queueKey(kind, sessionId, userId) {
  if (!sessionId || !userId) return null;
  return `${PREFIX}:${kind}:${sessionId}:${userId}`;
}

export function readQueue(key) {
  if (!key) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    const out = {};
    for (const [id, e] of Object.entries(raw)) {
      if (e && typeof e.at === 'number' && now - e.at < MAX_AGE_MS) out[id] = e;
    }
    return out;
  } catch { return {}; }
}

function write(key, q) {
  try {
    if (Object.keys(q).length) localStorage.setItem(key, JSON.stringify(q));
    else localStorage.removeItem(key);
  } catch { /* storage unavailable: the in-memory retry still runs */ }
}

export function putQueued(key, blockId, value, at) {
  if (!key) return;
  const q = readQueue(key);
  q[blockId] = { value, at };
  write(key, q);
}

// Remove an answer once the server has it — but only the version that was
// sent. If the participant typed again while it was in flight, `at` differs
// and the newer one stays queued.
export function dropQueued(key, blockId, at) {
  if (!key) return;
  const q = readQueue(key);
  if (!q[blockId] || (at != null && q[blockId].at !== at)) return;
  delete q[blockId];
  write(key, q);
}

// The server's clock runs about half a minute ahead of a laptop's (measured
// 2026-09-10). Only a server row comfortably NEWER than the queued typing is
// treated as having replaced it, e.g. the same person on another laptop.
const NEWER_ELSEWHERE_MS = 2 * 60 * 1000;

// What to put back on screen after a load: queued answers the server does not
// already have. Answers the server has (same value) or has newer are dropped.
//   serverValues: { blockId: value }   serverAt: { blockId: iso }
export function restorable(key, serverValues, serverAt, validIds) {
  const q = readQueue(key);
  const out = {};
  for (const [id, e] of Object.entries(q)) {
    const gone = validIds && !validIds.has(id);
    const at = serverAt?.[id] ? new Date(serverAt[id]).getTime() : 0;
    const newerThere = at && at > e.at + NEWER_ELSEWHERE_MS;
    const same = JSON.stringify(serverValues?.[id] ?? null) === JSON.stringify(e.value ?? null);
    if (gone || newerThere || same) { dropQueued(key, id, e.at); continue; }
    out[id] = e.value;
  }
  return out;
}

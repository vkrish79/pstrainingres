// Why an answer did not save, sorted into what the participant can do about it.
//
// The page used to say "Save failed" for everything. That is wrong in both
// directions: a dropped connection is worth trying again, but a write the
// server REFUSED (the assessment closed, the session locked) will be refused
// every time, and a "Try again" button there is a promise that cannot be kept.
//
//   offline — the request never reached the server. Retry.
//   slow    — it reached the server and timed out or hit a 5xx. Retry.
//   refused — row-level security said no (42501). Do not offer a retry.
//   other   — anything else. Retry is harmless, so offer it.
export function classifySaveError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.code;
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return { kind: 'refused', retry: false };
  }
  if ((typeof navigator !== 'undefined' && navigator.onLine === false)
    || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return { kind: 'offline', retry: true };
  }
  if (code === '57014' || /timeout|timed out|statement canceled/i.test(msg)
    || (typeof err?.status === 'number' && err.status >= 500)) {
    return { kind: 'slow', retry: true };
  }
  return { kind: 'other', retry: true };
}

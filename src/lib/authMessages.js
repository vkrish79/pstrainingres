// Supabase Auth's own error text, in words a trainer can act on.
//
// Only the messages we can recognise are rewritten. Anything else is shown as
// it came: a rate limit or an unconfirmed email turned into "wrong password"
// would send someone off retyping a password that was right all along.
export function friendlySignInError(error) {
  const msg = error?.message || String(error || '');
  if (/invalid login credentials/i.test(msg)) {
    return "That email and password don't match. Check both, or reset your password.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return msg;
}

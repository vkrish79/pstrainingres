// Cryptographically-random temp password used for newly-created accounts
// (staff via StaffAdminPage, participants via add-session-participants).
// Character set excludes 0/O/1/I/l to avoid transcription errors when
// trainers read the password aloud or copy from email.
export function generateTempPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

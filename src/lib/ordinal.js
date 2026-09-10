// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 21 -> "21st".
//
// In a .js lib rather than inline in the component so it can actually be
// tested — the teens are the case everyone gets wrong, and an inline
// expression in JSX is a place bugs go to live undisturbed.
export function ordinal(n) {
  if (!Number.isFinite(n) || n < 1) return '';
  const abs = Math.floor(Math.abs(n));
  const lastTwo = abs % 100;
  // 11th, 12th, 13th — not 11st, 12nd, 13rd.
  if (lastTwo >= 11 && lastTwo <= 13) return `${abs}th`;
  switch (abs % 10) {
    case 1: return `${abs}st`;
    case 2: return `${abs}nd`;
    case 3: return `${abs}rd`;
    default: return `${abs}th`;
  }
}

// How a session's dates read, in one place.
//
// There were seven copies of a formatDateRange in this codebase and they did
// not agree. The one on the session page rendered a ONE-DAY session as
// "Sep 9, 2026 → Sep 9, 2026" — the same date twice, with an arrow between it
// and itself. This is the version the list and calendar already used.
//
// Two rules, both about not repeating what the reader can already see:
//   * start == end is a single date, not a range of one day
//   * a range inside one month names the month once: "09–11 Sep 2026", not
//     "09 Sep 2026 – 11 Sep 2026"
export function formatRange(start, end) {
  if (!start && !end) return '';
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const day = d => String(d.getDate()).padStart(2, '0');
  const monthYear = d => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const full = d => `${day(d)} ${monthYear(d)}`;

  if (s && e) {
    if (sameDay(s, e)) return full(s);
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
      return `${day(s)}–${day(e)} ${monthYear(s)}`;
    }
    return `${full(s)} – ${full(e)}`;
  }
  return s ? `From ${full(s)}` : `Until ${full(e)}`;
}

// Compared by calendar day, not by timestamp: starts_at and ends_at are
// timestamptz, so a one-day session stored with different times of day would
// otherwise print as a range.
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// A timestamptz → the yyyy-mm-dd an <input type="date"> wants.
//
// LOCAL date parts, deliberately, NOT toISOString().slice(0, 10). The stored
// value is a timestamptz at midnight, and formatRange above renders it with
// local getters — so a session shown as "09 Sept" must load into the editor as
// 09 Sept. Going via toISOString converts to UTC first, which west of Greenwich
// hands back the 8th: the trainer opens the editor, changes nothing, saves, and
// the session has silently moved a day earlier. Invisible until it happens to
// somebody in the wrong timezone.
export function toDateInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

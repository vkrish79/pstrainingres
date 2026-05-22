// Column -> section matching for the workbook prep repository upload.
// A spreadsheet column header maps to a workbook section (exercise) by exact
// case-insensitive title first, else by leading number ("1", "Ex 1",
// "Exercise 1" all map to a section whose title contains the same number).
// Lifted from the old session-level UploadPrepData so the workbook-level
// upload reuses the same convention.

// Headers we silently ignore — common "who is this row about" columns people
// add for legibility. (Kits are anonymous, so a name column is never prep.)
export const IGNORED_HEADERS = new Set([
  'name', 'full name', 'fullname', 'full_name',
  'participant', 'participant name', 'student',
  'username', 'email', 'id', '#', 'no', 'no.', 'sno', 's.no',
  'row', 'index', 'kit', 'kit #', 'kit no',
]);

export function matchSection(header, sections) {
  const h = String(header || '').toLowerCase().trim();
  if (!h) return null;
  if (IGNORED_HEADERS.has(h)) return null;
  const exact = sections.find(s => (s.title || '').toLowerCase().trim() === h);
  if (exact) return exact;
  const hNum = h.match(/\d+/);
  if (!hNum) return null;
  return sections.find(s => {
    const sNum = (s.title || '').toLowerCase().match(/\d+/);
    return sNum && sNum[0] === hNum[0];
  }) || null;
}

// Tiny CSV helpers. Format kept deliberately simple: no quoted fields,
// no escaping, no embedded newlines — usernames/names don't need them.

export const PARTICIPANT_CSV_HEADER = ['username', 'full_name'];

export function buildParticipantCsvTemplate() {
  const lines = [
    PARTICIPANT_CSV_HEADER.join(','),
    'jane.doe,Jane Doe',
    'john.smith,John Smith',
    'alice,',
  ];
  return lines.join('\r\n') + '\r\n';
}

export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseParticipantCsv(text) {
  const rows = [];
  const errors = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { rows, errors: ['File is empty.'] };

  const header = lines[0].split(',').map(c => c.trim().toLowerCase());
  const usernameIdx = header.indexOf('username');
  const nameIdx = header.indexOf('full_name');
  if (usernameIdx === -1) {
    return { rows, errors: ['CSV must have a "username" column in the header row.'] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    const username = cells[usernameIdx] || '';
    if (!username) {
      errors.push(`Row ${i + 1}: missing username.`);
      continue;
    }
    rows.push({
      username,
      full_name: nameIdx !== -1 ? (cells[nameIdx] || '') : '',
    });
  }
  return { rows, errors };
}

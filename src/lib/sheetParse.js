// Sheet parser. Accepts a File (.xlsx / .csv) and returns rows-of-cells.
// .xlsx parsing uses read-excel-file, lazy-loaded so it stays out of the
// main bundle. .csv parsing is a small RFC-4180-ish implementation that
// handles quoted cells, doubled-quote escapes, and embedded newlines —
// enough for prep data which may contain commas or paragraph breaks.

export async function parseSheetFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    // The package only exports subpaths; use the browser build explicitly.
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const rows = await readXlsxFile(file);
    return normalizeRows(rows);
  }
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text();
    return normalizeRows(parseCsv(text));
  }
  throw new Error('Unsupported file type. Upload an .xlsx or .csv file.');
}

// Drop leading/trailing wholly-empty rows + cells; coerce to strings.
function normalizeRows(rows) {
  const cleaned = rows
    .map(r => r.map(c => (c == null ? '' : String(c).trim())))
    .filter(r => r.some(c => c !== ''));
  return cleaned;
}

export function parseCsv(text) {
  const rows = [];
  let cur = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { cur.push(cell); cell = ''; }
      else if (c === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; }
      else if (c === '\r') { /* swallow; \n handles row break */ }
      else { cell += c; }
    }
  }
  if (cell !== '' || cur.length > 0) { cur.push(cell); rows.push(cur); }
  return rows;
}

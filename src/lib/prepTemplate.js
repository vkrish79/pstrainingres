// Builds the blank prep template a trainer downloads, fills, and re-uploads.
// One column per workbook exercise (section); one kit per row. The trainer
// fills only the columns that need prep — empty columns are ignored on upload.

import { downloadCsv } from './csv.js';

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `sections` is the master workbook's sections (ordered). Returns CSV text with
// the section titles as the header row plus a few blank rows to fill.
export function buildPrepTemplateCsv(sections, blankRows = 3) {
  const header = sections.map(s => csvCell(s.title)).join(',');
  const blank = sections.map(() => '').join(',');
  const lines = [header, ...Array.from({ length: blankRows }, () => blank)];
  return lines.join('\r\n') + '\r\n';
}

export function downloadPrepTemplate(workbookTitle, sections) {
  const safe = (workbookTitle || 'workbook').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  downloadCsv(`${safe || 'workbook'}_prep_template.csv`, buildPrepTemplateCsv(sections));
}

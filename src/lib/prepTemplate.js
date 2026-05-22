// Builds the empty prep template a trainer downloads and fills in the Prep tab.
// Columns come from the workbook's stored prep_template structure (set up by a
// super trainer), NOT from every exercise.

import { downloadCsv } from './csv.js';

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `columns` is the workbook's prep_template: [{ section_id, header }].
// Returns CSV with the headers as row 1 plus blank rows to fill (one kit/row).
export function buildEmptyPrepTemplateCsv(columns, blankRows = 5) {
  const header = columns.map(c => csvCell(c.header)).join(',');
  const blank = columns.map(() => '').join(',');
  const lines = [header, ...Array.from({ length: blankRows }, () => blank)];
  return lines.join('\r\n') + '\r\n';
}

export function downloadEmptyPrepTemplate(workbookTitle, columns) {
  const safe = (workbookTitle || 'workbook')
    .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  downloadCsv(`${safe || 'workbook'}_prep_template.csv`, buildEmptyPrepTemplateCsv(columns));
}

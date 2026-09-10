// Spreadsheet paste, parsed once.
//
// Copying a block of cells out of Excel puts tab-separated columns and
// newline-separated rows on the clipboard. Two places in this app fill a grid
// from that — PrepPasteGrid when a trainer enters a fresh kit, and the replace-
// prep modal on the session dashboard — and both had (or were about to have)
// their own copy of the split.
//
// Pure and dependency-free so `node` can exercise it. The edge cases are all
// invisible until they bite: a trailing newline from a selection that includes
// the row below, \r\n from Windows Excel, and a single value with no separators
// at all, which must NOT be treated as a matrix or every ordinary keystroke-
// paste into one cell would be intercepted.

// Is this clipboard text a multi-cell block, or just one value?
// A single value is left to the input's own paste handling.
export function isMatrixPaste(text) {
  return /[\t\n]/.test(text || '');
}

// Clipboard text → array of rows, each an array of trimmed cells.
// Returns [] for empty input.
export function parseClipboardMatrix(text) {
  const raw = (text || '').replace(/\r/g, '');
  // Only the TRAILING blank lines go. A blank line in the middle is a row the
  // user left empty on purpose, and in the replace-prep grid that is load
  // bearing: it means "keep this participant's current value".
  const trimmed = raw.replace(/\n+$/, '');
  if (!trimmed) return [];
  return trimmed.split('\n').map(line => line.split('\t').map(cell => cell.trim()));
}

// Write a pasted matrix into a fixed-size grid, starting at (row, col).
//
// FIXED SIZE, AND THAT IS THE POINT. PrepPasteGrid grows its rows to fit
// whatever arrives; the replace-prep grid cannot, because it has exactly one
// row per participant. Anything past the last row is dropped — so this reports
// how much, rather than discarding it in silence. Pasting six values over four
// participants is a mistake worth being told about, and it is the kind that is
// only noticed at marking time.
//
// `rows` is not mutated. Returns { rows, dropped }.
export function applyMatrix(rows, matrix, startRow = 0, startCol = 0) {
  const next = rows.map(r => [...r]);
  const height = next.length;
  const width = height ? next[0].length : 0;
  let dropped = 0;

  for (let i = 0; i < matrix.length; i++) {
    const r = startRow + i;
    if (r >= height) { dropped++; continue; }
    for (let j = 0; j < matrix[i].length; j++) {
      const c = startCol + j;
      if (c >= width) continue;   // narrower grid than the paste: ignore extra columns
      next[r][c] = matrix[i][j];
    }
  }

  return { rows: next, dropped };
}

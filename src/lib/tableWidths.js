// How wide each table cell is, in grid columns, and the edits that change it.
//
// Word lays a form out on an invisible grid and each cell covers some of its
// columns (colSpan). Imports keep those spans, but a row can come in a column
// wider or narrower than the rest — "Expiry | 1130 | CVV | 123" adding up to 9
// on an 8-column table pushes "123" past the right edge. The trainer fixes it
// with ◀ ▶ on a cell (one column at a time), Fit, or Even widths, in the
// import review and in the table editor.
//
// Only colSpan changes. Cell ids — what answers are keyed by — never do.
//
// A table a trainer has resized carries config.grid = true and is drawn with
// each grid column asking for an equal share, so the column counts they set
// are what participants see. Every other table keeps the browser's own sizing:
// Word's grid columns are not equal (a one-column "Base fare" label is wide in
// Word), and forcing equal shares on tables nobody touched made labels wrap.

// Where each cell really sits once colSpan / rowSpan are laid out, and which
// cell covers each grid slot. Word layouts lean on merged cells heavily (the
// ARD Web workbook's grids are 12–18 columns wide), so "the first cell in the
// row" is not the same as "the first column".
export function tableGrid(rows) {
  const occ = [];
  const pos = rows.map(() => []);
  rows.forEach((row, ri) => {
    occ[ri] = occ[ri] || [];
    let col = 0;
    row.forEach((cell, ci) => {
      while (occ[ri][col]) col += 1;
      pos[ri][ci] = col;
      const cs = spanOf(cell);
      const rs = cell?.rowSpan > 1 ? cell.rowSpan : 1;
      for (let dr = 0; dr < rs; dr++) {
        occ[ri + dr] = occ[ri + dr] || [];
        for (let dc = 0; dc < cs; dc++) occ[ri + dr][col + dc] = { ri, ci };
      }
      col += cs;
    });
  });
  return { pos, occ };
}

export const spanOf = cell => (cell?.colSpan > 1 ? cell.colSpan : 1);

// Columns each row reaches (a cell merged down from above counts for the rows
// it covers). Rows with no cells of their own read 0.
export function rowWidths(rows) {
  const { occ } = tableGrid(rows);
  return rows.map((row, ri) => (row.length ? (occ[ri] || []).length : 0));
}

// The table's width: the one MOST rows share, not the widest. In the ARD Web
// workbook one row often pokes a column past thirty others, and that one should
// come in, not the thirty go out. Ties go to the wider.
export function tableEdge(rows) {
  const tally = {};
  for (const w of rowWidths(rows)) if (w) tally[w] = (tally[w] || 0) + 1;
  const keys = Object.keys(tally);
  if (!keys.length) return 0;
  return Number(keys.sort((a, b) => tally[b] - tally[a] || b - a)[0]);
}

// Grid columns to draw: wide enough for the widest row, so a row that pokes out
// is seen poking out.
export function gridWidth(rows) {
  return Math.max(0, ...rowWidths(rows));
}

// A table laid out on Word's grid — the only kind whose columns mean anything.
// Hand-made tables without merges keep the browser's own column sizing.
export function hasSpans(rows) {
  return (rows || []).some(row => row.some(c => c?.colSpan > 1 || c?.rowSpan > 1));
}

// Per row: columns past the edge (+) or short of it (−); 0 when it fits or is
// empty.
export function rowMisfits(rows, edge = tableEdge(rows)) {
  return rowWidths(rows).map(w => (w ? w - edge : 0));
}

// A row is safe to resize freely when every slot it reaches belongs to its own
// cells and none of them reaches down into the next row — otherwise a change
// here moves another row too.
function ownsRow(rows, occ, ri) {
  const slots = occ[ri] || [];
  return slots.every(s => s && s.ri === ri) && rows[ri].every(c => !(c?.rowSpan > 1));
}

const withSpan = (cell, span) => {
  const { colSpan: _c, ...rest } = cell;
  return span > 1 ? { ...rest, colSpan: span } : rest;
};

function replaceRow(rows, ri, row) {
  return rows.map((r, i) => (i === ri ? row : r));
}

// One cell covers `span` columns. Nothing else moves.
export function setCellSpan(rows, ri, ci, span) {
  const s = Math.max(1, Math.min(48, Math.round(span)));
  return replaceRow(rows, ri, rows[ri].map((c, i) => (i === ci ? withSpan(c, s) : c)));
}

// Fit: a row that is too wide gives up columns from its widest cell, one at a
// time; a row that is short stretches its last cell to the edge. Returns the
// rows unchanged when the row cannot be fitted without moving another row.
export function fitRow(rows, ri, edge = tableEdge(rows)) {
  const { occ } = tableGrid(rows);
  const used = (occ[ri] || []).length;
  if (!rows[ri]?.length || used === edge) return rows;
  if (used > edge) {
    const spans = rows[ri].map(spanOf);
    let over = used - edge;
    while (over > 0) {
      let w = -1;
      spans.forEach((s, i) => { if (s > 1 && !(rows[ri][i]?.rowSpan > 1) && (w < 0 || s > spans[w])) w = i; });
      if (w < 0) break;
      spans[w] -= 1; over -= 1;
    }
    if (over > 0) return rows;
    return replaceRow(rows, ri, rows[ri].map((c, i) => withSpan(c, spans[i])));
  }
  // Short: only when the row's last slot is its own last cell.
  const owner = occ[ri][used - 1];
  if (!owner || owner.ri !== ri || owner.ci !== rows[ri].length - 1) return rows;
  const last = rows[ri][owner.ci];
  return setCellSpan(rows, ri, owner.ci, spanOf(last) + (edge - used));
}

// Even widths: the edge shared across the row's cells as evenly as whole
// columns allow (leftover columns go to the first cells).
export function evenRow(rows, ri, edge = tableEdge(rows)) {
  const { occ } = tableGrid(rows);
  const row = rows[ri];
  if (!row?.length || !ownsRow(rows, occ, ri) || row.length > edge) return rows;
  const base = Math.floor(edge / row.length);
  let extra = edge - base * row.length;
  return replaceRow(rows, ri, row.map(c => withSpan(c, base + (extra-- > 0 ? 1 : 0))));
}

export const canFit = (rows, ri, edge = tableEdge(rows)) => fitRow(rows, ri, edge) !== rows;
export const canEven = (rows, ri, edge = tableEdge(rows)) => rows[ri]?.length > 1 && evenRow(rows, ri, edge) !== rows;

export function fitAllRows(rows, edge = tableEdge(rows)) {
  return rows.reduce((acc, _r, ri) => fitRow(acc, ri, edge), rows);
}

// A row holding a single cell is a full-width line (a heading, a spacer, an
// instruction) whatever span Word happened to give it — set it to the edge so
// it never sticks out or stops short. Only rows that own all their slots.
export function lineUpLoneRows(rows, edge = tableEdge(rows)) {
  if (!edge) return rows;
  const { occ } = tableGrid(rows);
  let out = rows;
  rows.forEach((row, ri) => {
    if (row.length !== 1 || !ownsRow(rows, occ, ri) || spanOf(row[0]) === edge) return;
    out = replaceRow(out, ri, [withSpan(row[0], edge)]);
  });
  return out;
}

// What the participant's table draws: lone rows lined up (tables imported
// before this existed still carry Word's odd spans), and the number of
// equal-share grid columns for a resized table, else 0 (browser sizing).
export function displayLayout(rows, { grid = false } = {}) {
  if (!hasSpans(rows)) return { rows, cols: 0 };
  const lined = lineUpLoneRows(rows);
  return { rows: lined, cols: grid ? gridWidth(lined) : 0 };
}

// ── the header row ─────────────────────────────────────────────────────
// A table's first row can be its column headings: config.headers holds their
// wording (plain strings, as every consumer reads them) and config.headerSpans
// their widths, one per heading, absent when every heading covers one column.
// For widths the header is simply row 0 of the same grid, so ◀ ▶, Fit, Even
// widths and the table's edge treat it like any other row.

// The rows with the header (if any) on top as static cells; `off` is 1 when
// it is there, so body row r is rows[r + off].
export function withHeaderRow(cfg) {
  const rows = cfg?.rows || [];
  const headers = Array.isArray(cfg?.headers) && cfg.headers.length ? cfg.headers : null;
  if (!headers) return { all: rows, off: 0 };
  const spans = Array.isArray(cfg.headerSpans) ? cfg.headerSpans : [];
  const hdr = headers.map((t, i) => (spans[i] > 1 ? { kind: 'static', text: t ?? '', colSpan: spans[i] } : { kind: 'static', text: t ?? '' }));
  return { all: [hdr, ...rows], off: 1 };
}

// The config with `all` (from withHeaderRow) split back: header widths into
// headerSpans, the rest into rows. Heading wording is left as it was.
export function applyHeaderRow(cfg, all) {
  const { off } = withHeaderRow(cfg);
  if (!off) return { ...cfg, rows: all };
  const spans = all[0].map(spanOf);
  const { headerSpans: _old, ...rest } = cfg;
  return spans.some(s => s > 1) ? { ...rest, rows: all.slice(1), headerSpans: spans } : { ...rest, rows: all.slice(1) };
}

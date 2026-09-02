// Shared row model for the two kit grids (PrepGrid read view, PrepEditGrid bulk
// editor). Both must agree on ORDER: the edit grid fills a paste down the rows
// as rendered, so the array it renders and the array it indexes have to be the
// same one — deriving them separately is how values land on the wrong kits.

export const STATUS_ORDER = ['available', 'allocated', 'used'];

export const GROUP_LABEL = {
  available: '🟢 In the pool — not yet drawn',
  allocated: '🟠 Allocated — class in progress',
  used: '🔴 Class closed — spent',
};

export const STATUS_CLASS = { available: 'pg-pool', allocated: 'pg-alloc', used: 'pg-spent' };

// Spent kits are read-only: close-session has already snapshotted their prep, so
// editing one would desync the archive.
export function isEditableStatus(status) {
  return status === 'available' || status === 'allocated';
}

// Flat, render-ordered rows: grouped by status, kit_index within each group.
// `firstOfGroup` drives the divider row so the caller doesn't re-group.
export function buildKitRows(kits = []) {
  const rows = [];
  for (const status of STATUS_ORDER) {
    const inGroup = kits.filter(k => k.status === status).sort((a, b) => a.kit_index - b.kit_index);
    inGroup.forEach((kit, i) => {
      rows.push({ kit, status, editable: isEditableStatus(status), firstOfGroup: i === 0 });
    });
  }
  return rows;
}

// Column order: the parent's prep_template, else the union of payload keys.
export function buildKitColumns(structure = [], kits = []) {
  if (structure.length) return structure.map(c => c.header);
  const seen = new Set();
  for (const k of kits) for (const key of Object.keys(k.payload || {})) seen.add(key);
  return [...seen];
}

// Row heading: "Kit #3" while in the pool, the participant's name once drawn.
export function kitRowLabel(k, participantsById = {}, sessionsById = {}) {
  if (k.status === 'available') return { main: `Kit #${k.kit_index}`, sub: null };
  // used with no session = a manual trainer withdrawal (not a closed class)
  if (k.status === 'used' && !k.consumed_session_id) return { main: `Kit #${k.kit_index}`, sub: 'withdrawn' };
  const p = k.consumed_participant_id ? participantsById[k.consumed_participant_id] : null;
  const s = k.consumed_session_id ? sessionsById[k.consumed_session_id] : null;
  const main = p?.full_name || s?.name || `Kit #${k.kit_index}`;
  const sub = p?.full_name && s?.name ? s.name : (p?.full_name && s?.join_code ? s.join_code : null);
  return { main, sub };
}

// Spreadsheet fill for the bulk edit sheet, kept pure so it can be reasoned
// about (and tested) apart from React. `matrix` is the pasted block (rows of
// cells). Values walk DOWN `rows` in render order, consuming only editable ones:
// spent kits are read-only, so they are stepped over rather than silently
// swallowing a value. Nothing past the last row is written — the kit set is
// fixed, so a paste can never invent kits.
//
// Returns { next, used } — `used` is how many pasted rows landed, so the caller
// can report the overflow instead of losing values quietly.
export function fillDown(draft, rows, startRow, startCol, matrix, columnCount) {
  const next = draft.map(row => [...row]);
  let ri = startRow;
  let used = 0;
  for (const line of matrix) {
    while (ri < rows.length && !rows[ri].editable) ri++;
    if (ri >= rows.length) break;
    for (let j = 0; j < line.length && startCol + j < columnCount; j++) {
      next[ri][startCol + j] = String(line[j] ?? '').trim();
    }
    ri++; used++;
  }
  return { next, used };
}

// Normalised rectangle from a selection anchor/focus pair (render-row indices).
export function selectionRect(sel) {
  if (!sel) return null;
  return {
    top: Math.min(sel.anchorRow, sel.focusRow),
    bottom: Math.max(sel.anchorRow, sel.focusRow),
    left: Math.min(sel.anchorCol, sel.focusCol),
    right: Math.max(sel.anchorCol, sel.focusCol),
  };
}

// Clear every EDITABLE cell in the rectangle. Spent rows inside the selection are
// stepped over — Excel highlights the whole dragged block, but a spent kit's prep
// is already snapshotted and must not change. Pure, so the two traversals
// (highlight vs write) can't drift.
export function clearRange(draft, rows, rect, columnCount) {
  if (!rect) return draft;
  const next = draft.map(row => [...row]);
  for (let r = Math.max(0, rect.top); r <= Math.min(rect.bottom, rows.length - 1); r++) {
    if (!rows[r]?.editable) continue;
    for (let c = Math.max(0, rect.left); c <= Math.min(rect.right, columnCount - 1); c++) {
      next[r][c] = '';
    }
  }
  return next;
}

// Selection -> TSV, the shape Excel expects on the clipboard. Includes spent rows:
// copying is read-only, so what you see is what you get.
export function rangeToTsv(draft, rect, columnCount) {
  if (!rect) return '';
  const lines = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const cells = [];
    for (let c = rect.left; c <= Math.min(rect.right, columnCount - 1); c++) {
      cells.push(draft[r]?.[c] ?? '');
    }
    lines.push(cells.join(String.fromCharCode(9)));
  }
  return lines.join(String.fromCharCode(10));
}

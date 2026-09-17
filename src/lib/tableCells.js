// Table cells that mix wording and answer boxes.
//
// A table cell is one of:
//   { kind: 'static', text }                        wording only
//   { kind: 'input', id, input_type }               one answer box, nothing else
//   { kind: 'mixed', parts: [...] }                 wording with boxes inside it
//       parts: { kind: 'text', text } | { kind: 'box', id, input_type }
//
// Word forms put a content control ("Click or tap here to enter text.") where
// the answer goes, often after a label ("City code: …") or mid-sentence
// ("REFUND AMOUNT … ADVISED / GUEST AGREED"), sometimes twice in one cell. Only
// a cell holding nothing but the placeholder used to become a box; the rest were
// imported as plain text nobody could type into. This module turns them into
// mixed cells — on import, and as a repair for content already saved.
//
// Answers stay keyed by box id, exactly like input cells, so progress, marking,
// answer keys and exports work unchanged through inputCellsOf().

// Word's placeholder, anywhere in the text. Zero-width characters sometimes sit
// in front of it and would otherwise defeat a whole-cell match.
// Newer Word says "Click or tap here to enter text."; older Word "Click here…".
const PLACEHOLDER_RE = /click (?:or tap )?(?:here )?to enter (?:text|a date)\.?/gi;
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
// How a trainer writes a box when editing the wording — the same marker the
// fill-in-the-blank question uses.
export const BOX_MARKER = '{{}}';
const BOX_RE = /\{\{\s*\}\}/g;

export function hasPlaceholder(text) {
  PLACEHOLDER_RE.lastIndex = 0;
  return typeof text === 'string' && PLACEHOLDER_RE.test(text);
}

// Split text at a marker into text + box parts. Box ids come from prevBoxes in
// order (so editing the wording keeps answers attached), then from makeId.
function splitAt(text, re, prevBoxes, makeId) {
  const parts = [];
  let last = 0, n = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    const prev = prevBoxes[n];
    parts.push({ kind: 'box', id: prev?.id || makeId(), input_type: prev?.input_type || 'short_text' });
    n += 1;
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

function keepSpans(from, to) {
  if (from?.colSpan > 1) to.colSpan = from.colSpan;
  if (from?.rowSpan > 1) to.rowSpan = from.rowSpan;
  return to;
}

// The cell a piece of Word text should become, or null if it has no placeholder.
// Nothing but the placeholder → a plain input cell; otherwise a mixed cell.
export function cellFromPlaceholderText(text, makeId) {
  if (!hasPlaceholder(text)) return null;
  const clean = text.replace(INVISIBLE_RE, '');
  PLACEHOLDER_RE.lastIndex = 0;
  const rest = clean.replace(PLACEHOLDER_RE, '').trim();
  const boxes = clean.match(PLACEHOLDER_RE).length;
  if (!rest && boxes === 1) return { kind: 'input', id: makeId(), input_type: 'short_text' };
  return { kind: 'mixed', parts: tidyParts(splitAt(clean, PLACEHOLDER_RE, [], makeId)) };
}

// Word runs label and placeholder together ("Currency code (Local):Click…") —
// give each box a space either side so the sentence reads, and drop empty text.
function tidyParts(parts) {
  return parts
    .map((p, i) => {
      if (p.kind !== 'text') return p;
      let t = p.text;
      if (i > 0 && parts[i - 1].kind === 'box' && !/^\s/.test(t)) t = ' ' + t;
      if (i < parts.length - 1 && parts[i + 1].kind === 'box' && !/\s$/.test(t)) t = t + ' ';
      return { kind: 'text', text: t };
    })
    .filter(p => p.kind === 'box' || p.text.trim());
}

export function boxesOf(cell) {
  if (cell?.kind !== 'mixed') return [];
  return (cell.parts || []).filter(p => p?.kind === 'box');
}

// The wording of a mixed cell with {{}} where each box sits — what the editor shows.
export function mixedToText(cell) {
  return (cell?.parts || []).map(p => (p.kind === 'box' ? BOX_MARKER : p.text || '')).join('');
}

// The wording alone, boxes left out — for labels and summaries.
export function mixedWording(cell) {
  return (cell?.parts || []).filter(p => p.kind === 'text').map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
}

// Rebuild a mixed cell from edited wording, keeping box ids in order.
export function mixedFromText(text, prevCell, makeId) {
  return keepSpans(prevCell, { kind: 'mixed', parts: splitAt(text, BOX_RE, boxesOf(prevCell), makeId) });
}

// A label for a box: the wording just before it, without trailing separators
// ("City code:" → "City code"). Too short to mean anything ("M /" → "M") falls
// back to the text after it, then to the caller's fallback.
export function boxLabel(cell, boxIndex, fallback) {
  const parts = cell?.parts || [];
  let seen = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind !== 'box') continue;
    seen += 1;
    if (seen !== boxIndex) continue;
    const clip = s => (s || '').replace(/\s+/g, ' ').replace(/^[\s:/\-–—|]+|[\s:/\-–—|]+$/g, '').trim();
    const before = parts[i - 1]?.kind === 'text' ? clip(parts[i - 1].text) : '';
    if (before.length >= 3) return before;
    const after = parts[i + 1]?.kind === 'text' ? clip(parts[i + 1].text) : '';
    if (after.length >= 3) return before ? `${before} … ${after}` : after;
    if (before && fallback && fallback !== before) return `${fallback} (${before})`;
    return before || fallback;
  }
  return fallback;
}

// Cells in a table that still show Word's placeholder as plain text, and what
// each would become. `config` is a table block's config.
export function placeholderFixes(config, makeId) {
  const fixes = [];
  (config?.rows || []).forEach((row, ri) => (row || []).forEach((cell, ci) => {
    if (cell?.kind !== 'static' || !hasPlaceholder(cell.text)) return;
    const next = cellFromPlaceholderText(cell.text, makeId);
    fixes.push({ row: ri, col: ci, before: cell.text, after: keepSpans(cell, next) });
  }));
  return fixes;
}

// The config with the chosen fixes applied. Existing ids are never touched.
export function applyPlaceholderFixes(config, fixes) {
  const rows = (config?.rows || []).map(row => [...row]);
  for (const f of fixes) if (rows[f.row]?.[f.col]) rows[f.row][f.col] = f.after;
  return { ...config, rows };
}

// Unique enough within a block and across a session copy; answers key off it.
export function newBoxId() {
  return `bx_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e8).toString(36)}`;
}

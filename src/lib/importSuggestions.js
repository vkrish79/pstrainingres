// The review step of a Word import: what the parser was not sure about, and the
// edits a trainer makes before Create.
//
// Trainers write answer areas the way Word makes easy — an empty table cell
// beside a label ("Base Fare | ", "Write your PNR | "), an empty Date column in
// an itinerary, a typed underline ("REFUNDABLE AMOUNT OF _______"), a run of
// a) b) c) questions. The parser only turns Word's own "Click or tap here"
// boxes and [SHORT:…]-style markers into answer boxes, so all of those used to
// arrive as plain text with nowhere to type, and were fixed cell by cell in the
// editor after Create.
//
// Here they become SUGGESTIONS: flagged on a working copy of the parse, drawn
// dashed in the review, and applied only when the trainer says yes. Nothing in
// this file touches the database — finishReview() hands back a parse of exactly
// the shape parseDocxToWorkbook returns, so Create saves it as before.
//
// Working-copy flags (all stripped by finishReview):
//   section._rid, block._rid   stable ids while blocks are added and replaced
//   cell._sug                  empty cell suggested as an answer box
//   cell._sugLine              cell wording with a typed underline to box
//   cell._sugWiden = n         last cell of a row that stops n columns short
//                              of the table's right edge
//   block._subq                prose run that reads as questions with no answer
//                              box; blocks in one run share the run id

import { newBoxId } from './tableCells.js';
import { emptyPnrScenario } from './pnrQuestion.js';

let ridSeq = 0;
const nextRid = () => `r${++ridSeq}`;

// Front matter the hierarchy parser bundles before the first heading. Its
// tables are document information and sign-in details, never answers.
const FRONT_MATTER = new Set(['cover', 'document information']);

const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF\u00A0]/g;
const UNDERLINE_RE = /_{3,}/g;
// "a) …", "(b) …", "c. …", "ii) …" — a lettered sub-question line.
const LETTERED_RE = /^\s*\(?([a-h]|i{1,3}|iv|v|vi{0,3})[).]\s+\S/i;
const LETTER_PREFIX_RE = /^\s*\(?([a-h]|i{1,3}|iv|v|vi{0,3})[).]\s+/i;

const cellText = (cell) => (cell?.text || '').replace(INVISIBLE_RE, ' ').trim();

// ── preparing the working copy ─────────────────────────────────────────

// A copy of the parse with review ids and every suggestion flagged.
export function prepareReview(parsed, { kind = 'workbook' } = {}) {
  const sections = (parsed.sections || []).map((sec) => {
    const front = sec.kind === 'group' && FRONT_MATTER.has((sec.title || '').trim().toLowerCase());
    const blocks = sec.blocks.map(b => ({ ...b, _rid: nextRid(), config: copyConfig(b) }));
    if (!front) {
      for (const b of blocks) if (b.block_type === 'table') flagTable(b.config);
      flagSubQuestions(blocks);
    }
    return { ...sec, _rid: nextRid(), blocks };
  });
  return { ...parsed, sections, _kind: kind };
}

function copyConfig(b) {
  if (b.block_type !== 'table') return { ...(b.config || {}) };
  return { ...b.config, rows: (b.config?.rows || []).map(row => row.map(c => ({ ...c }))) };
}

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
      const cs = cell?.colSpan > 1 ? cell.colSpan : 1;
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

const hasWording = cell => !!cell && ((cell.kind === 'static' && cellText(cell)) || cell.kind === 'image');

// An empty cell is a suggested answer box when its row says something (a row
// with no wording at all is a spacer) and it is not in the first column (an
// empty first cell is a table corner, or the label of the row above carrying
// on). A row covered by a merged cell from the row above takes that cell's
// wording — question D in a lettered table often spans two rows.
function flagTable(cfg) {
  const rows = cfg.rows || [];
  const { pos, occ } = tableGrid(rows);
  rows.forEach((row, ri) => {
    const rowSays = (occ[ri] || []).some(slot => slot && hasWording(rows[slot.ri][slot.ci]));
    row.forEach((cell, ci) => {
      if (cell.kind !== 'static') return;
      const text = cellText(cell);
      if (!text) {
        if (rowSays && pos[ri][ci] > 0) cell._sug = true;
      } else if (UNDERLINE_RE.test(text)) {
        cell._sugLine = true;
      }
      UNDERLINE_RE.lastIndex = 0;
    });
  });
  flagRaggedRows(rows, occ);
}

// Word lets a row end before the table does — it pads the gap with invisible
// grid space that the import drops — so "Write your PNR | box" sits short of
// the right edge under a full-width row. Offered: line the row's last cell up
// with the edge. The edge is the width MOST rows share, not the widest row: in
// the ARD Web workbook one row often pokes a column past thirty others, and
// that one should come in, not the thirty go out. Only when this row owns its
// last cell; a cell merged down from the row above is left alone, since
// changing it would move that row too. _sugWiden is negative for a trim.
function flagRaggedRows(rows, occ) {
  const widths = rows.map((row, ri) => (row.length ? (occ[ri] || []).length : 0)).filter(Boolean);
  if (widths.length < 2) return;
  const tally = {};
  for (const w of widths) tally[w] = (tally[w] || 0) + 1;
  const edge = Number(Object.keys(tally).sort((a, b) => tally[b] - tally[a] || b - a)[0]);
  rows.forEach((row, ri) => {
    const used = (occ[ri] || []).length;
    if (!row.length || used === edge) return;
    const owner = occ[ri][used - 1];
    if (!owner || owner.ri !== ri) return;
    const cell = rows[ri][owner.ci];
    const span = cell.colSpan > 1 ? cell.colSpan : 1;
    if (span + (edge - used) >= 1) cell._sugWiden = edge - used;
  });
}

// The visible lines of a prose block: list items, else paragraphs.
export function proseLines(html) {
  const src = html || '';
  const grab = re => [...src.matchAll(re)].map(m => stripTags(m[1])).filter(Boolean);
  const items = grab(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  if (items.length) return items;
  const paras = grab(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (paras.length) return paras;
  const plain = stripTags(src);
  return plain ? [plain] : [];
}

function stripTags(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(INVISIBLE_RE, ' ').replace(/\s+/g, ' ').trim();
}

const isPicture = b => /data-wb-(pending|image)=/.test(b.config?.html || '');

// Lettered lines in a row (a), b), c)…), or one list whose items are mostly
// questions — with nothing after them to answer in.
function flagSubQuestions(blocks) {
  let run = [];
  const close = () => {
    if (run.length >= 2) { const id = nextRid(); run.forEach(b => { b._subq = id; }); }
    run = [];
  };
  for (const b of blocks) {
    const lines = b.block_type === 'prose' && !isPicture(b) ? proseLines(b.config.html) : [];
    if (lines.length === 1 && LETTERED_RE.test(lines[0])) { run.push(b); continue; }
    close();
    if (lines.length >= 2 && /<(ol|ul)[\s>]/i.test(b.config.html || '')) {
      const asks = lines.filter(l => /\?\s*$/.test(l)).length;
      if (asks >= 2 && asks * 2 >= lines.length) b._subq = nextRid();
    }
  }
  close();
}

// ── what the review lists ──────────────────────────────────────────────

// One entry per thing that needs a look, in document order.
export function suggestionsOf(draft) {
  const out = [];
  draft.sections.forEach((sec) => {
    const seenRuns = new Set();
    sec.blocks.forEach((b) => {
      if (b.block_type === 'table') {
        const empty = [], lines = [];
        const rows = b.config.rows || [];
        rows.forEach((row, ri) => row.forEach((cell, ci) => {
          if (cell._sug) empty.push(labelFor(rows, ri, ci));
          if (cell._sugLine) lines.push(cellText(cell));
        }));
        if (empty.length) out.push({ key: `${b._rid}:cells`, type: 'cells', secRid: sec._rid, blockRid: b._rid, section: sec.title, count: empty.length, samples: uniq(empty).slice(0, 3) });
        const ragged = rows.filter(row => row.some(c => c._sugWiden)).length;
        if (ragged) out.push({ key: `${b._rid}:widen`, type: 'widen', secRid: sec._rid, blockRid: b._rid, section: sec.title, count: ragged, samples: [] });
        if (lines.length) out.push({ key: `${b._rid}:lines`, type: 'lines', secRid: sec._rid, blockRid: b._rid, section: sec.title, count: lines.length, samples: lines.slice(0, 1) });
      }
      if (b._subq && !seenRuns.has(b._subq)) {
        seenRuns.add(b._subq);
        const run = sec.blocks.filter(x => x._subq === b._subq);
        const lines = run.flatMap(x => proseLines(x.config.html));
        out.push({ key: `${b._subq}:subq`, type: 'subq', secRid: sec._rid, blockRid: b._rid, runId: b._subq, section: sec.title, count: lines.length, samples: lines.slice(0, 3) });
      }
    });
  });
  return out;
}

const uniq = arr => [...new Set(arr.filter(Boolean))];

// The wording an empty cell answers: the nearest wording to its left in the
// same row, else the nearest above it in the same column (a "Date" heading).
export function labelFor(rows, ri, ci) {
  const { pos, occ } = tableGrid(rows);
  const col = pos[ri][ci];
  for (let c = col - 1; c >= 0; c--) {
    const slot = occ[ri]?.[c];
    if (slot && hasWording(rows[slot.ri][slot.ci])) return cellText(rows[slot.ri][slot.ci]).slice(0, 40);
  }
  for (let r = ri - 1; r >= 0; r--) {
    const slot = occ[r]?.[col];
    if (slot && hasWording(rows[slot.ri][slot.ci])) return cellText(rows[slot.ri][slot.ci]).slice(0, 40);
  }
  return '';
}

// ── edits ──────────────────────────────────────────────────────────────
// Every edit returns a new draft; the block it changes is replaced, the rest
// are shared.

function mapBlock(draft, rid, fn) {
  return {
    ...draft,
    sections: draft.sections.map(sec => (
      sec.blocks.some(b => b._rid === rid)
        ? { ...sec, blocks: sec.blocks.flatMap(b => (b._rid === rid ? fn(b) : [b])) }
        : sec
    )),
  };
}

function mapCells(b, fn) {
  return {
    ...b,
    config: { ...b.config, rows: b.config.rows.map((row, ri) => row.map((cell, ci) => fn(cell, ri, ci))) },
  };
}

function withoutFlags(cell) {
  const { _sug, _sugLine, _sugWiden, ...rest } = cell;
  return rest;
}

// A replacement cell keeps the old one's place in the grid — its spans, and a
// pending "line up this row" — so the order the trainer works in never matters.
function keepShape(from, to) {
  if (from.colSpan > 1) to.colSpan = from.colSpan;
  if (from.rowSpan > 1) to.rowSpan = from.rowSpan;
  if (from._sugWiden) to._sugWiden = from._sugWiden;
  return to;
}

function inputCell(from, inputType = 'short_text') {
  return keepShape(from, { kind: 'input', id: newBoxId(), input_type: inputType });
}

const emptyCell = from => keepShape(from, { kind: 'static', text: '' });

// The underline in a cell's wording becomes a box inside that wording.
function underlinedCell(cell) {
  const text = cell.text || '';
  const parts = [];
  let last = 0, m;
  UNDERLINE_RE.lastIndex = 0;
  while ((m = UNDERLINE_RE.exec(text)) != null) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    parts.push({ kind: 'box', id: newBoxId(), input_type: 'short_text' });
    last = UNDERLINE_RE.lastIndex;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return keepShape(cell, { kind: 'mixed', parts: parts.filter(p => p.kind === 'box' || p.text.trim()) });
}

// Yes / no on one entry from suggestionsOf. `as` picks long or short answers
// for a sub-question run.
export function resolveSuggestion(draft, item, accept, { as = 'long_text' } = {}) {
  if (item.type === 'widen') {
    return mapBlock(draft, item.blockRid, b => [mapCells(b, (cell) => {
      if (!cell._sugWiden) return cell;
      const { _sugWiden: gap, ...rest } = cell;
      return accept ? { ...rest, colSpan: (cell.colSpan > 1 ? cell.colSpan : 1) + gap } : rest;
    })]);
  }
  if (item.type === 'cells' || item.type === 'lines') {
    const flag = item.type === 'cells' ? '_sug' : '_sugLine';
    return mapBlock(draft, item.blockRid, b => [mapCells(b, (cell) => {
      if (!cell[flag]) return cell;
      if (!accept) { const { [flag]: _drop, ...rest } = cell; return rest; }
      if (item.type === 'cells') return inputCell(cell);
      const { _sugLine: _l, ...rest } = cell;
      return underlinedCell(rest);
    })]);
  }
  if (item.type === 'subq') {
    return {
      ...draft,
      sections: draft.sections.map(sec => ({
        ...sec,
        blocks: sec.blocks.flatMap((b) => {
          if (b._subq !== item.runId) return [b];
          const { _subq, ...rest } = b;
          if (!accept) return [rest];
          return proseLines(b.config.html).map(line => fieldBlock(partLabel(line, draft._kind), as));
        }),
      })),
    };
  }
  return draft;
}

export function resolveAll(draft, accept) {
  return suggestionsOf(draft).reduce((d, item) => resolveSuggestion(d, item, accept), draft);
}

// Clicking a cell in the review: empty text → short answer → long answer →
// back to empty text. Cells with wording, pictures or boxes inside wording are
// left alone (turning wording into a box would lose it).
export function cycleCell(draft, blockRid, ri, ci) {
  return mapBlock(draft, blockRid, b => [mapCells(b, (cell, r, c) => {
    if (r !== ri || c !== ci) return cell;
    if (cell.kind === 'static' && !cellText(cell)) return inputCell(cell, 'short_text');
    if (cell.kind === 'input' && cell.input_type !== 'long_text') return { ...cell, input_type: 'long_text' };
    if (cell.kind === 'input') return emptyCell(cell);
    return cell;
  })]);
}

export function canCycle(cell) {
  return (cell.kind === 'static' && !cellText(cell)) || cell.kind === 'input';
}

// Every empty cell under one column heading becomes an answer box (or, when
// they all already are, back to empty). `col` is a grid column from tableGrid.
export function toggleColumn(draft, blockRid, col) {
  return mapBlock(draft, blockRid, (b) => {
    const rows = b.config.rows || [];
    const { pos } = tableGrid(rows);
    const inCol = [];
    rows.forEach((row, ri) => row.forEach((cell, ci) => { if (pos[ri][ci] === col && canCycle(cell)) inCol.push(cell); }));
    const makeBoxes = inCol.some(c => c.kind === 'static');
    return [mapCells(b, (cell, ri, ci) => {
      if (pos[ri][ci] !== col || !canCycle(cell)) return cell;
      if (makeBoxes) return cell.kind === 'static' ? inputCell(cell) : cell;
      return emptyCell(cell);
    })];
  });
}

const escapeHtml = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fieldBlock(label, inputType) {
  return { block_type: 'field', _rid: nextRid(), config: { label, input_type: inputType } };
}

// A sub-question line as a field label. An assessment letters the parts of a
// question itself — (a), (b), (c) — so the typed letter is dropped there, or it
// would read "(a) a) Why…". A workbook keeps the line as written.
function partLabel(line, kind) {
  return kind === 'assessment' ? line.replace(LETTER_PREFIX_RE, '') : line;
}

// "What is this?" on a line of prose, a field, or a table.
//   text | short_text | long_text   the block as plain text or one answer box
//   subq                            one answer box per line (long answers)
//   choice | check_group            first line the question, the rest options;
//                                   on a choice field, pick one ↔ pick several
//   pnr                             (assessments) a PNR question after it;
//                                   the scenario text stays where it is
export function setBlockKind(draft, blockRid, to) {
  return mapBlock(draft, blockRid, (b) => {
    const { _subq, ...base } = b;
    if (to === 'pnr') {
      const scenario = b.block_type === 'table'
        ? cellText((b.config.rows || [])[0]?.[0])
        : proseLines(b.config.html).join(' ');
      return [base, {
        block_type: 'field',
        _rid: nextRid(),
        config: { label: '', input_type: 'long_text', pnr: { ...emptyPnrScenario(), scenario } },
      }];
    }
    if (b.block_type === 'prose') {
      const lines = proseLines(b.config.html);
      if (to === 'subq') return lines.map(l => fieldBlock(partLabel(l, draft._kind), 'long_text'));
      if ((to === 'choice' || to === 'check_group') && lines.length >= 3) {
        return [{ block_type: 'field', _rid: nextRid(), config: { label: lines[0], input_type: to, options: lines.slice(1) } }];
      }
      if (to === 'short_text' || to === 'long_text') return [fieldBlock(lines.join(' '), to)];
      return [base];
    }
    if (b.block_type === 'field') {
      if (to === 'text') return [{ block_type: 'prose', _rid: b._rid, config: { html: `<p>${escapeHtml(b.config.label)}</p>` } }];
      if (to === 'short_text' || to === 'long_text') return [{ ...base, config: { ...b.config, input_type: to } }];
      if ((to === 'choice' || to === 'check_group') && Array.isArray(b.config.options)) return [{ ...base, config: { ...b.config, input_type: to } }];
    }
    return [base];
  });
}

// ── counts and hand-back ───────────────────────────────────────────────

// Places a participant can answer in one section.
export function answerBoxCount(sec) {
  let n = 0;
  for (const b of sec.blocks) {
    if (b.block_type === 'table') {
      for (const row of b.config.rows || []) for (const cell of row) {
        if (cell.kind === 'input') n += 1;
        if (cell.kind === 'mixed') n += (cell.parts || []).filter(p => p.kind === 'box').length;
      }
    } else if (b.block_type !== 'prose') n += 1;
  }
  return n;
}

// The parse with every review flag removed — the shape Create has always saved.
// Suggestions still pending are left as they were imported: plain text.
export function finishReview(draft) {
  const { _kind, ...parsed } = draft;
  return {
    ...parsed,
    sections: draft.sections.map(({ _rid, ...sec }) => ({
      ...sec,
      blocks: sec.blocks.map(({ _rid: _r, _subq, ...b }) => (
        b.block_type === 'table' ? { ...b, config: { ...b.config, rows: b.config.rows.map(row => row.map(withoutFlags)) } } : b
      )),
    })),
  };
}

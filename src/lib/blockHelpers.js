// Shared logic for "is this block fillable / has it been answered".

import { isInteractiveBlock, parseFillBlank } from './interactiveBlocks.js';

export function isFillableBlock(block) {
  if (!block) return false;
  if (block.block_type === 'field') return true;
  if (isInteractiveBlock(block)) return true;
  if (block.block_type === 'table') {
    return (block.config?.rows || []).some(row =>
      row.some(cell => cell?.kind === 'input')
    );
  }
  return false;
}

export function isAnswered(block, value) {
  if (value == null) return false;
  if (block.block_type === 'field') {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' && value.trim() !== '';
  }
  if (block.block_type === 'reorder') {
    return Array.isArray(value) && value.length > 0;
  }
  // table + fill_blank/card_sort/match_pairs all save an object keyed by
  // cell/blank/card/left id — answered if any entry holds a value.
  if (block.block_type === 'table' || isInteractiveBlock(block)) {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).some(v =>
      Array.isArray(v) ? v.length > 0 : (v != null && String(v).trim() !== '')
    );
  }
  return false;
}

export function countFillable(blocks) {
  return blocks.filter(isFillableBlock).length;
}

// Assign 1-based question numbers to an ordered list of blocks. Only fillable
// blocks (field / table / interactive) are questions and get a number; prose is
// context and is skipped. Returns { [blockId]: questionNumber }. Used by the
// assessment editor, the participant assessment view, and the trainer response
// view so the same question carries the same number everywhere.
export function questionNumbers(orderedBlocks) {
  const map = {};
  let n = 0;
  for (const b of orderedBlocks || []) {
    if (isFillableBlock(b)) { n += 1; map[b.id] = n; }
  }
  return map;
}

export function labelOf(block) {
  if (!block) return '';
  if (block.block_type === 'field') return block.config?.label || '(unlabeled field)';
  if (block.block_type === 'table') {
    const cfg = block.config || {};
    if (cfg.caption?.trim()) return cfg.caption.trim();
    for (const row of cfg.rows || []) {
      for (const cell of row || []) {
        if (cell?.kind === 'static' && cell.text?.trim()) {
          const t = cell.text.trim().replace(/\s+/g, ' ');
          return t.length > 60 ? t.slice(0, 60) + '…' : t;
        }
      }
    }
    for (const h of cfg.headers || []) {
      if (h?.trim()) return h.trim();
    }
    return `Table (${(cfg.rows || []).length} rows)`;
  }
  if (block.block_type === 'prose') {
    const text = (block.config?.html || '').replace(/<[^>]+>/g, '').trim();
    return text.slice(0, 60) || '(empty prose)';
  }
  if (isInteractiveBlock(block)) {
    const cfg = block.config || {};
    const raw = (cfg.prompt || cfg.text || '').replace(/\{\{\s*\}\}/g, '___').replace(/\s+/g, ' ').trim();
    if (raw) return raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
    const fallback = {
      fill_blank: 'Fill in the blank', card_sort: 'Card sort',
      match_pairs: 'Match pairs', reorder: 'Reorder',
    };
    return fallback[block.block_type] || block.block_type;
  }
  return block.block_type;
}

// For a table block, enumerate every input cell with a best-effort label
// (the nearest preceding static cell in the row, falling back to the column
// header, then a generic "Row R Col C"). Used by aggregate views & CSV export.
export function inputCellsOf(block) {
  if (block?.block_type !== 'table') return [];
  const rows = block.config?.rows || [];
  const headers = block.config?.headers || [];
  const out = [];
  rows.forEach((row, ri) => {
    let lastStatic = null;
    row.forEach((cell, ci) => {
      if (!cell) return;
      if (cell.kind === 'static') {
        const t = (cell.text || '').trim();
        if (t) lastStatic = t;
      } else if (cell.kind === 'input') {
        const header = (headers[ci] || '').trim();
        const label = lastStatic || header || `Row ${ri + 1} Col ${ci + 1}`;
        out.push({ id: cell.id, input_type: cell.input_type, label });
      }
    });
  });
  return out;
}

// ── Input-level completion ──────────────────────────────────────────────────
// `isAnswered` above answers "has this block been touched at all" — it is true
// as soon as ONE entry has a value, which is right for display (a part-filled
// table is not blank) and wrong for progress (it let a barely-started exercise
// report 100%). Progress counts INPUTS instead: a 10-cell table is ten things
// to fill, not one.

function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

// The blanks in a fill_blank, however the block stores them: pre-parsed `parts`
// if the editor saved them, else parsed from the authored text.
function fillBlankIds(block) {
  const cfg = block?.config || {};
  if (Array.isArray(cfg.parts)) return cfg.parts.filter(p => p?.kind === 'blank').map(p => p.id);
  return parseFillBlank(cfg.text || '', cfg.blanks || []).blanks.map(b => b.id);
}

// The ids a block's answer object is keyed by. Counting only these means a stale
// answer left behind by an edited block cannot push progress past the number of
// inputs actually on screen.
function expectedIds(block) {
  const cfg = block?.config || {};
  switch (block?.block_type) {
    case 'table': return inputCellsOf(block).map(c => c.id);
    case 'fill_blank': return fillBlankIds(block);
    case 'card_sort': return (cfg.cards || []).map(c => c.id);
    case 'match_pairs': return (cfg.left || []).map(l => l.id);
    default: return [];
  }
}

// How many separate inputs this block asks for. A fillable block with nothing to
// fill (an interactive block authored with no items) returns 0 and drops out of
// the maths entirely — an input that does not exist can never be completed, and
// counting it would put 100% permanently out of reach.
export function expectedInputs(block) {
  if (!isFillableBlock(block)) return 0;
  const cfg = block.config || {};
  switch (block.block_type) {
    case 'field': return 1;
    case 'reorder': return (cfg.items || []).length;
    default: return expectedIds(block).length;
  }
}

export function filledInputs(block, value) {
  if (!isFillableBlock(block) || value == null) return 0;
  if (block.block_type === 'field') return nonEmpty(value) ? 1 : 0;
  if (block.block_type === 'reorder') {
    // A complete ordering contains every item; a half-finished drag is partial.
    return Array.isArray(value) ? Math.min(value.length, expectedInputs(block)) : 0;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return 0;
  return expectedIds(block).filter(id => nonEmpty(value[id])).length;
}

// Strict per-block completion — every input filled, not merely one.
export function isComplete(block, value) {
  const total = expectedInputs(block);
  return total > 0 && filledInputs(block, value) === total;
}

// Progress across a set of blocks. `getValue(blockId)` adapts to each caller's
// answer shape (some hold the raw value, others { value }).
// Returns { total, filled, pct } — pct hits 100 only when every input is filled.
export function progressOf(blocks, getValue) {
  let total = 0, filled = 0;
  for (const b of blocks || []) {
    if (!isFillableBlock(b)) continue;
    total += expectedInputs(b);
    filled += filledInputs(b, getValue(b.id));
  }
  return { total, filled, pct: total ? Math.round((filled / total) * 100) : 0 };
}

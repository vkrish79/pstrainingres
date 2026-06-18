// Shared logic for "is this block fillable / has it been answered".

import { isInteractiveBlock } from './interactiveBlocks.js';

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

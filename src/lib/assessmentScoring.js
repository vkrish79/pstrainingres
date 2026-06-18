// Auto-marking for assessments. Trainer-only: the key is read by the trainer's
// view and compared client-side against participant answers. Objective types
// only (single-choice, multi-select, short text, table cells); long text is
// never auto-scored. A key's shape mirrors a participant answer:
//   field short_text/choice -> string
//   field check_group       -> string[]
//   table                   -> { [cellId]: expected }
import { isFillableBlock, isAnswered, inputCellsOf } from './blockHelpers.js';
import { isInteractiveBlock, arraysEqual } from './interactiveBlocks.js';

function normText(v) {
  return String(v ?? '').trim().toLowerCase();
}

// Objective (auto-scorable) blocks. long_text is intentionally excluded.
export function isScorableBlock(block) {
  if (!block) return false;
  if (block.block_type === 'field') {
    const t = block.config?.input_type;
    return t === 'short_text' || t === 'choice' || t === 'check_group';
  }
  if (block.block_type === 'table') return isFillableBlock(block);
  // All four interactive types are objective once a key is set.
  if (isInteractiveBlock(block)) return true;
  return false;
}

// Score an interactive block against its key. One question = one mark:
// every keyed slot must match. Returns 'correct' | 'wrong' | 'blank' | null.
function scoreInteractive(block, key, value) {
  if (block.block_type === 'reorder') {
    if (!Array.isArray(key) || key.length === 0) return null;
    if (!isAnswered(block, value)) return 'blank';
    return arraysEqual(value, key) ? 'correct' : 'wrong';
  }
  // fill_blank / card_sort / match_pairs: object key { slotId: expected }.
  const keyMap = key && typeof key === 'object' && !Array.isArray(key) ? key : {};
  const keyed = Object.keys(keyMap).filter(k => keyMap[k] != null && String(keyMap[k]).trim() !== '');
  if (!keyed.length) return null;
  if (!isAnswered(block, value)) return 'blank';
  const valMap = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allMatch = keyed.every(k => normText(valMap[k]) === normText(keyMap[k]));
  return allMatch ? 'correct' : 'wrong';
}

// Score one block's answer against its key.
// Returns 'correct' | 'wrong' | 'blank', or null when not scorable / no usable key.
export function scoreBlock(block, key, value) {
  if (!isScorableBlock(block) || key == null) return null;
  if (isInteractiveBlock(block)) return scoreInteractive(block, key, value);
  if (block.block_type === 'field') {
    const t = block.config?.input_type;
    if (t === 'short_text' || t === 'choice') {
      if (!isAnswered(block, value)) return 'blank';
      return normText(value) === normText(key) ? 'correct' : 'wrong';
    }
    if (t === 'check_group') {
      if (!isAnswered(block, value)) return 'blank';
      const a = (Array.isArray(value) ? value : []).map(normText).sort();
      const b = (Array.isArray(key) ? key : []).map(normText).sort();
      const same = a.length === b.length && a.every((x, i) => x === b[i]);
      return same ? 'correct' : 'wrong';
    }
    return null;
  }
  if (block.block_type === 'table') {
    const keyMap = key && typeof key === 'object' && !Array.isArray(key) ? key : {};
    // Only cells that actually carry a key are graded; a partly-keyed table
    // scores on its keyed cells. All keyed cells must match (one question = one mark).
    const keyed = inputCellsOf(block).filter(
      c => keyMap[c.id] != null && String(keyMap[c.id]).trim() !== ''
    );
    if (!keyed.length) return null;
    if (!isAnswered(block, value)) return 'blank';
    const valMap = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const allMatch = keyed.every(c => normText(valMap[c.id]) === normText(keyMap[c.id]));
    return allMatch ? 'correct' : 'wrong';
  }
  return null;
}

// Aggregate a participant's score over a set of blocks.
// answersForP is { [blockId]: { value, ... } } (the trainer-view shape) or
// { [blockId]: value }. Returns { correct, scorable, blank, pct }.
export function scoreBlocks(blocks, keyByBlockId, answersForP) {
  let scorable = 0;
  let correct = 0;
  let blank = 0;
  for (const b of blocks) {
    const key = keyByBlockId[b.id];
    if (!isScorableBlock(b) || key == null) continue;
    scorable += 1;
    const entry = answersForP[b.id];
    const value = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry;
    const r = scoreBlock(b, key, value);
    if (r === 'correct') correct += 1;
    else if (r === 'blank') blank += 1;
  }
  return { correct, scorable, blank, pct: scorable ? Math.round((correct / scorable) * 100) : null };
}

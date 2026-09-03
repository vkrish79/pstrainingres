// Auto-marking for assessments. Trainer-only: the key is read by the trainer's
// view and compared client-side against participant answers. Objective types
// only (single-choice, multi-select, short text, table cells, and the four
// interactive types); long text is never auto-scored. A key's shape mirrors a
// participant answer:
//   field short_text/choice -> string
//   field check_group       -> string[]
//   table / fill_blank / card_sort / match_pairs -> { [slotId]: expected }
//   reorder                 -> [itemId, ...] in the correct order
//
// TWO THINGS EVERY CALLER NEEDS TO KNOW:
//
// 1. QUESTIONS CARRY POINTS. Worth comes from assessment_answer_keys.points
//    (default 1). A four-pair matching question can be worth 4 while a yes/no
//    is worth 1.
//
// 2. MULTI-PART QUESTIONS EARN PARTIAL CREDIT. Scoring returns a FRACTION of
//    the question's keyed slots, not a verdict. Three of four pairs right on a
//    4-point question earns 3.0. The rule is the same everywhere: the fraction
//    of keyed slots answered correctly.
//
//    The two places that rule needs spelling out:
//      * check_group — extra ticks CANCEL correct ones, floored at zero.
//        Without that, ticking every option would score full marks.
//      * reorder — credit is by ABSOLUTE POSITION. Shifting every item one
//        place scores zero even though the relative order is right. That is
//        the standard reading of "put these in order", and it is deliberate.
import { isFillableBlock, isAnswered, inputCellsOf } from './blockHelpers.js';
import { isInteractiveBlock, arraysEqual } from './interactiveBlocks.js';

function normText(v) {
  return String(v ?? '').trim().toLowerCase();
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
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

// What a fraction means as a label. Kept in one place so the chip in the
// responses view and any future export agree.
function stateOf(fraction) {
  if (fraction >= 1) return 'correct';
  if (fraction > 0) return 'partial';
  return 'wrong';
}

function result(fraction) {
  const f = clamp01(fraction);
  return { state: stateOf(f), fraction: f };
}

const BLANK = { state: 'blank', fraction: 0 };

// Fraction of keyed slots matched, for the { slotId: expected } shapes.
function fractionOfSlots(keyed, keyMap, valMap) {
  const hits = keyed.filter(k => normText(valMap[k]) === normText(keyMap[k])).length;
  return hits / keyed.length;
}

// Score an interactive block against its key.
function scoreInteractive(block, key, value) {
  if (block.block_type === 'reorder') {
    if (!Array.isArray(key) || key.length === 0) return null;
    if (!isAnswered(block, value)) return BLANK;
    if (arraysEqual(value, key)) return result(1);
    // Position-by-position credit — see the note at the top of this file.
    const arr = Array.isArray(value) ? value : [];
    const hits = key.filter((id, i) => arr[i] === id).length;
    return result(hits / key.length);
  }
  // fill_blank / card_sort / match_pairs: object key { slotId: expected }.
  const keyMap = key && typeof key === 'object' && !Array.isArray(key) ? key : {};
  const keyed = Object.keys(keyMap).filter(k => keyMap[k] != null && String(keyMap[k]).trim() !== '');
  if (!keyed.length) return null;
  if (!isAnswered(block, value)) return BLANK;
  const valMap = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return result(fractionOfSlots(keyed, keyMap, valMap));
}

// Score one block's answer against its key.
// Returns { state, fraction } — state is 'correct' | 'partial' | 'wrong' |
// 'blank' — or null when the block isn't scorable or the key can't be used
// (e.g. a stale key whose slot ids no longer exist after the block was edited).
// Callers MUST treat null as "not marked" and leave it out of the total.
export function scoreBlock(block, key, value) {
  if (!isScorableBlock(block) || key == null) return null;
  if (isInteractiveBlock(block)) return scoreInteractive(block, key, value);

  if (block.block_type === 'field') {
    const t = block.config?.input_type;
    if (t === 'short_text' || t === 'choice') {
      if (!isAnswered(block, value)) return BLANK;
      // One slot, so no partial credit is possible here.
      return result(normText(value) === normText(key) ? 1 : 0);
    }
    if (t === 'check_group') {
      const want = (Array.isArray(key) ? key : []).map(normText).filter(Boolean);
      if (!want.length) return null;
      if (!isAnswered(block, value)) return BLANK;
      const got = (Array.isArray(value) ? value : []).map(normText);
      const hits = want.filter(w => got.includes(w)).length;
      // Every tick that shouldn't be there cancels one that should. Clamped at
      // zero, so over-ticking can never score below nothing or drag the total.
      const extras = got.filter(g => !want.includes(g)).length;
      return result((hits - extras) / want.length);
    }
    return null;
  }

  if (block.block_type === 'table') {
    const keyMap = key && typeof key === 'object' && !Array.isArray(key) ? key : {};
    // Only cells that actually carry a key are graded; a partly-keyed table
    // scores on its keyed cells.
    const keyed = inputCellsOf(block).filter(
      c => keyMap[c.id] != null && String(keyMap[c.id]).trim() !== ''
    );
    if (!keyed.length) return null;
    if (!isAnswered(block, value)) return BLANK;
    const valMap = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const ids = keyed.map(c => c.id);
    return result(fractionOfSlots(ids, keyMap, valMap));
  }

  return null;
}

// What one question is worth. Defaults to 1 so a key written before points
// existed still marks correctly.
export function pointsFor(blockId, pointsByBlockId) {
  const p = Number(pointsByBlockId?.[blockId]);
  return Number.isFinite(p) && p > 0 ? p : 1;
}

// What a participant earned on one question, in points.
export function earnedFor(block, key, value, points) {
  const r = scoreBlock(block, key, value);
  if (!r) return null;
  return { ...r, earned: r.fraction * points, possible: points };
}

// Aggregate a participant's score over a set of blocks.
// answersForP is { [blockId]: { value, ... } } (the trainer-view shape) or
// { [blockId]: value }. pointsByBlockId is { [blockId]: number }; omit it and
// every question is worth 1, which is what this returned before points existed.
//
// Returns { earned, possible, marked, blank, pct }.
export function scoreBlocks(blocks, keyByBlockId, answersForP, pointsByBlockId = null) {
  let earned = 0;
  let possible = 0;
  let marked = 0;
  let blank = 0;
  for (const b of blocks) {
    const key = keyByBlockId[b.id];
    if (!isScorableBlock(b) || key == null) continue;
    const entry = answersForP[b.id];
    const value = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry;
    const r = scoreBlock(b, key, value);
    // A key that exists but can't be used marks nothing, so it must not count
    // toward the total either — otherwise a stale key silently drags the
    // percentage down with no visible reason.
    if (!r) continue;
    const points = pointsFor(b.id, pointsByBlockId);
    marked += 1;
    possible += points;
    earned += r.fraction * points;
    if (r.state === 'blank') blank += 1;
  }
  // Rounded to one decimal: partial credit produces thirds and quarters, and
  // "2.3 / 4" reads as a mark whereas 2.3333333 reads as a bug.
  const round1 = n => Math.round(n * 10) / 10;
  return {
    earned: round1(earned),
    possible: round1(possible),
    marked,
    blank,
    pct: possible ? Math.round((earned / possible) * 100) : null,
  };
}

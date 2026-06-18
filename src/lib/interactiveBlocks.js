// Shared helpers for the interactive assessment block types
// (fill_blank, card_sort, match_pairs, reorder).
//
// Design notes that the rest of the codebase depends on:
//  • Each type's *content* lives in block.config (sent to participants); the
//    *correct answer* lives in assessment_answer_keys (trainer-only), exactly
//    like single-choice. Never store answers in config — it would leak.
//  • Answer value shapes (what a participant saves):
//      fill_blank  → { [blankId]: text }
//      card_sort   → { [cardId]: bucketId }
//      match_pairs → { [leftId]: rightId }
//      reorder     → [itemId, itemId, …]   (the participant's ordering)
//  • Answer-key shapes mirror the value shapes one-for-one.

export const INTERACTIVE_BLOCK_TYPES = ['fill_blank', 'card_sort', 'match_pairs', 'reorder'];

export function isInteractiveBlock(block) {
  return !!block && INTERACTIVE_BLOCK_TYPES.includes(block.block_type);
}

let idCounter = 0;
// Stable-ish id for editor-created items. Date.now keeps ids unique across
// sessions; the counter disambiguates items added in the same millisecond.
export function newItemId(prefix = 'i') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// Fill-in-the-blank authoring uses `{{ }}` markers in a sentence. We split the
// text into an alternating run of literal strings and blank slots, assigning a
// stable id to each blank. When re-parsing after an edit we reuse the previous
// blank ids by position so saved answers/keys stay attached.
export function parseFillBlank(text, prevBlanks = []) {
  const parts = [];
  const blanks = [];
  const re = /\{\{\s*\}\}/g;
  let lastIndex = 0;
  let match;
  let blankNo = 0;
  while ((match = re.exec(text)) != null) {
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
    }
    const id = prevBlanks[blankNo]?.id || newItemId('b');
    blanks.push({ id });
    parts.push({ kind: 'blank', id });
    blankNo += 1;
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: 'text', text: text.slice(lastIndex) });
  }
  return { parts, blanks };
}

// Deterministic shuffle so a reorder question is presented out of its authored
// order, but stays put across re-renders/saves. Seeded by the block id (and so
// identical for everyone — fine; the point is only that the initial order is
// not the answer, not per-participant randomness).
function seededOrder(items, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // Decorate-sort each item by a hash of (seed + id); stable + deterministic.
  return [...items]
    .map((it) => {
      let g = h;
      const k = it.id || '';
      for (let i = 0; i < k.length; i++) g = (g * 31 + k.charCodeAt(i)) >>> 0;
      return { it, rank: g };
    })
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.it);
}

// The order a participant sees a reorder question's items in before they've
// touched it: a deterministic scramble of the authored order.
export function presentationOrder(items, seed) {
  return seededOrder(items || [], seed || 'seed');
}

export function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

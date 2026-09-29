import { blockTypeKey } from './questionTypeLabels.js';

// Can this question be marked, and by what?
//
// It exists because a question is a SECTION while an answer key is per BLOCK,
// and a count that mixes the two units reads as a fraction but isn't one
// ("35 keyed of 42 questions", where the 35 counted blocks). The library gauges
// and the question browser both call this, so a bank cannot say one thing on
// the card and another in the list.
//
// Written answers and PNR builds have NO key by design — they are marked by
// hand, in whichever paper takes them. Counting those as unkeyed would paint a
// scenario bank red for being exactly what it is meant to be, which is why
// 'hand' is a state of its own rather than a flavour of missing.
export const BY_HAND_TYPES = new Set(['written', 'pnr']);

//  'keyed'   — every automatically-markable block under it has a key
//  'unkeyed' — at least one has not, so a paper taking it cannot mark it
//  'hand'    — nothing here is machine-markable; a person marks it
//  null      — not a question at all (prose is narration)
export function questionKeyState(blocks, hasKey) {
  let auto = 0;
  let missing = 0;
  let hand = 0;
  for (const b of blocks || []) {
    const k = blockTypeKey(b);
    if (!k) continue;
    if (BY_HAND_TYPES.has(k)) { hand += 1; continue; }
    auto += 1;
    if (!hasKey(b)) missing += 1;
  }
  if (auto === 0 && hand === 0) return null;
  if (auto === 0) return 'hand';
  return missing > 0 ? 'unkeyed' : 'keyed';
}
